// Local SQLite queue of audio segments. A row exists from the moment a segment opens, so a crash
// never loses track of frames already on disk.
import * as SQLite from "expo-sqlite";
import { singleton } from "./runtime";

export type SegmentState =
  | "recording" // frames being appended to the .frames file
  | "queued" // WAV built, waiting for upload
  | "uploading"
  | "uploaded" // recordings.create succeeded
  | "broken"; // could not be built (no valid frames); kept for inspection

export type SegmentRow = {
  id: string;
  state: SegmentState;
  bootTag: number;
  /** Full boot id if known (frames of the current boot), else null. */
  boot: number | null;
  seqStart: number;
  seqEnd: number;
  frameCount: number;
  missingFrames: number;
  backfill: number;
  /** Phone time the first frame arrived. */
  firstFrameAt: number;
  createdAt: number;
  closedAt: number | null;
  startedAt: number | null;
  timeApprox: number;
  durationMs: number | null;
  levels: Uint8Array | null;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  recordingId: string | null;
  uploadedAt: number | null;
  filesDeleted: number;
  /** "pendant" or "test". */
  source: string;
};

const conn = () => singleton("db", () => ({ db: null as SQLite.SQLiteDatabase | null }));

export function getDb(): SQLite.SQLiteDatabase {
  const c = conn();
  if (c.db) return c.db;
  const db = SQLite.openDatabaseSync("mind.db");
  db.execSync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS segments (
      id TEXT PRIMARY KEY NOT NULL,
      state TEXT NOT NULL,
      bootTag INTEGER NOT NULL,
      boot INTEGER,
      seqStart INTEGER NOT NULL,
      seqEnd INTEGER NOT NULL,
      frameCount INTEGER NOT NULL DEFAULT 0,
      missingFrames INTEGER NOT NULL DEFAULT 0,
      backfill INTEGER NOT NULL DEFAULT 0,
      firstFrameAt INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      closedAt INTEGER,
      startedAt INTEGER,
      timeApprox INTEGER NOT NULL DEFAULT 0,
      durationMs INTEGER,
      levels BLOB,
      attempts INTEGER NOT NULL DEFAULT 0,
      nextAttemptAt INTEGER NOT NULL DEFAULT 0,
      lastError TEXT,
      recordingId TEXT,
      uploadedAt INTEGER,
      filesDeleted INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'pendant'
    );
    CREATE INDEX IF NOT EXISTS segments_state ON segments(state, nextAttemptAt);
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL);
  `);
  c.db = db;
  return db;
}

export function kvGet<T>(k: string): T | null {
  const row = getDb().getFirstSync<{ v: string }>("SELECT v FROM kv WHERE k = ?", [k]);
  return row ? (JSON.parse(row.v) as T) : null;
}

export function kvSet(k: string, v: unknown) {
  getDb().runSync("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", [k, JSON.stringify(v)]);
}

export function insertSegment(s: {
  id: string;
  bootTag: number;
  boot: number | null;
  seqStart: number;
  firstFrameAt: number;
  source?: string;
}) {
  const now = Date.now();
  getDb().runSync(
    `INSERT INTO segments (id, state, bootTag, boot, seqStart, seqEnd, firstFrameAt, createdAt, source)
     VALUES (?, 'recording', ?, ?, ?, ?, ?, ?, ?)`,
    [s.id, s.bootTag, s.boot, s.seqStart, s.seqStart, s.firstFrameAt, now, s.source ?? "pendant"],
  );
}

export function updateSegment(id: string, patch: Partial<Omit<SegmentRow, "id">>) {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(", ");
  const values = keys.map((k) => {
    const v = patch[k];
    return v === undefined ? null : (v as SQLite.SQLiteBindValue);
  });
  getDb().runSync(`UPDATE segments SET ${sets} WHERE id = ?`, [...values, id]);
}

export function getSegment(id: string): SegmentRow | null {
  return getDb().getFirstSync<SegmentRow>("SELECT * FROM segments WHERE id = ?", [id]);
}

export function segmentsInState(state: SegmentState): SegmentRow[] {
  return getDb().getAllSync<SegmentRow>(
    "SELECT * FROM segments WHERE state = ? ORDER BY createdAt",
    [state],
  );
}

/** Next segment ready for an upload attempt. */
export function nextUploadable(now: number): SegmentRow | null {
  return getDb().getFirstSync<SegmentRow>(
    `SELECT * FROM segments WHERE state = 'queued' AND nextAttemptAt <= ?
     ORDER BY createdAt LIMIT 1`,
    [now],
  );
}

export function earliestRetryAt(): number | null {
  const r = getDb().getFirstSync<{ t: number | null }>(
    "SELECT MIN(nextAttemptAt) AS t FROM segments WHERE state = 'queued'",
  );
  return r?.t ?? null;
}

/** Recent segments for the UI (without the levels blob). */
export function recentSegments(limit = 100): Omit<SegmentRow, "levels">[] {
  return getDb().getAllSync(
    `SELECT id, state, bootTag, boot, seqStart, seqEnd, frameCount, missingFrames, backfill,
            firstFrameAt, createdAt, closedAt, startedAt, timeApprox, durationMs, attempts,
            nextAttemptAt, lastError, recordingId, uploadedAt, filesDeleted, source
     FROM segments ORDER BY createdAt DESC LIMIT ?`,
    [limit],
  );
}

export function stateCounts(): Record<SegmentState, number> {
  const out: Record<SegmentState, number> = {
    recording: 0,
    queued: 0,
    uploading: 0,
    uploaded: 0,
    broken: 0,
  };
  for (const r of getDb().getAllSync<{ state: SegmentState; n: number }>(
    "SELECT state, COUNT(*) AS n FROM segments GROUP BY state",
  )) {
    out[r.state] = r.n;
  }
  return out;
}

/** Uploaded segments whose local files are old enough to delete. */
export function expiredUploaded(before: number): { id: string }[] {
  return getDb().getAllSync(
    "SELECT id FROM segments WHERE state = 'uploaded' AND filesDeleted = 0 AND uploadedAt < ?",
    [before],
  );
}

/** Broken segments whose raw frames are still on disk (worth one rebuild attempt). */
export function brokenWithFiles(): SegmentRow[] {
  return getDb().getAllSync<SegmentRow>(
    "SELECT * FROM segments WHERE state = 'broken' AND filesDeleted = 0 ORDER BY createdAt",
  );
}

export function resetBackoff() {
  getDb().runSync("UPDATE segments SET nextAttemptAt = 0 WHERE state = 'queued'");
}
