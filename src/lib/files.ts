// On-disk layout: <documents>/segments/<id>.frames (raw records) and <id>.wav (built on close).
//
// IMPORTANT: in expo-file-system (SDK 58) `File.write()` is ASYNC (returns a Promise). Everything
// here uses the *Sync variants so a write has really happened (or thrown) before we record state
// that depends on it. (The unawaited async write was why a large WAV could be "missing" when the
// uploader got to it first.)
import { Directory, File, Paths } from "expo-file-system";
import { encodeRecords } from "./segment";
import { WAV_HEADER_BYTES } from "./wav";

export const segmentsDir = new Directory(Paths.document, "segments");

export function ensureDirs() {
  if (!segmentsDir.exists) segmentsDir.create({ intermediates: true, idempotent: true });
}

export const framesFile = (id: string) => new File(segmentsDir, `${id}.frames`);
export const wavFile = (id: string) => new File(segmentsDir, `${id}.wav`);
const wavTmpFile = (id: string) => new File(segmentsDir, `${id}.wav.tmp`);

/** Expected WAV size for a 16 kHz mono 16-bit file of `durationMs` (20 ms slots). */
export function expectedWavBytes(durationMs: number): number {
  return WAV_HEADER_BYTES + (durationMs / 20) * 320 * 2;
}

/**
 * Write a WAV atomically: write <id>.wav.tmp synchronously, then move it over <id>.wav. A crash
 * mid-write leaves at most a stray .tmp, never a truncated .wav.
 */
export function writeWavAtomic(id: string, bytes: Uint8Array) {
  ensureDirs();
  const tmp = wavTmpFile(id);
  if (tmp.exists) tmp.delete();
  tmp.create();
  tmp.writeSync(bytes);
  const dest = wavFile(id);
  if (dest.exists) dest.delete();
  tmp.moveSync(dest);
  const check = wavFile(id);
  if (!check.exists || check.size !== bytes.length) {
    throw new Error(`WAV write verify failed (${check.exists ? check.size : "missing"} != ${bytes.length})`);
  }
}

/** True if the segment's WAV exists and has exactly the expected size. */
export function wavLooksComplete(id: string, durationMs: number | null): boolean {
  const f = wavFile(id);
  if (!f.exists) return false;
  if (durationMs == null) return f.size > WAV_HEADER_BYTES;
  return f.size === expectedWavBytes(durationMs);
}

export function deleteSegmentFiles(id: string) {
  for (const f of [framesFile(id), wavFile(id), wavTmpFile(id)]) {
    try {
      if (f.exists) f.delete();
    } catch {
      // best effort
    }
  }
}

/**
 * Buffered appender for one segment's frames file. Frames are kept in memory for at most
 * FLUSH_MS and then appended (synchronously) as length-prefixed records.
 */
export class FrameWriter {
  private pending: Uint8Array[] = [];
  readonly file: File;
  readonly segmentId: string;

  constructor(segmentId: string) {
    this.segmentId = segmentId;
    ensureDirs();
    this.file = framesFile(segmentId);
    if (!this.file.exists) this.file.create();
  }

  push(frame: Uint8Array) {
    // Copy: the caller's buffer may be reused.
    this.pending.push(frame.slice());
  }

  get pendingCount() {
    return this.pending.length;
  }

  /** Append everything buffered so far. Throws on IO errors; the frames stay buffered for retry. */
  flush() {
    if (!this.pending.length) return;
    const bytes = encodeRecords(this.pending);
    this.file.writeSync(bytes, { append: true });
    this.pending = [];
  }
}
