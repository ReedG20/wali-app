// Pure segmenting + assembly logic (no React Native imports; unit-tested with node).
import { decodeAdpcm } from "./adpcm.ts";
import {
  FLAG_BACKFILL,
  FRAME_BYTES,
  FRAME_HEADER_BYTES,
  FRAME_MS,
  SAMPLES_PER_FRAME,
  parseFrameHeader,
  type FrameHeader,
} from "./protocol.ts";

/** A seq gap shorter than this stays in the same segment (pauses between gated stretches). */
export const GAP_FRAMES = 20_000 / FRAME_MS; // 20 s
/** Max segment length in audio time. */
export const MAX_SEGMENT_FRAMES = (5 * 60_000) / FRAME_MS; // 5 min
/**
 * After a reconnect the pendant re-sends up to its last 32 frames (PROTOCOL v2 §5). A frame this
 * far behind the newest one is a late re-send and still belongs to the open segment.
 */
export const RESEND_WINDOW_FRAMES = 64;
/** Close the open segment after this much wall time without frames. */
export const IDLE_CLOSE_MS = 20_000;

export type OpenSegmentInfo = {
  bootTag: number;
  seqStart: number;
  lastSeq: number;
};

export type Decision = "append" | "drop" | "new";

/** Where does an incoming frame go, relative to the open segment? */
export function decide(cur: OpenSegmentInfo | null, h: FrameHeader): Decision {
  if (!cur) return "new";
  if (h.bootTag !== cur.bootTag) return "new"; // boot change (or backfill from another boot)
  if (h.seq === cur.lastSeq) return "drop"; // duplicate
  if (h.seq < cur.lastSeq) {
    // Late re-sent frame (assemble() sorts by seq), or a reboot that reused the tag.
    return h.seq >= cur.seqStart && cur.lastSeq - h.seq <= RESEND_WINDOW_FRAMES ? "append" : "new";
  }
  if (h.seq - cur.lastSeq > GAP_FRAMES) return "new";
  if (h.seq - cur.seqStart >= MAX_SEGMENT_FRAMES) return "new";
  return "append";
}

// ---- on-disk record format: [u16 LE length][frame bytes] ----

export function encodeRecords(frames: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const f of frames) total += 2 + f.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const f of frames) {
    out[o] = f.length & 0xff;
    out[o + 1] = f.length >> 8;
    out.set(f, o + 2);
    o += 2 + f.length;
  }
  return out;
}

/** Parse records; a truncated tail (crash mid-write) is ignored. */
export function decodeRecords(bytes: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let o = 0;
  while (o + 2 <= bytes.length) {
    const len = bytes[o] | (bytes[o + 1] << 8);
    if (len === 0 || o + 2 + len > bytes.length) break;
    out.push(bytes.subarray(o + 2, o + 2 + len));
    o += 2 + len;
  }
  return out;
}

// ---- assembly: frames -> linear PCM + levels ----

export type Assembled = {
  bootTag: number;
  seqStart: number;
  /** Inclusive. */
  seqEnd: number;
  frameCount: number;
  /** Slots with no frame (gated pauses or loss), filled with silence. */
  missingFrames: number;
  backfill: boolean;
  backfillFrames: number;
  samples: Int16Array;
  /** uint16 LE per 20 ms slot: frame RMS, 0 for gap-filled slots. */
  levels: Uint8Array;
  durationMs: number;
};

/**
 * Decode a segment's frames into one linear timeline by seq (gaps -> silence, so WAV time is
 * linear in seq). Frames must share a bootTag (the segmenter guarantees it); others are dropped.
 */
export function assemble(frames: Uint8Array[]): Assembled | null {
  const parsed: { h: FrameHeader; f: Uint8Array }[] = [];
  for (const f of frames) {
    if (f.length !== FRAME_BYTES) continue;
    const h = parseFrameHeader(f);
    if (h) parsed.push({ h, f });
  }
  if (!parsed.length) return null;
  const bootTag = parsed[0].h.bootTag;
  const byseq = new Map<number, { h: FrameHeader; f: Uint8Array }>();
  for (const p of parsed) if (p.h.bootTag === bootTag && !byseq.has(p.h.seq)) byseq.set(p.h.seq, p);
  const seqs = [...byseq.keys()].sort((a, b) => a - b);
  const seqStart = seqs[0];
  // Safety cap against corrupt data: never build more than max length + one gap.
  const cap = seqStart + MAX_SEGMENT_FRAMES + GAP_FRAMES;
  const kept = seqs.filter((s) => s < cap);
  const seqEnd = kept[kept.length - 1];
  const slots = seqEnd - seqStart + 1;

  const samples = new Int16Array(slots * SAMPLES_PER_FRAME);
  const levels = new Uint8Array(slots * 2);
  let backfillFrames = 0;
  for (const s of kept) {
    const { h, f } = byseq.get(s)!;
    const slot = s - seqStart;
    decodeAdpcm(f.subarray(FRAME_HEADER_BYTES), h.predictor, h.stepIndex, samples, slot * SAMPLES_PER_FRAME);
    // A frame with RMS 0 is still real audio; store 1 so 0 keeps meaning "gap".
    const lvl = Math.max(1, h.level);
    levels[slot * 2] = lvl & 0xff;
    levels[slot * 2 + 1] = lvl >> 8;
    if (h.flags & FLAG_BACKFILL) backfillFrames++;
  }
  return {
    bootTag,
    seqStart,
    seqEnd,
    frameCount: kept.length,
    missingFrames: slots - kept.length,
    // "Backfill" = mostly delivered late from the pendant's store. A reconnect re-sends up to 32
    // recent frames with BACKFILL set, and a slow link can route a few through the store; neither
    // should tag a live conversation.
    backfill: backfillFrames * 2 > kept.length,
    backfillFrames,
    samples,
    levels,
    durationMs: slots * FRAME_MS,
  };
}

// ---- wall clock (PROTOCOL §8) ----

/** A Status observation: at phone time `at`, the board was recording `seq` of boot `boot`. */
export type ClockAnchor = { boot: number; seq: number; at: number; exact: boolean };

/** Wall-clock ms of the start of frame `seq`: T − (status.seq − s) × 20 ms. */
export function seqToWall(anchor: ClockAnchor, seq: number): number {
  return anchor.at - (anchor.seq - seq) * FRAME_MS;
}
