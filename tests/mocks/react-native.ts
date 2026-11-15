type Cb = (s: string) => void;
const g = globalThis as typeof globalThis & { __appStateListeners?: Set<Cb> };
const listeners = (g.__appStateListeners ??= new Set());
export const AppState = {
  currentState: "active",
  addEventListener(_t: string, cb: Cb) {
    listeners.add(cb);
    return { remove: () => listeners.delete(cb) };
  },
};
export const Alert = { alert: () => {} };
export const Platform = { OS: "ios" };
