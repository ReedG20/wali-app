// Run: npm test   (node --test, TypeScript via node's type stripping)
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeAdpcm, encodeAdpcm } from "../src/lib/adpcm.ts";
import { FLAG_BACKFILL, FRAME_BYTES, parseFrameHeader, parseStatus } from "../src/lib/protocol.ts";
import {
  GAP_FRAMES,
  MAX_SEGMENT_FRAMES,
  assemble,
  decide,
  decodeRecords,
  encodeRecords,
  seqToWall,
} from "../src/lib/segment.ts";
import { buildWav, parseWav } from "../src/lib/wav.ts";

function makeFrame(o: {
  seq: number;
  level?: number;
  flags?: number;
  predictor?: number;
  stepIndex?: number;
  bootTag?: number;
  codes?: Uint8Array;
}): Uint8Array {
  const f = new Uint8Array(FRAME_BYTES);
  const dv = new DataView(f.buffer);
  dv.setUint32(0, o.seq, true);
  dv.setUint16(4, o.level ?? 100, true);
  dv.setUint8(6, o.flags ?? 0);
  dv.setUint8(7, 1);
  dv.setInt16(8, o.predictor ?? 0, true);
  dv.setUint8(10, o.stepIndex ?? 0);
  dv.setUint8(11, o.bootTag ?? 7);
  if (o.codes) f.set(o.codes, 12);
  return f;
}

test("ADPCM decode matches hand-computed vector (PROTOCOL §3)", () => {
  // From predictor 0, stepIndex 0:
  //  code 4: step 7, diff 0+7=7        -> 7,  idx 2
  //  code 7: step 9, diff 1+9+4+2=16   -> 23, idx 10
  //  code 8: step 19, diff 2 (negative) -> 21, idx 9
  //  code 0: step 17, diff 2           -> 23, idx 8
  const out = new Int16Array(4);
  decodeAdpcm(new Uint8Array([0x74, 0x08]), 0, 0, out);
  assert.deepEqual([...out], [7, 23, 21, 23]);
});

test("ADPCM clamps at full scale", () => {
  const out = new Int16Array(2);
  decodeAdpcm(new Uint8Array([0x77]), 32760, 88, out);
  assert.deepEqual([...out], [32767, 32767]);
});

test("ADPCM round trip of a sine, frames decoded independently from their header state", () => {
  const n = 320 * 50;
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) pcm[i] = Math.round(10000 * Math.sin((2 * Math.PI * 440 * i) / 16000));
  const state = { predictor: 0, stepIndex: 0 };
  const decoded = new Int16Array(n);
  for (let fr = 0; fr < 50; fr++) {
    const startState = { ...state };
    const codes = encodeAdpcm(pcm.subarray(fr * 320, (fr + 1) * 320), state);
    assert.equal(codes.length, 160);
    decodeAdpcm(codes, startState.predictor, startState.stepIndex, decoded, fr * 320);
  }
  let sig = 0;
  let err = 0;
  for (let i = 640; i < n; i++) {
    sig += pcm[i] ** 2;
    err += (pcm[i] - decoded[i]) ** 2;
  }
  const snr = 10 * Math.log10(sig / err);
  assert.ok(snr > 20, `SNR ${snr.toFixed(1)} dB`);
});

test("frame header parsing", () => {
  const f = makeFrame({ seq: 123456, level: 212, flags: 0b1011, predictor: -1234, stepIndex: 40, bootTag: 0xab });
  assert.deepEqual(parseFrameHeader(f), {
    seq: 123456,
    level: 212,
    flags: 0b1011,
    codec: 1,
    predictor: -1234,
    stepIndex: 40,
    bootTag: 0xab,
  });
  assert.equal(parseFrameHeader(f.subarray(0, 171)), null);
});

test("status JSON parsing", () => {
  const json =
    '{"v":2,"fw":"1.1","boot":40213,"seq":184220,"muted":false,"mode":"gated","lvl":212,"nf":-62,"wake":150,"gain":4,"buf":0,"lost":0,"sd":1,"sdFree":28911}';
  const s = parseStatus(new Uint8Array([...json].map((c) => c.charCodeAt(0))));
  assert.equal(s?.boot, 40213);
  assert.equal(s?.v, 2);
  assert.equal(s?.seq, 184220);
  assert.equal(parseStatus(new Uint8Array([1, 2, 3])), null);
});

test("segmenter decisions", () => {
  const cur = { bootTag: 7, seqStart: 1000, lastSeq: 1100 };
  const h = (seq: number, bootTag = 7) => parseFrameHeader(makeFrame({ seq, bootTag }))!;
  assert.equal(decide(null, h(5)), "new");
  assert.equal(decide(cur, h(1101)), "append");
  assert.equal(decide(cur, h(1100 + GAP_FRAMES)), "append"); // 20 s pause stays together
  assert.equal(decide(cur, h(1100 + GAP_FRAMES + 1)), "new");
  assert.equal(decide(cur, h(1100)), "drop");
  assert.equal(decide(cur, h(900)), "new");
  assert.equal(decide(cur, h(1090)), "append"); // late re-send after reconnect
  assert.equal(decide(cur, h(1100 - 65)), "new");
  assert.equal(decide(cur, h(1101, 8)), "new");
  assert.equal(decide({ ...cur, lastSeq: 1000 + MAX_SEGMENT_FRAMES - 1 }, h(1000 + MAX_SEGMENT_FRAMES)), "new");
});

test("records round trip and tolerate a truncated tail", () => {
  const frames = [makeFrame({ seq: 1 }), makeFrame({ seq: 2 })];
  const bytes = encodeRecords(frames);
  assert.equal(bytes.length, 2 * 174);
  assert.equal(decodeRecords(bytes).length, 2);
  assert.equal(decodeRecords(bytes.subarray(0, 174 + 100)).length, 1);
});

test("assemble fills gaps with silence and keeps time linear in seq", () => {
  const codes = new Uint8Array(160).fill(0x44); // non-zero audio
  const frames = [
    makeFrame({ seq: 12, level: 300, codes, flags: FLAG_BACKFILL }),
    makeFrame({ seq: 10, level: 100, codes }),
    makeFrame({ seq: 10, level: 999, codes }), // duplicate, first wins
    makeFrame({ seq: 11, level: 0, codes }),
    makeFrame({ seq: 15, level: 500, codes }),
  ];
  const a = assemble(frames)!;
  assert.equal(a.seqStart, 10);
  assert.equal(a.seqEnd, 15);
  assert.equal(a.frameCount, 4);
  assert.equal(a.missingFrames, 2);
  assert.equal(a.backfillFrames, 1);
  assert.equal(a.backfill, false, "1 of 4 frames backfilled: not a backfill segment");
  assert.equal(a.durationMs, 120);
  assert.equal(a.samples.length, 6 * 320);
  const lv = new DataView(a.levels.buffer);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => lv.getUint16(i * 2, true)), [100, 1, 300, 0, 0, 500]);
  assert.notEqual(a.samples[2 * 320 + 5], 0);
  assert.ok(a.samples.subarray(3 * 320, 5 * 320).every((x) => x === 0));
});

test("wall clock from status anchor (PROTOCOL §8)", () => {
  const anchor = { boot: 1, seq: 184220, at: 1_700_000_000_000, exact: true };
  assert.equal(seqToWall(anchor, 184220 - 50), 1_700_000_000_000 - 1000);
});

test("WAV build/parse round trip", () => {
  const s = new Int16Array([0, 1, -1, 32767, -32768]);
  const wav = buildWav(s, 16000);
  assert.equal(wav.length, 44 + 10);
  const p = parseWav(wav);
  assert.equal(p.sampleRate, 16000);
  assert.deepEqual([...p.samples], [...s]);
});
