type St = { isConnected: boolean | null; isInternetReachable: boolean | null };
type Cb = (s: St) => void;
const g = globalThis as typeof globalThis & { __netinfo?: { listeners: Set<Cb>; state: St } };
export const netinfo = (g.__netinfo ??= { listeners: new Set(), state: { isConnected: true, isInternetReachable: true } });
export default {
  addEventListener(cb: Cb) {
    netinfo.listeners.add(cb);
    cb(netinfo.state);
    return () => netinfo.listeners.delete(cb);
  },
};
