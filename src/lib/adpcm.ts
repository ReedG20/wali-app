// IMA ADPCM as specified in PROTOCOL.md §3 (same tables as WAV format 0x11).

export const STEP = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80,
  88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544,
  598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749,
  3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635,
  13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];
export const INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];

/**
 * Decode `codes` (2 samples per byte, low nibble first) into `out` starting at `outOffset`,
 * from the given starting state. Returns the number of samples written.
 */
export function decodeAdpcm(
  codes: Uint8Array,
  predictor: number,
  stepIndex: number,
  out: Int16Array,
  outOffset = 0,
): number {
  let p = predictor;
  let idx = stepIndex;
  let o = outOffset;
  for (let i = 0; i < codes.length; i++) {
    const byte = codes[i];
    for (let half = 0; half < 2; half++) {
      const code = half === 0 ? byte & 0x0f : byte >> 4;
      const step = STEP[idx];
      let diff = step >> 3;
      if (code & 4) diff += step;
      if (code & 2) diff += step >> 1;
      if (code & 1) diff += step >> 2;
      p = code & 8 ? p - diff : p + diff;
      if (p > 32767) p = 32767;
      else if (p < -32768) p = -32768;
      idx += INDEX[code];
      if (idx < 0) idx = 0;
      else if (idx > 88) idx = 88;
      out[o++] = p;
    }
  }
  return o - outOffset;
}

/**
 * Reference IMA ADPCM encoder (standard algorithm, matching the decoder above). Used by tests
 * and by the "upload test clip" path; the pendant has its own encoder.
 */
export function encodeAdpcm(
  samples: Int16Array,
  state: { predictor: number; stepIndex: number },
): Uint8Array {
  const out = new Uint8Array(Math.ceil(samples.length / 2));
  let p = state.predictor;
  let idx = state.stepIndex;
  for (let i = 0; i < samples.length; i++) {
    const step = STEP[idx];
    let delta = samples[i] - p;
    let code = 0;
    if (delta < 0) {
      code = 8;
      delta = -delta;
    }
    let diff = step >> 3;
    if (delta >= step) {
      code |= 4;
      delta -= step;
      diff += step;
    }
    if (delta >= step >> 1) {
      code |= 2;
      delta -= step >> 1;
      diff += step >> 1;
    }
    if (delta >= step >> 2) {
      code |= 1;
      diff += step >> 2;
    }
    p = code & 8 ? p - diff : p + diff;
    if (p > 32767) p = 32767;
    else if (p < -32768) p = -32768;
    idx += INDEX[code];
    if (idx < 0) idx = 0;
    else if (idx > 88) idx = 88;
    if (i & 1) out[i >> 1] |= code << 4;
    else out[i >> 1] = code;
  }
  state.predictor = p;
  state.stepIndex = idx;
  return out;
}
