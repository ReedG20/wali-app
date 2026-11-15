// Tiny external stores for pipeline state (BLE link, recorder stats, uploader) read by the UI.
//
// CPU rules (iOS kills a background app that averages > 80% CPU over 60 s; wali was killed this
// way on 2026-11-14 while the screen was off):
// - set() with nothing changed is a no-op (no listener calls, no re-render).
// - While the app is not active, set() still updates the state (get() is always current) but does
//   not notify React: nobody is looking, and every re-render costs JS time on the e-cores. When the
//   app becomes active again, every store notifies once (setUiActive(true)).
// - Components subscribe to the slice they need (useStoreSelector), not the whole store.
import { useCallback, useSyncExternalStore } from "react";
import { singleton } from "./runtime";

export type Store<T> = {
  get: () => T;
  set: (patch: Partial<T>) => void;
  subscribe: (l: () => void) => () => void;
};

type UiGate = { active: boolean; dirty: Set<() => void> };
const gate = () => singleton<UiGate>("store:uiGate", () => ({ active: true, dirty: new Set() }));

/** Called on AppState changes. Re-activating flushes the updates held back while inactive. */
export function setUiActive(active: boolean) {
  const g = gate();
  if (g.active === active) return;
  g.active = active;
  if (!active) return;
  const pending = [...g.dirty];
  g.dirty.clear();
  for (const notify of pending) notify();
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((l) => l());
  return {
    get: () => state,
    set(patch) {
      let changed = false;
      for (const k in patch) {
        if (!Object.is(state[k], patch[k])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      const g = gate();
      if (g.active) notify();
      else g.dirty.add(notify);
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

/** A store that survives Fast Refresh (one instance per JS runtime, keyed by name). */
export function sharedStore<T extends object>(key: string, initial: T): Store<T> {
  return singleton(`store:${key}`, () => createStore(initial));
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Re-render only when the selected value changes (Object.is). Select primitives. */
export function useStoreSelector<T extends object, S>(store: Store<T>, select: (s: T) => S): S {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const get = useCallback(() => select(store.get()), [store]);
  return useSyncExternalStore(store.subscribe, get);
}
