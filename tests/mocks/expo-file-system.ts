// expo-file-system (SDK 58 object API) fake on a real temp directory.
// write() is async like the real one; *Sync variants are synchronous.
import fs from "node:fs";
import path from "node:path";

type G = typeof globalThis & {
  __fsRoot: string;
  __fsHooks?: { failWrite?: (p: string) => boolean; upload?: (f: File, url: string, opts: unknown) => Promise<{ status: number; body: string }> };
};
const g = globalThis as G;

type Part = string | File | Directory;
const toPath = (parts: Part[]) =>
  path.join(...parts.map((p) => (typeof p === "string" ? p.replace(/^file:\/\//, "") : p.path)));

export class Directory {
  readonly path: string;
  constructor(...parts: Part[]) {
    this.path = toPath(parts);
  }
  get uri() {
    return `file://${this.path}`;
  }
  get exists() {
    return fs.existsSync(this.path) && fs.statSync(this.path).isDirectory();
  }
  create(_o?: unknown) {
    fs.mkdirSync(this.path, { recursive: true });
  }
}

export class File {
  readonly path: string;
  constructor(...parts: Part[]) {
    this.path = toPath(parts);
  }
  get uri() {
    return `file://${this.path}`;
  }
  get exists() {
    return fs.existsSync(this.path) && fs.statSync(this.path).isFile();
  }
  get size() {
    return this.exists ? fs.statSync(this.path).size : 0;
  }
  create(_o?: unknown) {
    if (this.exists) throw new Error(`File already exists: ${this.path}`);
    fs.writeFileSync(this.path, new Uint8Array(0));
  }
  writeSync(content: string | Uint8Array, opts?: { append?: boolean }) {
    if (g.__fsHooks?.failWrite?.(this.path)) throw new Error("ENOSPC: no space left on device (simulated)");
    if (opts?.append) fs.appendFileSync(this.path, content);
    else fs.writeFileSync(this.path, content);
  }
  write(content: string | Uint8Array, opts?: { append?: boolean }) {
    // Like the real API: resolves later (this is what made unawaited writes racy).
    return new Promise<void>((res, rej) => setTimeout(() => {
      try {
        this.writeSync(content, opts);
        res();
      } catch (e) {
        rej(e);
      }
    }, 5));
  }
  async bytes() {
    return new Uint8Array(fs.readFileSync(this.path));
  }
  bytesSync() {
    return new Uint8Array(fs.readFileSync(this.path));
  }
  delete() {
    fs.unlinkSync(this.path);
  }
  moveSync(dest: File) {
    fs.renameSync(this.path, dest.path);
  }
  upload(url: string, opts: unknown) {
    const h = g.__fsHooks?.upload;
    if (!h) throw new Error("no upload hook");
    return h(this, url, opts);
  }
}

export const Paths = {
  get document() {
    return new Directory(g.__fsRoot, "documents");
  },
};
