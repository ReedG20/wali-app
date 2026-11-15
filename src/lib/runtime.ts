// Process-wide singletons that survive Fast Refresh.
//
// Fast Refresh re-evaluates edited modules (and their importers) inside the same JS runtime, so
// plain module-level `let` state gets a second copy while native listeners / intervals registered
// by the old copy keep running. Everything stateful in the pipeline therefore lives here, keyed on
// globalThis, and every listener/interval is registered through `replace()` so a re-run swaps the
// old registration for the new one instead of adding a second.
//
// A full JS reload (or app restart) starts with a fresh globalThis, which is exactly the
// "process restarted" case the recorder's crash recovery is built for.

type Bag = { values: Map<string, unknown>; disposers: Map<string, () => void> };

function bag(): Bag {
  const g = globalThis as typeof globalThis & { __mindRuntime?: Bag };
  return (g.__mindRuntime ??= { values: new Map(), disposers: new Map() });
}

/** Get or create the singleton stored under `key`. */
export function singleton<T>(key: string, make: () => T): T {
  const b = bag();
  if (!b.values.has(key)) b.values.set(key, make());
  return b.values.get(key) as T;
}

/** Register a teardown under `key`, first running (and dropping) any previous one. */
export function replace(key: string, dispose: () => void) {
  const b = bag();
  const prev = b.disposers.get(key);
  b.disposers.delete(key);
  try {
    prev?.();
  } catch {
    // a failing teardown must never block re-registration
  }
  b.disposers.set(key, dispose);
}

/** setInterval that replaces any interval previously registered under `key`. */
export function replaceInterval(key: string, fn: () => void, ms: number) {
  const h = setInterval(fn, ms);
  replace(key, () => clearInterval(h));
}

/** Tests only: drop all state and run all teardowns (simulates a process restart). */
export function resetRuntime() {
  const g = globalThis as typeof globalThis & { __mindRuntime?: Bag };
  const b = g.__mindRuntime;
  if (b) for (const d of b.disposers.values()) {
    try {
      d();
    } catch {
      // ignore
    }
  }
  delete g.__mindRuntime;
}
