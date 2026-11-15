// Save-first recorder: every frame goes to disk (buffered <= 1 s), segments are closed into WAVs
// and queued for upload.
//
// Robustness rules:
// - All state lives in a runtime singleton (survives Fast Refresh; see runtime.ts).
// - Work is driven by incoming events (frames, Status) as well as a timer, because iOS freezes JS
//   timers while the app is suspended in the background but still wakes it for BLE events.
// - Crash/restart recovery runs once per JS runtime and never touches the segment being recorded.
// - A periodic sweep re-builds any segment stuck in "recording" (failed build, crash) and gives
//   broken segments whose frames still exist another try.
// - All file writes are synchronous (files.ts), so state is only recorded after the bytes exist.
import { randomUUID } from "expo-crypto";
import {
  brokenWithFiles,
  getSegment,
  insertSegment,
  kvGet,
  kvSet,
  segmentsInState,
  updateSegment,
  type SegmentRow,
} from "./db";
import { FrameWriter, deleteSegmentFiles, ensureDirs, framesFile, writeWavAtomic } from "./files";
import { FLAG_BACKFILL, FLAG_END, FLAG_START, SAMPLE_RATE, parseFrameHeader, type PendantStatus } from "./protocol";
import { replaceInterval, singleton } from "./runtime";
import {
  IDLE_CLOSE_MS,
  assemble,
  decide,
  decodeRecords,
  seqToWall,
  type Assembled,
  type ClockAnchor,
} from "./segment";
import { sharedStore } from "./store";
import { buildWav } from "./wav";

const FLUSH_MS = 1000;
const TICK_MIN_GAP_MS = 400;
const SWEEP_EVERY_MS = 30_000;
/** A "recording" row that isn't the open segment and is older than this gets (re)built. */
const ORPHAN_AFTER_MS = 5_000;
const PUBLISH_MIN_GAP_MS = 250;
const SEEN_MAX = 2048;

type OpenSegment = {
  id: string;
  bootTag: number;
  boot: number | null;
  seqStart: number;
  lastSeq: number;
  frameCount: number;
  lastFrameAt: number;
  writer: FrameWriter;
};

export type RecorderStats = {
  framesTotal: number;
  framesPerSec: number;
  backfillFrames: number;
  badFrames: number;
  duplicateFrames: number;
  /** Seq jumps without END before / START after (PROTOCOL §4 "Loss"). */
  lossEvents: number;
  lostFrames: number;
  /** Normal gated pauses (END ... START). */
  pauses: number;
  lastSeq: number | null;
  lastBootTag: number | null;
  lastFrameAt: number | null;
  openSegmentId: string | null;
  openSegmentFrames: number;
  openSegmentSince: number | null;
  /** App state as last reported ("active" | "background" | "inactive"). */
  appState: string;
  backgroundSince: number | null;
  /** Frames received while the app was not in the foreground (proves background BLE works). */
  bgFrames: number;
  bgBackfillFrames: number;
  bgSegmentsClosed: number;
  writeErrors: number;
  recoveredSegments: number;
  lastError: string | null;
  /** Bumps whenever the local segment list changes (UI refresh hint). */
  segmentsVersion: number;
};

const initialStats = (): RecorderStats => ({
  framesTotal: 0,
  framesPerSec: 0,
  backfillFrames: 0,
  badFrames: 0,
  duplicateFrames: 0,
  lossEvents: 0,
  lostFrames: 0,
  pauses: 0,
  lastSeq: null,
  lastBootTag: null,
  lastFrameAt: null,
  openSegmentId: null,
  openSegmentFrames: 0,
  openSegmentSince: null,
  appState: "active",
  backgroundSince: null,
  bgFrames: 0,
  bgBackfillFrames: 0,
  bgSegmentsClosed: 0,
  writeErrors: 0,
  recoveredSegments: 0,
  lastError: null,
  segmentsVersion: 0,
});

export const recorderStore = sharedStore<RecorderStats>("recorder", initialStats());

type State = {
  stats: RecorderStats;
  fpsWindow: number[];
  open: OpenSegment | null;
  lastFlushAt: number;
  prev: { seq: number; flags: number; bootTag: number } | null;
  currentBoot: number | null;
  anchors: Map<number, ClockAnchor>;
  anchorsLoaded: boolean;
  anchorsSavedAt: number;
  seen: Set<number>;
  seenOrder: number[];
  buildChain: Promise<void>;
  building: Set<string>;
  recovered: boolean;
  lastTickAt: number;
  lastSweepAt: number;
  lastPublishAt: number;
  onSegmentQueued: () => void;
};

const S = () =>
  singleton<State>("recorder", () => ({
    stats: initialStats(),
    fpsWindow: [],
    open: null,
    lastFlushAt: 0,
    prev: null,
    currentBoot: null,
    anchors: new Map(),
    anchorsLoaded: false,
    anchorsSavedAt: 0,
    seen: new Set(),
    seenOrder: [],
    buildChain: Promise.resolve(),
    building: new Set(),
    recovered: false,
    lastTickAt: 0,
    lastSweepAt: 0,
    lastPublishAt: 0,
    onSegmentQueued: () => {},
  }));

function setError(msg: string) {
  S().stats.lastError = msg;
}

function publish(force = false, now = Date.now()) {
  const s = S();
  if (!force && now - s.lastPublishAt < PUBLISH_MIN_GAP_MS) return;
  s.lastPublishAt = now;
  s.fpsWindow = s.fpsWindow.filter((t) => now - t < 2000);
  s.stats.framesPerSec = s.fpsWindow.length / 2;
  s.stats.openSegmentId = s.open?.id ?? null;
  s.stats.openSegmentFrames = s.open?.frameCount ?? 0;
  recorderStore.set({ ...s.stats });
}

export function bumpSegments() {
  S().stats.segmentsVersion++;
  publish(true);
}

function saveAnchors(force = false) {
  const s = S();
  const now = Date.now();
  if (!force && now - s.anchorsSavedAt < 10_000) return;
  s.anchorsSavedAt = now;
  try {
    kvSet("anchors", [...s.anchors.entries()]);
  } catch (e) {
    setError(`anchors save: ${(e as Error).message}`);
  }
}

function markSeen(bootTag: number, seq: number): boolean {
  const s = S();
  const key = bootTag * 2 ** 32 + seq;
  if (s.seen.has(key)) return false;
  s.seen.add(key);
  s.seenOrder.push(key);
  if (s.seenOrder.length > SEEN_MAX) s.seen.delete(s.seenOrder.shift()!);
  return true;
}

// ---------------------------------------------------------------------------------------------

/**
 * Idempotent: safe to call again after Fast Refresh. Crash recovery runs only on the first call
 * in a JS runtime (i.e. after a real app start or full reload).
 */
export function initRecorder(opts: { onSegmentQueued: () => void }) {
  const s = S();
  s.onSegmentQueued = opts.onSegmentQueued;
  ensureDirs();
  if (!s.anchorsLoaded) {
    s.anchorsLoaded = true;
    try {
      for (const [k, v] of kvGet<[number, ClockAnchor][]>("anchors") ?? []) {
        if (!s.anchors.has(k)) s.anchors.set(k, v);
      }
    } catch (e) {
      setError(`anchors load: ${(e as Error).message}`);
    }
  }
  if (!s.recovered) {
    s.recovered = true;
    recover(Date.now());
  }
  replaceInterval("recorder.tick", () => tick(), 500);
  publish(true);
}

/** Startup recovery (no segment is open yet in a fresh runtime). */
function recover(now: number) {
  for (const r of segmentsInState("uploading")) updateSegment(r.id, { state: "queued" });
  for (const r of segmentsInState("recording")) enqueueBuild(r.id);
  retryBroken();
  S().lastSweepAt = now;
}

/** Give broken segments whose raw frames still exist another build attempt. */
function retryBroken() {
  for (const r of brokenWithFiles()) {
    if (!framesFile(r.id).exists) continue;
    updateSegment(r.id, { state: "recording", lastError: `recovering (was: ${r.lastError ?? "broken"})` });
    S().stats.recoveredSegments++;
    enqueueBuild(r.id);
  }
}

/** Status from the pendant arrived at phone time `at` (PROTOCOL §8). */
export function onStatus(st: PendantStatus, at: number) {
  const s = S();
  const changed = s.currentBoot !== st.boot;
  s.currentBoot = st.boot;
  s.anchors.set(st.boot & 0xff, { boot: st.boot, seq: st.seq, at, exact: true });
  if (s.open && s.open.boot === null && s.open.bootTag === (st.boot & 0xff)) s.open.boot = st.boot;
  saveAnchors(changed);
  maybeTick(at);
}

/** Inject a clock anchor (used by the simulated pendant). */
export function setAnchor(bootTag: number, a: ClockAnchor) {
  S().anchors.set(bootTag, a);
}

export function onAppStateChange(state: string, now = Date.now()) {
  const s = S();
  const wasForeground = s.stats.appState === "active";
  s.stats.appState = state;
  if (state === "active") {
    s.stats.backgroundSince = null;
  } else if (wasForeground) {
    s.stats.backgroundSince = now;
    // Persist buffered frames now: iOS may suspend (or kill) us at any moment. The segment
    // itself stays open so locking the phone doesn't split a conversation.
    flush(now);
  }
  tick(now);
}

export function onFrame(bytes: Uint8Array, now = Date.now()) {
  const s = S();
  const st = s.stats;
  const h = parseFrameHeader(bytes);
  if (!h) {
    st.badFrames++;
    return;
  }
  st.framesTotal++;
  st.lastFrameAt = now;
  s.fpsWindow.push(now);
  if (s.fpsWindow.length > 400) s.fpsWindow.splice(0, s.fpsWindow.length - 200);
  if (!markSeen(h.bootTag, h.seq)) {
    st.duplicateFrames++;
    return;
  }
  const backfilled = (h.flags & FLAG_BACKFILL) !== 0;
  if (backfilled) st.backfillFrames++;
  if (st.appState !== "active") {
    st.bgFrames++;
    if (backfilled) st.bgBackfillFrames++;
  }

  // Gap accounting (display only).
  const p = s.prev;
  if (p && p.bootTag === h.bootTag && h.seq > p.seq + 1) {
    if (!(p.flags & FLAG_END) && !(h.flags & FLAG_START)) {
      st.lossEvents++;
      st.lostFrames += h.seq - p.seq - 1;
    } else {
      st.pauses++;
    }
  }
  if (!p || p.bootTag !== h.bootTag || h.seq > p.seq) s.prev = { seq: h.seq, flags: h.flags, bootTag: h.bootTag };
  st.lastSeq = h.seq;
  st.lastBootTag = h.bootTag;

  // Frames from a boot we have no Status for (old-boot backfill): time them relative to the
  // first frame received from them (PROTOCOL §5). An exact anchor always wins later.
  const known = s.anchors.get(h.bootTag);
  if (!known || (!known.exact && (h.seq < known.seq || now - known.at > 3600_000))) {
    s.anchors.set(h.bootTag, { boot: -1, seq: h.seq, at: now, exact: false });
  }

  const d = decide(s.open, h);
  if (d === "drop") {
    st.duplicateFrames++;
    return;
  }
  if (d === "new") {
    if (s.open) closeOpen(now);
    if (!openSegment(h.bootTag, h.seq, now)) return;
  }
  const o = s.open!;
  o.writer.push(bytes);
  o.lastSeq = Math.max(o.lastSeq, h.seq);
  o.frameCount++;
  o.lastFrameAt = now;
  maybeTick(now);
}

function openSegment(bootTag: number, seq: number, now: number): boolean {
  const s = S();
  const id = randomUUID();
  const boot = s.currentBoot !== null && (s.currentBoot & 0xff) === bootTag ? s.currentBoot : null;
  try {
    insertSegment({ id, bootTag, boot, seqStart: seq, firstFrameAt: now });
    s.open = { id, bootTag, boot, seqStart: seq, lastSeq: seq, frameCount: 0, lastFrameAt: now, writer: new FrameWriter(id) };
  } catch (e) {
    s.stats.writeErrors++;
    setError(`open segment: ${(e as Error).message}`);
    return false;
  }
  s.stats.openSegmentSince = now;
  bumpSegments();
  return true;
}

function flush(now = Date.now()): boolean {
  const s = S();
  s.lastFlushAt = now;
  const o = s.open;
  if (!o) return true;
  try {
    o.writer.flush();
    updateSegment(o.id, { seqEnd: o.lastSeq, frameCount: o.frameCount, boot: o.boot });
    return true;
  } catch (e) {
    s.stats.writeErrors++;
    setError(`write failed: ${(e as Error).message}`);
    return false;
  }
}

/** Close the open segment (if any) and queue it for building. */
export function closeOpen(now = Date.now()) {
  const s = S();
  const o = s.open;
  if (!o) return;
  flush(now);
  s.open = null;
  s.stats.openSegmentSince = null;
  if (s.stats.appState !== "active") s.stats.bgSegmentsClosed++;
  enqueueBuild(o.id);
}

function maybeTick(now: number) {
  if (now - S().lastTickAt >= TICK_MIN_GAP_MS) tick(now);
}

/** Periodic work. Called from a timer AND from incoming BLE events (timers freeze in background). */
export function tick(now = Date.now()) {
  const s = S();
  s.lastTickAt = now;
  if (s.open) {
    if (now - s.lastFlushAt >= FLUSH_MS) flush(now);
    if (now - s.open.lastFrameAt > IDLE_CLOSE_MS) closeOpen(now);
  }
  if (now - s.lastSweepAt >= SWEEP_EVERY_MS) {
    s.lastSweepAt = now;
    sweep(now);
  }
  publish(false, now);
}

/** Re-build orphaned "recording" rows (not the open one, not already building). */
function sweep(now: number) {
  const s = S();
  for (const r of segmentsInState("recording")) {
    if (r.id === s.open?.id || s.building.has(r.id)) continue;
    if (now - r.createdAt < ORPHAN_AFTER_MS) continue;
    enqueueBuild(r.id);
  }
}

// ---------------------------------------------------------------------------------------------

function enqueueBuild(id: string) {
  const s = S();
  if (s.building.has(id)) return;
  s.building.add(id);
  s.buildChain = s.buildChain
    .then(() => buildSegment(id))
    .catch((e) => {
      const msg = `build ${id.slice(0, 8)}: ${(e as Error).message}`;
      setError(msg);
      try {
        updateSegment(id, { lastError: msg });
      } catch {
        // ignore
      }
    })
    .finally(() => {
      S().building.delete(id);
      bumpSegments();
    });
}

/** Wait for all queued builds (tests, and the uploader before declaring a WAV missing). */
export function buildsIdle(): Promise<void> {
  return S().buildChain;
}

/** Decode a segment's frames file and write its WAV. Returns null if there is nothing usable. */
async function assembleAndWrite(id: string): Promise<Assembled | null> {
  const ff = framesFile(id);
  const frames = ff.exists ? decodeRecords(await ff.bytes()) : [];
  const a = assemble(frames);
  if (!a) return null;
  writeWavAtomic(id, buildWav(a.samples, SAMPLE_RATE));
  return a;
}

function metaFor(row: SegmentRow, a: Assembled) {
  const anchor = S().anchors.get(a.bootTag);
  const boot = row.boot ?? (anchor?.exact ? anchor.boot : null);
  const exact = !!anchor?.exact && (row.boot === null || anchor.boot === row.boot);
  const startedAt = anchor ? Math.round(seqToWall(anchor, a.seqStart)) : row.firstFrameAt;
  return {
    boot,
    seqStart: a.seqStart,
    seqEnd: a.seqEnd,
    frameCount: a.frameCount,
    missingFrames: a.missingFrames,
    backfill: a.backfill ? 1 : 0,
    startedAt,
    timeApprox: exact ? 0 : 1,
    durationMs: a.durationMs,
    levels: a.levels,
  };
}

/** Decode a closed segment's frames into a WAV + levels and mark it queued. */
async function buildSegment(id: string) {
  const s = S();
  if (id === s.open?.id) return; // never build the segment that is still recording
  const row = getSegment(id);
  if (!row || row.state !== "recording") return;
  const a = await assembleAndWrite(id);
  if (S().open?.id === id) return; // (paranoia: reopened while we were reading)
  if (!a) {
    updateSegment(id, { state: "broken", closedAt: Date.now(), lastError: "no valid frames" });
    return;
  }
  updateSegment(id, { state: "queued", closedAt: Date.now(), nextAttemptAt: 0, lastError: null, ...metaFor(row, a) });
  s.onSegmentQueued();
}

/**
 * Re-create a queued segment's WAV from its frames file (WAV missing or wrong size). Returns
 * false if the frames are gone too. Used by the uploader instead of giving up.
 */
export async function rebuildWav(id: string): Promise<boolean> {
  const row = getSegment(id);
  if (!row || row.source !== "pendant") return false;
  const a = await assembleAndWrite(id);
  if (!a) return false;
  updateSegment(id, metaFor(row, a));
  return true;
}

/** Queue an already-built WAV (bypasses BLE), e.g. a bundled test clip. */
export function queueWav(opts: { wav: Uint8Array; levels: Uint8Array; durationMs: number; source: string }): string {
  const id = randomUUID();
  const now = Date.now();
  ensureDirs();
  writeWavAtomic(id, opts.wav);
  insertSegment({ id, bootTag: 0, boot: 0, seqStart: 0, firstFrameAt: now, source: opts.source });
  updateSegment(id, {
    state: "queued",
    closedAt: now,
    seqEnd: opts.durationMs / 20 - 1,
    frameCount: opts.durationMs / 20,
    startedAt: now - opts.durationMs,
    durationMs: opts.durationMs,
    levels: opts.levels,
  });
  bumpSegments();
  S().onSegmentQueued();
  return id;
}

export function deleteLocalSegment(row: Pick<SegmentRow, "id">) {
  deleteSegmentFiles(row.id);
  updateSegment(row.id, { filesDeleted: 1 });
  bumpSegments();
}
