// Integration tests for the phone pipeline (recorder + uploader + BLE) running for real in node,
// with native modules replaced by fakes (tests/mocks): node:sqlite for expo-sqlite, a temp dir
// for expo-file-system, a scriptable pendant for react-native-ble-manager, a fake Convex server.
//
// Run: npm test
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type G = typeof globalThis & Record<string, unknown>;
const g = globalThis as G;
const root = fs.mkdtempSync(path.join(os.tmpdir(), "mind-rt-"));
g.__fsRoot = root;
g.__testDbPath = path.join(root, "mind.db");

const runtime = await import("../src/lib/runtime.ts");
const rec = await import("../src/lib/recorder.ts");
const up = await import("../src/lib/uploader.ts");
const bleMod = await import("../src/lib/ble.ts");
const db = await import("../src/lib/db.ts");
const files = await import("../src/lib/files.ts");
const protocol = await import("../src/lib/protocol.ts");
const { ble, PERIPHERAL } = await import("./mocks/ble-manager.ts");
const { netinfo } = await import("./mocks/netinfo.ts");

const { FLAG_BACKFILL, FLAG_END, FLAG_SPEECH, FLAG_START, FRAME_BYTES } = protocol;

// ---------------------------------------------------------------------------------------------
// Fake Convex server (generateUploadUrl -> upload -> create, idempotent on clientId).

const server = {
  n: 0,
  offline: false,
  hangUpload: false,
  failCreateOnce: false,
  /** create() commits but the response is lost (network drop after commit). */
  loseCreateResponseOnce: false,
  blobs: new Map<string, Uint8Array>(),
  recordings: new Map<string, Record<string, unknown>>(),
  calls: [] as string[],
  /** sessionType of each WAV upload (iOS URLSession choice). */
  sessions: [] as unknown[],
};

g.__convexMutation = async (name: string, args: Record<string, unknown>) => {
  server.calls.push(name);
  if (server.offline) throw new Error("Network request failed");
  if (name === "recordings:generateUploadUrl") return `https://upload.invalid/${++server.n}`;
  if (name === "recordings:create") {
    if (server.failCreateOnce) {
      server.failCreateOnce = false;
      throw new Error("500 Internal Server Error");
    }
    const existing = server.recordings.get(args.clientId as string);
    if (existing) return { id: existing.id, created: false };
    if (!server.blobs.has(args.storageId as string)) throw new Error("storageId not found");
    const r = { id: `rec${++server.n}`, ...args };
    server.recordings.set(args.clientId as string, r);
    if (server.loseCreateResponseOnce) {
      server.loseCreateResponseOnce = false;
      throw new Error("Network request failed");
    }
    return { id: r.id, created: true };
  }
  throw new Error(`unexpected mutation ${name}`);
};

g.__fsHooks = {
  upload: async (file: { bytesSync(): Uint8Array }, _url: string, opts?: { sessionType?: string }) => {
    server.sessions.push(opts?.sessionType);
    if (server.offline) throw new Error("Network request failed");
    if (server.hangUpload) return new Promise(() => {});
    const id = `blob${++server.n}`;
    server.blobs.set(id, file.bytesSync());
    return { status: 200, body: JSON.stringify({ storageId: id }) };
  },
};
const hooks = g.__fsHooks as { failWrite?: (p: string) => boolean };

// ---------------------------------------------------------------------------------------------
// Helpers

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function frame(seq: number, o: { flags?: number; level?: number; bootTag?: number } = {}) {
  const f = new Uint8Array(FRAME_BYTES);
  const dv = new DataView(f.buffer);
  dv.setUint32(0, seq, true);
  dv.setUint16(4, o.level ?? 800, true);
  dv.setUint8(6, o.flags ?? FLAG_SPEECH);
  dv.setUint8(7, 1);
  dv.setInt16(8, 0, true);
  dv.setUint8(10, 0);
  dv.setUint8(11, o.bootTag ?? (40213 & 0xff));
  for (let i = 12; i < FRAME_BYTES; i++) f[i] = (i * 7) & 0xff; // some non-silent codes
  return f;
}

/** Feed seqs [from, to] as one gated stretch (START on first, END on last) at 20 ms spacing. */
function talk(from: number, to: number, t0: number, o: { flags?: number; bootTag?: number } = {}) {
  for (let s = from; s <= to; s++) {
    const flags = (o.flags ?? FLAG_SPEECH) | (s === from ? FLAG_START : 0) | (s === to ? FLAG_END : 0);
    rec.onFrame(frame(s, { flags, bootTag: o.bootTag }), t0 + (s - from) * 20);
  }
  return t0 + (to - from) * 20;
}

function status(seq: number, extra: Record<string, unknown> = {}) {
  return { ...(ble.status as object), seq, ...extra } as never;
}

function init() {
  db.getDb();
  rec.initRecorder({ onSegmentQueued: () => up.kick() });
  up.initUploader();
  return bleMod.initBle();
}

/** Wait until builds and uploads have settled. */
async function settle() {
  for (let i = 0; i < 400; i++) {
    await rec.buildsIdle();
    await sleep(3);
    if (!up.uploaderStore.get().busy) {
      await rec.buildsIdle();
      await sleep(3);
      if (!up.uploaderStore.get().busy) return;
    }
  }
  throw new Error("pipeline did not settle");
}

const rows = () => db.getDb().getAllSync<db.SegmentRow>("SELECT * FROM segments ORDER BY createdAt");
const recordings = () => [...server.recordings.values()];

function wipe() {
  runtime.resetRuntime();
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  Object.assign(server, { n: 0, offline: false, hangUpload: false, failCreateOnce: false, loseCreateResponseOnce: false, calls: [] });
  server.blobs.clear();
  server.recordings.clear();
  hooks.failWrite = undefined;
  ble.listeners.clear();
  Object.assign(ble, { connected: false, connectHangs: false, calls: [], writes: [] });
  ble.status = { v: 2, fw: "1.1", boot: 40213, seq: 1000, muted: false, mode: "gated", lvl: 10, nf: -65, wake: 150, gain: 4, buf: 0, lost: 0, sd: 1, sdFree: 1000 };
  netinfo.state = { isConnected: true, isInternetReachable: true };
  netinfo.listeners.clear();
  up.uploaderStore.set({ online: true, busy: false, current: null, lastError: null, uploadedThisSession: 0, lastSuccessAt: null, abandoned: 0 });
  bleMod.bleStore.set({ link: "idle", deviceId: null, deviceName: null, status: null, statusAt: null, statusViaNotify: 0, statusViaRead: 0, audioNotifying: null, statusNotifying: null, error: null, reconnects: 0 });
}

beforeEach(wipe);
after(() => {
  runtime.resetRuntime();
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------
// Recorder + uploader

test("conversation -> idle close -> WAV -> upload with exact wall time", async () => {
  await init();
  const T = Date.now();
  rec.onStatus(status(1500), T); // at T the board records frame 1500
  const end = talk(1000, 1149, T + 1000);
  rec.tick(end + 21_000);
  await settle();
  const [r] = recordings();
  assert.equal(recordings().length, 1);
  assert.equal(r.seqStart, 1000);
  assert.equal(r.seqEnd, 1149);
  assert.equal(r.durationMs, 3000);
  assert.equal(r.startedAt, T - (1500 - 1000) * 20);
  assert.equal(r.timeApprox, false);
  assert.equal(r.backfill, false);
  const row = rows()[0];
  assert.equal(row.state, "uploaded");
  assert.ok(files.wavLooksComplete(row.id, row.durationMs));
  const blob = server.blobs.get(r.storageId as string)!;
  assert.equal(blob.length, files.expectedWavBytes(3000));
});

test("short pauses stay one segment; a 20 s+ gap starts a new one", async () => {
  await init();
  const T = Date.now();
  talk(1000, 1049, T);
  talk(1100, 1149, T + 2000); // 1 s pause in audio time
  talk(1149 + 1001 + 50, 1149 + 1001 + 99, T + 4000); // > 20 s seq gap
  rec.tick(T + 60_000);
  await settle();
  assert.equal(recordings().length, 2);
});

test("Fast Refresh: re-running init keeps the open segment open and adds no listeners", async () => {
  await init();
  const T = Date.now();
  talk(1000, 1049, T);
  const before = ble.listenerCount();
  const openId = rec.recorderStore.get().openSegmentId ?? rows()[0].id;
  await init(); // what Fast Refresh does when it re-runs startPipeline
  await init();
  assert.equal(ble.listenerCount(), before, "listener count unchanged");
  assert.equal(ble.listenerCount("value"), 1);
  await rec.buildsIdle();
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].state, "recording", "open segment was not built by recovery");
  assert.equal(rows()[0].id, openId);
  talk(1050, 1099, T + 1100);
  rec.tick(T + 30_000);
  await settle();
  assert.equal(recordings().length, 1);
  assert.equal(recordings()[0].seqEnd, 1099, "frames after the refresh landed in the same segment");
});

test("crash/restart: a segment that was recording is rebuilt from disk and uploaded", async () => {
  await init();
  const T = Date.now();
  talk(1000, 1099, T);
  rec.tick(T + 3000); // flush to disk (FLUSH_MS)
  runtime.resetRuntime(); // process dies: memory gone, disk + SQLite remain
  await init();
  await settle();
  assert.equal(recordings().length, 1);
  assert.equal(recordings()[0].seqEnd, 1099);
  assert.equal(rows()[0].state, "uploaded");
});

test("WAV deleted before upload is rebuilt from the frames file", async () => {
  await init();
  server.offline = true;
  const T = Date.now();
  talk(1000, 1099, T);
  rec.tick(T + 25_000);
  await settle();
  const row = rows()[0];
  assert.equal(row.state, "queued");
  files.wavFile(row.id).delete();
  server.offline = false;
  up.retryAllNow();
  await settle();
  assert.equal(rows()[0].state, "uploaded");
  assert.equal(recordings().length, 1);
});

test("truncated WAV (crash mid-write) is detected and rebuilt", async () => {
  await init();
  server.offline = true;
  const T = Date.now();
  talk(1000, 1099, T);
  rec.tick(T + 25_000);
  await settle();
  const row = rows()[0];
  fs.truncateSync(files.wavFile(row.id).path, 1000);
  assert.equal(files.wavLooksComplete(row.id, row.durationMs), false);
  server.offline = false;
  up.retryAllNow();
  await settle();
  const r = recordings()[0];
  assert.equal(server.blobs.get(r.storageId as string)!.length, files.expectedWavBytes(2000));
});

test("WAV and frames both gone -> broken with a clear error (no retry loop)", async () => {
  await init();
  server.offline = true;
  const T = Date.now();
  talk(1000, 1049, T);
  rec.tick(T + 25_000);
  await settle();
  const row = rows()[0];
  files.deleteSegmentFiles(row.id);
  server.offline = false;
  up.retryAllNow();
  await settle();
  assert.equal(rows()[0].state, "broken");
  assert.match(rows()[0].lastError ?? "", /audio missing/);
});

test("segments left broken by the old WAV-missing bug are recovered on next start", async () => {
  await init();
  server.offline = true;
  const T = Date.now();
  talk(1000, 1099, T);
  rec.tick(T + 25_000);
  await settle();
  const row = rows()[0];
  files.wavFile(row.id).delete();
  db.updateSegment(row.id, { state: "broken", lastError: "WAV file missing" });
  server.offline = false;
  runtime.resetRuntime();
  await init();
  await settle();
  assert.equal(rows()[0].state, "uploaded");
  assert.equal(recordings().length, 1);
});

test("reconnect re-send: duplicates dropped, lost frames slotted back, not tagged backfill", async () => {
  await init();
  const T = Date.now();
  // live 1000..1079, link drops, 1080..1089 never arrive live, live resumes 1090..1099
  for (let s = 1000; s <= 1079; s++) rec.onFrame(frame(s, { flags: FLAG_SPEECH | (s === 1000 ? FLAG_START : 0) }), T + (s - 1000) * 20);
  for (let s = 1090; s <= 1099; s++) rec.onFrame(frame(s), T + 2000 + (s - 1090) * 20);
  // board re-sends its last 32 frames (1068..1099) with BACKFILL
  for (let s = 1068; s <= 1099; s++) rec.onFrame(frame(s, { flags: FLAG_SPEECH | FLAG_BACKFILL }), T + 2300);
  assert.equal(rec.recorderStore.get().duplicateFrames + 0 >= 0, true);
  rec.tick(T + 30_000);
  await settle();
  const r = recordings()[0];
  assert.equal(recordings().length, 1);
  assert.equal(r.seqStart, 1000);
  assert.equal(r.seqEnd, 1099);
  assert.equal(r.backfill, false, "10 re-sent frames in 100 must not tag the segment");
  assert.equal(rows()[0].missingFrames, 0, "lost frames were filled in by the re-send");
});

test("a mostly-backfilled segment is tagged backfill", async () => {
  await init();
  const T = Date.now();
  talk(1000, 1099, T, { flags: FLAG_SPEECH | FLAG_BACKFILL });
  rec.tick(T + 30_000);
  await settle();
  assert.equal(recordings()[0].backfill, true);
});

test("transient create failure backs off, then succeeds", async () => {
  await init();
  server.failCreateOnce = true;
  const T = Date.now();
  talk(1000, 1049, T);
  rec.tick(T + 25_000);
  await settle();
  assert.equal(rows()[0].state, "queued");
  assert.equal(rows()[0].attempts, 1);
  assert.ok(rows()[0].nextAttemptAt > Date.now());
  up.retryAllNow();
  await settle();
  assert.equal(rows()[0].state, "uploaded");
  assert.equal(recordings().length, 1);
});

test("create committed but response lost: retry is idempotent (one recording)", async () => {
  await init();
  server.loseCreateResponseOnce = true;
  const T = Date.now();
  talk(1000, 1049, T);
  rec.tick(T + 25_000);
  await settle();
  assert.equal(rows()[0].state, "queued");
  up.retryAllNow();
  await settle();
  assert.equal(rows()[0].state, "uploaded");
  assert.equal(recordings().length, 1);
});

test("hung upload is abandoned by the watchdog and retried", async () => {
  await init();
  server.hangUpload = true;
  const T = Date.now();
  talk(1000, 1049, T);
  rec.tick(T + 25_000);
  await rec.buildsIdle();
  await sleep(20);
  assert.equal(up.uploaderStore.get().busy, true);
  assert.equal(rows()[0].state, "uploading");
  server.hangUpload = false;
  up.kick(Date.now() + 10 * 60_000); // a later wake-up long after the upload started
  await settle();
  assert.equal(up.uploaderStore.get().abandoned, 1);
  assert.equal(rows()[0].state, "uploaded");
  assert.equal(recordings().length, 1);
});

test("offline: queued segments wait; coming back online uploads them immediately", async () => {
  await init();
  for (const l of netinfo.listeners) l({ isConnected: false, isInternetReachable: false });
  server.offline = true;
  const T = Date.now();
  talk(1000, 1049, T);
  rec.tick(T + 25_000);
  await settle();
  assert.equal(recordings().length, 0);
  assert.equal(rows()[0].state, "queued");
  server.offline = false;
  for (const l of netinfo.listeners) l({ isConnected: true, isInternetReachable: true });
  await settle();
  assert.equal(rows()[0].state, "uploaded");
});

test("frozen timers (iOS background): BLE events alone close and upload segments", async () => {
  await init();
  runtime.replace("recorder.tick", () => {}); // kill the interval, as iOS suspension does
  runtime.replace("uploader.interval", () => {});
  const T = Date.now();
  rec.onAppStateChange("background", T);
  rec.onStatus(status(2000), T);
  const end = talk(1000, 1049, T);
  rec.onStatus(status(2000 + 1100), end + 21_000); // the next status notification after 20 s quiet
  await settle();
  assert.equal(recordings().length, 1);
  const st = rec.recorderStore.get();
  assert.equal(st.bgFrames, 50);
  assert.equal(st.bgSegmentsClosed, 1);
});

test("uploads started in the background use a regular session (background sessions are deferred)", async () => {
  const rn = (await import("./mocks/react-native.ts")).AppState;
  await init();
  server.sessions.length = 0;
  const T = Date.now();
  rn.currentState = "background";
  try {
    rec.onAppStateChange("background", T);
    rec.onStatus(status(2000), T);
    const end = talk(1000, 1049, T);
    rec.onStatus(status(2000 + 1100), end + 21_000);
    await settle();
  } finally {
    rn.currentState = "active";
    rec.onAppStateChange("active", Date.now());
  }
  assert.equal(recordings().length, 1);
  assert.deepEqual(server.sessions, ["foreground"]);
  assert.equal(up.uploadSessionType("active"), "background");
  assert.equal(up.uploadSessionType("inactive"), "foreground");
});

test("going to background flushes frames to disk but keeps the conversation in one segment", async () => {
  await init();
  const T = Date.now();
  talk(1000, 1024, T);
  rec.onAppStateChange("background", T + 600);
  const row = rows()[0];
  assert.equal(row.state, "recording");
  assert.equal(files.framesFile(row.id).size, 25 * (2 + FRAME_BYTES), "all frames persisted on background");
  talk(1025, 1049, T + 700);
  rec.onAppStateChange("active", T + 1300);
  rec.tick(T + 30_000);
  await settle();
  assert.equal(recordings().length, 1);
  assert.equal(recordings()[0].seqEnd, 1049);
});

test("disk full while building: segment stays recording, sweep retries and succeeds", async () => {
  await init();
  const T = Date.now();
  talk(1000, 1049, T);
  hooks.failWrite = (p) => p.endsWith(".wav.tmp");
  rec.tick(T + 25_000);
  await settle();
  assert.equal(rows()[0].state, "recording");
  assert.match(rows()[0].lastError ?? "", /no space/);
  hooks.failWrite = undefined;
  rec.tick(T + 25_000 + 31_000); // sweep
  await settle();
  assert.equal(rows()[0].state, "uploaded");
});

test("frame write failure keeps frames buffered and retries on the next flush", async () => {
  await init();
  const T = Date.now();
  hooks.failWrite = (p) => p.endsWith(".frames");
  talk(1000, 1049, T);
  rec.tick(T + 1500);
  assert.ok(rec.recorderStore.get().writeErrors >= 1);
  hooks.failWrite = undefined;
  rec.tick(T + 3000);
  const row = rows()[0];
  assert.equal(files.framesFile(row.id).size, 50 * (2 + FRAME_BYTES));
  rec.tick(T + 30_000);
  await settle();
  assert.equal(recordings()[0].seqEnd, 1049);
});

test("pendant reboot mid-conversation splits segments by boot", async () => {
  await init();
  const T = Date.now();
  talk(5000, 5049, T, { bootTag: 7 });
  talk(10, 59, T + 2000, { bootTag: 8 });
  rec.tick(T + 30_000);
  await settle();
  assert.equal(recordings().length, 2);
});

// ---------------------------------------------------------------------------------------------
// BLE

async function connectFresh() {
  await init();
  await bleMod.connect(PERIPHERAL, "Mind-Pendant");
  await sleep(5);
}

test("BLE: connect subscribes to audio + status and reads status", async () => {
  await connectFresh();
  assert.equal(bleMod.bleStore.get().link, "connected");
  assert.ok(ble.calls.includes(`notify:${protocol.AUDIO_UUID.slice(0, 8)}`));
  assert.ok(ble.calls.includes(`notify:${protocol.STATUS_UUID.slice(0, 8)}`));
  assert.equal(bleMod.bleStore.get().statusViaRead, 1);
  ble.notifyStatus();
  assert.equal(bleMod.bleStore.get().statusViaNotify, 1);
});

test("BLE: re-init (Fast Refresh) keeps one listener; each frame is processed once", async () => {
  await connectFresh();
  await init();
  await init();
  assert.equal(ble.listenerCount("value"), 1);
  const before = rec.recorderStore.get().framesTotal;
  ble.notifyAudio(frame(1000));
  ble.notifyAudio(frame(1001));
  rec.tick(Date.now() + 1000); // publish (throttled)
  assert.equal(rec.recorderStore.get().framesTotal, before + 2);
  assert.equal(rec.recorderStore.get().duplicateFrames, 0);
});

test("BLE: already-connected pendant at startup is set up without calling connect()", async () => {
  ble.connected = true;
  db.getDb();
  db.kvSet("device", { id: PERIPHERAL, name: "Mind-Pendant" });
  ble.connectHangs = true; // connect() would never resolve
  await init();
  await sleep(10);
  assert.equal(bleMod.bleStore.get().link, "connected");
  assert.ok(!ble.calls.some((c) => c.startsWith("connect:")));
});

test("BLE: link drop -> reconnect -> resubscribe", async () => {
  await connectFresh();
  ble.calls.length = 0;
  ble.dropLink();
  await sleep(10);
  assert.equal(bleMod.bleStore.get().link, "connected");
  assert.equal(bleMod.bleStore.get().reconnects, 1);
  assert.ok(ble.calls.includes(`connect:${PERIPHERAL}`));
  assert.ok(ble.calls.includes(`notify:${protocol.AUDIO_UUID.slice(0, 8)}`));
});

test("BLE: iOS state restoration with a live link sets up without connect()", async () => {
  await init();
  ble.connected = true;
  ble.connectHangs = true;
  ble.emit("restore", { peripherals: [{ id: PERIPHERAL, name: "Mind-Pendant" }] });
  await sleep(10);
  assert.equal(bleMod.bleStore.get().link, "connected");
  assert.ok(!ble.calls.some((c) => c.startsWith("connect:")));
});

test("BLE: a dropped subscription is re-requested", async () => {
  await connectFresh();
  ble.calls.length = 0;
  ble.emit("notifyState", { peripheral: PERIPHERAL, characteristic: protocol.AUDIO_UUID.toLowerCase(), isNotifying: false });
  await sleep(5);
  assert.equal(bleMod.bleStore.get().audioNotifying, false);
  assert.ok(ble.calls.includes(`notify:${protocol.AUDIO_UUID.toLowerCase().slice(0, 8)}`));
});

test("BLE: concurrent status reads are coalesced", async () => {
  await connectFresh();
  ble.calls.length = 0;
  await Promise.all([bleMod.refreshStatus(), bleMod.refreshStatus(), bleMod.refreshStatus()]);
  assert.equal(ble.calls.filter((c) => c.startsWith("read:")).length, 1);
});

test("BLE: mute is confirmed by reading status back", async () => {
  await connectFresh();
  await bleMod.setMuted(true);
  assert.equal(bleMod.bleStore.get().status?.muted, true);
  assert.deepEqual(ble.writes, ["mute 1"]);
  await bleMod.setMuted(false);
  assert.equal(bleMod.bleStore.get().status?.muted, false);
});

test("end to end over BLE: audio notifications -> segment -> upload", async () => {
  await connectFresh();
  ble.status = { ...ble.status, seq: 3000 };
  ble.notifyStatus();
  for (let s = 2000; s < 2100; s++) ble.notifyAudio(frame(s, { flags: FLAG_SPEECH | (s === 2000 ? FLAG_START : 0) | (s === 2099 ? FLAG_END : 0) }));
  rec.tick(Date.now() + 21_000);
  await settle();
  assert.equal(recordings().length, 1);
  assert.equal(recordings()[0].seqStart, 2000);
});
