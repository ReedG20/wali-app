// Pendant <-> phone BLE contract v1. Source of truth: firmware/PROTOCOL.md (do not drift).

export const SERVICE_UUID = "5C1B0001-9A3E-4F7B-8D2C-6E5F4A3B2C1D";
export const AUDIO_UUID = "5C1B0002-9A3E-4F7B-8D2C-6E5F4A3B2C1D";
export const STATUS_UUID = "5C1B0003-9A3E-4F7B-8D2C-6E5F4A3B2C1D";
export const CONTROL_UUID = "5C1B0004-9A3E-4F7B-8D2C-6E5F4A3B2C1D";
export const DEVICE_NAME = "Mind-Pendant";
export const PROTOCOL_VERSION = 2;

export const FRAME_BYTES = 172;
export const FRAME_HEADER_BYTES = 12;
export const SAMPLES_PER_FRAME = 320;
export const SAMPLE_RATE = 16000;
export const FRAME_MS = 20;
/** Notifications must carry a whole frame: ATT MTU >= 175 (payload = MTU - 3). */
export const MIN_MTU = 175;

export const FLAG_SPEECH = 1;
export const FLAG_START = 2;
export const FLAG_END = 4;
export const FLAG_BACKFILL = 8;
export const CODEC_IMA_ADPCM = 1;

export type FrameHeader = {
  seq: number;
  level: number;
  flags: number;
  codec: number;
  predictor: number;
  stepIndex: number;
  bootTag: number;
};

/** Parse the 12-byte header of a 172-byte audio frame. Returns null if malformed. */
export function parseFrameHeader(b: Uint8Array): FrameHeader | null {
  if (b.length !== FRAME_BYTES) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const h: FrameHeader = {
    seq: dv.getUint32(0, true),
    level: dv.getUint16(4, true),
    flags: dv.getUint8(6),
    codec: dv.getUint8(7),
    predictor: dv.getInt16(8, true),
    stepIndex: dv.getUint8(10),
    bootTag: dv.getUint8(11),
  };
  if (h.codec !== CODEC_IMA_ADPCM || h.stepIndex > 88) return null;
  return h;
}

export type PendantStatus = {
  v: number;
  fw: string;
  boot: number;
  seq: number;
  muted: boolean;
  mode: "gated" | "all" | string;
  lvl: number;
  nf: number;
  wake: number;
  gain: number;
  buf: number;
  lost: number;
  sd: number;
  sdFree: number;
};

export function parseStatus(b: Uint8Array): PendantStatus | null {
  try {
    let s = "";
    for (const c of b) s += String.fromCharCode(c);
    const j = JSON.parse(s);
    if (typeof j !== "object" || j === null || typeof j.boot !== "number" || typeof j.seq !== "number") {
      return null;
    }
    return j as PendantStatus;
  } catch {
    return null;
  }
}

export function levelToDbfs(level: number): number {
  return level > 0 ? 20 * Math.log10(level / 32768) : -Infinity;
}

export function encodeCommand(cmd: string): number[] {
  return Array.from(cmd, (c) => c.charCodeAt(0) & 0x7f);
}
