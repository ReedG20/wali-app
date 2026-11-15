// Wires BLE -> recorder -> uploader together and provides debug helpers.
import { Asset } from "expo-asset";
import { File } from "expo-file-system";
import { AppState } from "react-native";
import { encodeAdpcm } from "./adpcm";
import { initBle, setForeground } from "./ble";
import { getDb } from "./db";
import { FLAG_END, FLAG_SPEECH, FLAG_START, FRAME_BYTES, SAMPLES_PER_FRAME, SAMPLE_RATE } from "./protocol";
import { closeOpen, initRecorder, onAppStateChange, onFrame, queueWav, setAnchor } from "./recorder";
import { replace } from "./runtime";
import { setUiActive } from "./store";
import { initUploader, kick } from "./uploader";
import { buildWav, parseWav } from "./wav";

/**
 * Wire BLE -> recorder -> uploader. Idempotent: Fast Refresh re-runs this, and every init*
 * replaces its own listeners/intervals instead of adding new ones (see runtime.ts).
 */
export function startPipeline() {
  getDb();
  initRecorder({ onSegmentQueued: () => kick() });
  initUploader();
  void initBle();
  const onState = (st: string) => {
    setUiActive(st === "active");
    onAppStateChange(st);
    setForeground(st === "active");
    if (st === "active") kick();
  };
  onState(AppState.currentState ?? "active");
  const sub = AppState.addEventListener("change", onState);
  replace("pipeline.appState", () => sub.remove());
}

const TEST_CLIP = require("../../assets/audio/test-clip.wav");

async function loadTestClip(): Promise<Int16Array> {
  const asset = Asset.fromModule(TEST_CLIP);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error("test clip not available");
  const { samples, sampleRate } = parseWav(await new File(asset.localUri).bytes());
  if (sampleRate !== SAMPLE_RATE) throw new Error(`test clip must be ${SAMPLE_RATE} Hz`);
  return samples;
}

function rms(s: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s[i] * s[i];
  return Math.min(32767, Math.round(Math.sqrt(sum / Math.max(1, s.length))));
}

/** Upload the bundled clip directly as a finished segment (tests upload + transcription). */
export async function uploadTestClip(): Promise<string> {
  const samples = await loadTestClip();
  const slots = Math.floor(samples.length / SAMPLES_PER_FRAME);
  const pcm = samples.subarray(0, slots * SAMPLES_PER_FRAME);
  const levels = new Uint8Array(slots * 2);
  for (let i = 0; i < slots; i++) {
    const l = Math.max(1, rms(pcm.subarray(i * SAMPLES_PER_FRAME, (i + 1) * SAMPLES_PER_FRAME)));
    levels[i * 2] = l & 0xff;
    levels[i * 2 + 1] = l >> 8;
  }
  return queueWav({ wav: buildWav(pcm, SAMPLE_RATE), levels, durationMs: slots * 20, source: "test" });
}

const SIM_BOOT = 0x51a0_00ee;

/**
 * Feed the bundled clip through the full phone pipeline as if a pendant sent it: ADPCM-encode
 * into 172-byte frames -> recorder (disk, segmenter, decode, WAV) -> uploader.
 */
export async function simulatePendant(): Promise<number> {
  const samples = await loadTestClip();
  const frames = Math.floor(samples.length / SAMPLES_PER_FRAME);
  // Seq from the wall clock: never repeats across runs or reloads (the recorder dedupes by seq).
  const seq0 = Math.floor(Date.now() / 20) % 2 ** 31;
  const state = { predictor: 0, stepIndex: 0 };
  const now = Date.now();
  // Pretend the clip was recorded just now: Status says seq0+frames is being recorded at `now`.
  setAnchor(SIM_BOOT & 0xff, { boot: SIM_BOOT, seq: seq0 + frames, at: now, exact: true });
  for (let i = 0; i < frames; i++) {
    const pcm = samples.subarray(i * SAMPLES_PER_FRAME, (i + 1) * SAMPLES_PER_FRAME);
    const f = new Uint8Array(FRAME_BYTES);
    const dv = new DataView(f.buffer);
    dv.setUint32(0, seq0 + i, true);
    dv.setUint16(4, rms(pcm), true);
    dv.setUint8(6, FLAG_SPEECH | (i === 0 ? FLAG_START : 0) | (i === frames - 1 ? FLAG_END : 0));
    dv.setUint8(7, 1);
    dv.setInt16(8, state.predictor, true);
    dv.setUint8(10, state.stepIndex);
    dv.setUint8(11, SIM_BOOT & 0xff);
    f.set(encodeAdpcm(pcm, state), 12);
    onFrame(f, now);
  }
  closeOpen();
  return frames;
}
