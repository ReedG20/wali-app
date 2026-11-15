// Uploads queued segments: generateUploadUrl -> POST WAV -> recordings.create (idempotent on
// clientId = segment id; the backend also deletes the extra blob of a duplicate upload).
//
// Robustness rules:
// - State lives in SQLite (survives restarts) and in a runtime singleton (survives Fast Refresh).
// - Uses ConvexHttpClient (plain HTTPS), not the WebSocket client, so it works when the app is
//   woken briefly in the background.
// - kick() is called from timers AND from BLE events (timers freeze in the background).
// - A watchdog abandons an upload that has been "in flight" too long (e.g. a promise that never
//   settled while suspended); the superseded loop can no longer write state. Retrying is safe
//   because create() is idempotent.
// - A missing or truncated WAV is rebuilt from the segment's frames file before giving up.
import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
import { api, convexHttp } from "./convex";
import { earliestRetryAt, expiredUploaded, getSegment, nextUploadable, resetBackoff, updateSegment, type SegmentRow } from "./db";
import { wavFile, wavLooksComplete } from "./files";
import { buildsIdle, bumpSegments, deleteLocalSegment, rebuildWav } from "./recorder";
import { replace, singleton } from "./runtime";
import { sharedStore } from "./store";

const KEEP_LOCAL_MS = 3 * 24 * 3600 * 1000;
const CALL_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
/** An upload in flight longer than this is considered hung and abandoned. */
const STUCK_MS = UPLOAD_TIMEOUT_MS + 60_000;
const MAX_BACKOFF_MS = 10 * 60_000;
/** While NetInfo says offline, still probe this often (NetInfo can be stale in the background). */
const OFFLINE_PROBE_MS = 60_000;
const KICK_SOON_MIN_GAP_MS = 2_000;

export const uploaderStore = sharedStore("uploader", {
  online: true,
  busy: false,
  current: null as string | null,
  lastError: null as string | null,
  uploadedThisSession: 0,
  lastSuccessAt: null as number | null,
  abandoned: 0,
});

type State = {
  running: boolean;
  gen: number;
  currentId: string | null;
  currentStartedAt: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
  lastKickSoonAt: number;
  lastOfflineProbeAt: number;
  /** A kick arrived while the loop was running: look again before exiting (no lost wake-ups). */
  rekick: boolean;
};

const S = () =>
  singleton<State>("uploader", () => ({
    running: false,
    gen: 0,
    currentId: null,
    currentStartedAt: 0,
    retryTimer: null,
    lastKickSoonAt: 0,
    lastOfflineProbeAt: 0,
    rekick: false,
  }));

class Superseded extends Error {}

function withTimeout<T>(p: Promise<T>, what: string, ms = CALL_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function setOnline(online: boolean) {
  const was = uploaderStore.get().online;
  uploaderStore.set({ online });
  if (online && !was) {
    // Back online: don't sit out long backoffs accumulated while offline.
    resetBackoff();
    kick();
  }
}

/** Idempotent (Fast Refresh safe). */
export function initUploader() {
  const unsub = NetInfo.addEventListener((st) => {
    setOnline(st.isConnected !== false && st.isInternetReachable !== false);
  });
  replace("uploader.netinfo", unsub);
  const h = setInterval(kick, 30_000);
  replace("uploader.interval", () => clearInterval(h));
  try {
    cleanup();
  } catch {
    // never block startup on cleanup
  }
  kick();
}

/** Throttled kick for hot paths (BLE events). */
export function kickSoon(now = Date.now()) {
  const s = S();
  if (now - s.lastKickSoonAt < KICK_SOON_MIN_GAP_MS) return;
  s.lastKickSoonAt = now;
  kick(now);
}

/** Start the upload loop if it isn't running (or is hung). Safe to call any time. */
export function kick(now = Date.now()) {
  const s = S();
  if (s.running) {
    if (s.currentId && now - s.currentStartedAt > STUCK_MS) {
      // Watchdog: abandon the hung loop; it can no longer write state (gen check).
      const id = s.currentId;
      s.gen++;
      s.running = false;
      s.currentId = null;
      const row = getSegment(id);
      if (row?.state === "uploading") updateSegment(id, { state: "queued", lastError: "upload hung; retrying" });
      uploaderStore.set({ abandoned: uploaderStore.get().abandoned + 1 });
    } else {
      s.rekick = true;
      return;
    }
  }
  s.running = true;
  s.rekick = false;
  const gen = ++s.gen;
  uploaderStore.set({ busy: true });
  void loop(gen).finally(() => {
    if (S().gen !== gen) return; // superseded by the watchdog
    S().running = false;
    S().currentId = null;
    uploaderStore.set({ busy: false, current: null });
    if (S().rekick) {
      S().rekick = false;
      kick();
      return;
    }
    scheduleRetry();
  });
}

async function loop(gen: number) {
  for (;;) {
    if (S().gen !== gen) return;
    if (!uploaderStore.get().online) {
      const now = Date.now();
      if (now - S().lastOfflineProbeAt < OFFLINE_PROBE_MS) return;
      S().lastOfflineProbeAt = now;
    }
    S().rekick = false; // anything queued before this query is seen by it
    const seg = nextUploadable(Date.now());
    if (!seg) return;
    await uploadOne(seg, gen);
  }
}

function scheduleRetry() {
  const s = S();
  if (s.retryTimer) clearTimeout(s.retryTimer);
  s.retryTimer = null;
  const t = earliestRetryAt();
  if (t === null) return;
  s.retryTimer = setTimeout(() => kick(), Math.max(1000, t - Date.now()));
}

/**
 * Which iOS URLSession carries the WAV. A background session survives suspension, but iOS treats
 * a background-session transfer started while the app is in the background as discretionary
 * (URLSessionConfiguration.isDiscretionary is forced on): it can wait for Wi-Fi, power or "a good
 * time", and Low Power Mode makes it worse. That held live audio for 25-100 min on 2026-11-14.
 * While backgrounded we are awake anyway (BLE events every <= 2 s), so use a regular session then.
 */
export function uploadSessionType(state: string | null | undefined = AppState.currentState): "background" | "foreground" {
  return state === "active" ? "background" : "foreground";
}

/** Make sure the WAV on disk is complete; rebuild it from the frames file if not. */
async function ensureWav(seg: SegmentRow): Promise<boolean> {
  if (wavLooksComplete(seg.id, seg.durationMs)) return true;
  await buildsIdle(); // a build of this segment might be finishing right now
  const fresh = getSegment(seg.id);
  if (fresh && wavLooksComplete(seg.id, fresh.durationMs)) return true;
  if (!(await rebuildWav(seg.id))) return false;
  const rebuilt = getSegment(seg.id);
  return !!rebuilt && wavLooksComplete(seg.id, rebuilt.durationMs);
}

async function uploadOne(seg: SegmentRow, gen: number) {
  const s = S();
  const check = () => {
    if (S().gen !== gen) throw new Superseded();
  };
  s.currentId = seg.id;
  s.currentStartedAt = Date.now();
  uploaderStore.set({ current: seg.id });
  updateSegment(seg.id, { state: "uploading" });
  bumpSegments();
  try {
    if (!(await ensureWav(seg))) {
      check();
      updateSegment(seg.id, { state: "broken", lastError: "audio missing (no WAV and no usable frames)" });
      return;
    }
    check();
    const row = getSegment(seg.id) ?? seg; // metadata may have been refreshed by a rebuild
    const url = await withTimeout(convexHttp.mutation(api.recordings.generateUploadUrl, {}), "generateUploadUrl");
    check();
    const res = await withTimeout(
      wavFile(row.id).upload(url, {
        httpMethod: "POST",
        headers: { "Content-Type": "audio/wav" },
        sessionType: uploadSessionType(),
      }),
      "WAV upload",
      UPLOAD_TIMEOUT_MS,
    );
    check();
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`upload HTTP ${res.status}: ${String(res.body).slice(0, 120)}`);
    }
    const { storageId } = JSON.parse(res.body) as { storageId: string };
    const levels = row.levels ?? new Uint8Array(0);
    const created = await withTimeout(
      convexHttp.mutation(api.recordings.create, {
        clientId: row.id,
        storageId,
        boot: row.boot ?? row.bootTag,
        seqStart: row.seqStart,
        seqEnd: row.seqEnd,
        startedAt: row.startedAt ?? row.firstFrameAt,
        timeApprox: row.timeApprox === 1,
        durationMs: row.durationMs ?? (row.seqEnd - row.seqStart + 1) * 20,
        // Copy into a standalone ArrayBuffer (SQLite blobs may be views into a larger buffer).
        levels: levels.slice().buffer as ArrayBuffer,
        backfill: row.backfill === 1,
      }),
      "recordings.create",
    );
    check();
    updateSegment(row.id, { state: "uploaded", recordingId: created.id, uploadedAt: Date.now(), lastError: null });
    uploaderStore.set({
      uploadedThisSession: uploaderStore.get().uploadedThisSession + 1,
      lastError: null,
      lastSuccessAt: Date.now(),
    });
    if (!uploaderStore.get().online) setOnline(true); // NetInfo was stale
  } catch (e) {
    if (e instanceof Superseded) return;
    if (S().gen !== gen) return;
    const attempts = seg.attempts + 1;
    const backoff = Math.min(MAX_BACKOFF_MS, 5000 * 2 ** Math.min(attempts - 1, 10));
    const msg = e instanceof Error ? e.message : String(e);
    updateSegment(seg.id, { state: "queued", attempts, nextAttemptAt: Date.now() + backoff, lastError: msg });
    uploaderStore.set({ lastError: msg });
  } finally {
    if (S().gen === gen) S().currentId = null;
    bumpSegments();
  }
}

/** Delete local audio of segments uploaded more than KEEP_LOCAL_MS ago. */
function cleanup() {
  for (const s of expiredUploaded(Date.now() - KEEP_LOCAL_MS)) deleteLocalSegment(s);
}

/** Retry everything now (ignores backoff). */
export function retryAllNow() {
  resetBackoff();
  kick();
}
