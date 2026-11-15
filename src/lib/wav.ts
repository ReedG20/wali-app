// Minimal 16-bit PCM mono WAV writer/reader.

export const WAV_HEADER_BYTES = 44;

export function buildWav(samples: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const dv = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  dv.setUint32(16, 16, true); // fmt chunk size
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, 1, true); // mono
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true); // byte rate
  dv.setUint16(32, 2, true); // block align
  dv.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  dv.setUint32(40, dataBytes, true);
  // Little-endian hosts (all iOS/Android/x86/ARM targets) can copy the samples directly.
  new Int16Array(buf, 44, samples.length).set(samples);
  return new Uint8Array(buf);
}

/** Parse a 16-bit PCM mono WAV. Throws on anything else. */
export function parseWav(bytes: Uint8Array): { sampleRate: number; samples: Int16Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (off: number) =>
    String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  if (str(0) !== "RIFF" || str(8) !== "WAVE") throw new Error("not a WAV file");
  let off = 12;
  let sampleRate = 0;
  while (off + 8 <= bytes.length) {
    const id = str(off);
    const size = dv.getUint32(off + 4, true);
    const body = off + 8;
    if (id === "fmt ") {
      const format = dv.getUint16(body, true);
      const channels = dv.getUint16(body + 2, true);
      sampleRate = dv.getUint32(body + 4, true);
      const bits = dv.getUint16(body + 14, true);
      if (format !== 1 || channels !== 1 || bits !== 16) throw new Error("need 16-bit PCM mono");
    } else if (id === "data") {
      if (!sampleRate) throw new Error("data before fmt");
      const n = Math.floor(Math.min(size, bytes.length - body) / 2);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i++) samples[i] = dv.getInt16(body + i * 2, true);
      return { sampleRate, samples };
    }
    off = body + size + (size & 1);
  }
  throw new Error("WAV has no data chunk");
}
