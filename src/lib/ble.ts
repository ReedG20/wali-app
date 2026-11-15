// BLE link to the pendant (react-native-ble-manager). Connect, subscribe Audio + Status, read
// Status, and reconnect forever until the user disconnects (PROTOCOL §8).
//
// Robustness rules:
// - State lives in a runtime singleton and native listeners are registered through replace(), so
//   Fast Refresh swaps them instead of stacking a second set (which used to leave the UI reading
//   a dead copy of this module's store).
// - Never call connect() on a peripheral that is already connected (it can wait forever for a
//   didConnect that never comes); check isPeripheralConnected first.
// - Status arrives by notification (every <= 2 s) and, while the app is in the foreground, is also
//   read directly whenever it is older than STATUS_POLL_STALE_MS, so the UI can't show stale state.
// - Subscription state is tracked from didUpdateNotificationState; a dropped subscription is
//   re-requested.
import BleManager, { type Peripheral } from "react-native-ble-manager";
import { kvGet, kvSet } from "./db";
import {
  AUDIO_UUID,
  CONTROL_UUID,
  FRAME_BYTES,
  MIN_MTU,
  PROTOCOL_VERSION,
  SERVICE_UUID,
  STATUS_UUID,
  encodeCommand,
  parseStatus,
  type PendantStatus,
} from "./protocol";
import { onFrame, onStatus } from "./recorder";
import { replace, replaceInterval, singleton } from "./runtime";
import { sharedStore } from "./store";
import { kickSoon } from "./uploader";

export type LinkState = "off" | "idle" | "scanning" | "connecting" | "connected" | "reconnecting";

export type BleUiState = {
  adapter: string;
  link: LinkState;
  deviceId: string | null;
  deviceName: string | null;
  discovered: { id: string; name: string; rssi: number }[];
  /** Max notification payload (ATT MTU - 3) as reported by iOS. */
  maxPayload: number | null;
  status: PendantStatus | null;
  statusAt: number | null;
  connectedAt: number | null;
  reconnects: number;
  /** Subscription state as confirmed by iOS (null = unknown). */
  audioNotifying: boolean | null;
  statusNotifying: boolean | null;
  /** How Status updates arrived (diagnostics: notifications should dominate). */
  statusViaNotify: number;
  statusViaRead: number;
  lastStatusNotifyAt: number | null;
  error: string | null;
};

export const bleStore = sharedStore<BleUiState>("ble", {
  adapter: "unknown",
  link: "idle",
  deviceId: null,
  deviceName: null,
  discovered: [],
  maxPayload: null,
  status: null,
  statusAt: null,
  connectedAt: null,
  reconnects: 0,
  audioNotifying: null,
  statusNotifying: null,
  statusViaNotify: 0,
  statusViaRead: 0,
  lastStatusNotifyAt: null,
  error: null,
});

const RESTORE_ID = "com.reedgrenager.mind.central";
const STATUS_POLL_EVERY_MS = 1000;
const STATUS_POLL_STALE_MS = 2500;
const RECONNECT_DELAY_MS = 3000;
const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

type State = {
  /** The peripheral the user wants to be connected to (drives auto-reconnect). */
  wanted: string | null;
  loopGen: number;
  nativeStarted: boolean;
  initDone: boolean;
  /** A JS-initiated Status read is in flight (ble-manager delivers it via the same callback). */
  readInFlight: Promise<PendantStatus | null> | null;
  foreground: boolean;
  setupInFlight: string | null;
  lastRescueAt: number;
};

const S = () =>
  singleton<State>("ble", () => ({
    wanted: null,
    loopGen: 0,
    nativeStarted: false,
    initDone: false,
    readInFlight: null,
    foreground: true,
    setupInFlight: null,
    lastRescueAt: 0,
  }));

/**
 * react-native-ble-manager rejects with a string (its own checks) or a plain
 * `{ code, domain, message }` object (CoreBluetooth errors), never an Error. Normalize so callers
 * can show `e.message` instead of "[object Object]".
 */
export function bleError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === "string") return new Error(e);
  if (e && typeof e === "object") {
    const { message, code, domain } = e as { message?: unknown; code?: unknown; domain?: unknown };
    const text = typeof message === "string" && message ? message : JSON.stringify(e);
    return new Error(domain != null || code != null ? `${text} (${String(domain ?? "?")} ${String(code ?? "?")})` : text);
  }
  return new Error(String(e));
}

function setError(e: unknown) {
  bleStore.set({ error: bleError(e).message });
}

/** Register all native listeners (replacing any from a previous module copy). */
function registerListeners() {
  const subs = [
    BleManager.onDidUpdateState(({ state }) => {
      bleStore.set({ adapter: String(state) });
      const w = S().wanted;
      if (String(state) === "on" && w && bleStore.get().link !== "connected") void connectLoop(w);
    }),
    BleManager.onDiscoverPeripheral((p: Peripheral) => {
      const cur = bleStore.get().discovered.filter((d) => d.id !== p.id);
      cur.push({ id: p.id, name: p.name ?? p.advertising?.localName ?? "?", rssi: p.rssi });
      bleStore.set({ discovered: cur.sort((a, b) => b.rssi - a.rssi) });
    }),
    BleManager.onStopScan(() => {
      if (bleStore.get().link === "scanning") bleStore.set({ link: "idle" });
    }),
    BleManager.onDidUpdateValueForCharacteristic(({ peripheral, characteristic, value }) => {
      if (same(characteristic, AUDIO_UUID)) {
        onFrame(Uint8Array.from(value));
      } else if (same(characteristic, STATUS_UUID)) {
        handleStatus(Uint8Array.from(value), "notify");
      }
      // Any event proves the link is up even if we missed the connect callback (e.g. restore).
      const s = S();
      const now = Date.now();
      if (
        peripheral === bleStore.get().deviceId &&
        s.wanted === peripheral &&
        bleStore.get().link !== "connected" &&
        s.setupInFlight !== peripheral &&
        now - s.lastRescueAt > 5000
      ) {
        s.lastRescueAt = now;
        void connectLoop(peripheral);
      }
    }),
    BleManager.onDidUpdateNotificationStateFor(({ peripheral, characteristic, isNotifying }) => {
      if (peripheral !== bleStore.get().deviceId) return;
      if (same(characteristic, AUDIO_UUID)) bleStore.set({ audioNotifying: isNotifying });
      if (same(characteristic, STATUS_UUID)) bleStore.set({ statusNotifying: isNotifying });
      if (!isNotifying && bleStore.get().link === "connected" && S().wanted === peripheral) {
        // Subscription dropped while we still want it: ask again.
        void BleManager.startNotification(peripheral, SERVICE_UUID, characteristic).catch(setError);
      }
    }),
    BleManager.onDisconnectPeripheral(({ peripheral }) => {
      if (peripheral !== bleStore.get().deviceId) return;
      bleStore.set({ connectedAt: null, maxPayload: null, audioNotifying: null, statusNotifying: null });
      if (S().wanted === peripheral) {
        bleStore.set({ link: "reconnecting", reconnects: bleStore.get().reconnects + 1 });
        void connectLoop(peripheral);
      } else {
        bleStore.set({ link: "idle" });
      }
    }),
    BleManager.onCentralManagerWillRestoreState(({ peripherals }) => {
      // iOS relaunched us in the background with a restored connection.
      const p = peripherals?.[0];
      if (p) {
        S().wanted = p.id;
        bleStore.set({ deviceId: p.id, deviceName: p.name ?? null });
        void connectLoop(p.id);
      }
    }),
  ];
  replace("ble.listeners", () => {
    for (const s of subs) {
      try {
        s.remove();
      } catch {
        // ignore
      }
    }
  });
}

/** Idempotent (Fast Refresh safe). */
export async function initBle() {
  registerListeners();
  replaceInterval("ble.statusPoll", pollStatus, STATUS_POLL_EVERY_MS);
  const s = S();
  if (!s.nativeStarted) {
    s.nativeStarted = true;
    try {
      // Native start is idempotent (reuses the existing CBCentralManager).
      await BleManager.start({ showAlert: false, restoreIdentifierKey: RESTORE_ID });
    } catch (e) {
      setError(e);
    }
  }
  if (!s.initDone) {
    s.initDone = true;
    const saved = kvGet<{ id: string; name: string | null }>("device");
    if (saved) {
      bleStore.set({ deviceId: saved.id, deviceName: saved.name });
      void connect(saved.id, saved.name);
    }
  }
}

export function setForeground(fg: boolean) {
  S().foreground = fg;
  if (fg) void refreshStatus().catch(() => {});
}

export async function scan() {
  bleStore.set({ discovered: [], error: null, link: "scanning" });
  try {
    await BleManager.scan({ serviceUUIDs: [SERVICE_UUID], seconds: 10, allowDuplicates: false });
  } catch (e) {
    bleStore.set({ link: "idle" });
    setError(e);
  }
}

export async function connect(id: string, name: string | null = null) {
  if (bleStore.get().link === "scanning") await BleManager.stopScan().catch(() => {});
  S().wanted = id;
  kvSet("device", { id, name });
  bleStore.set({ deviceId: id, deviceName: name, error: null });
  await connectLoop(id);
}

async function isConnected(id: string): Promise<boolean> {
  try {
    return await BleManager.isPeripheralConnected(id, []);
  } catch {
    return false;
  }
}

/**
 * iOS connects are "pending" and never time out, so a single connect() call waits until the
 * pendant is back in range. Retry only if the call fails outright (e.g. Bluetooth off).
 */
async function connectLoop(id: string) {
  const s = S();
  const my = ++s.loopGen; // a newer loop supersedes this one (a stale pending connect may never resolve)
  while (S().wanted === id && my === S().loopGen) {
    if (bleStore.get().link !== "reconnecting") bleStore.set({ link: "connecting" });
    try {
      if (!(await isConnected(id))) {
        await BleManager.connect(id);
      }
      if (S().wanted !== id || my !== S().loopGen) return;
      await setup(id);
      return;
    } catch (e) {
      setError(e);
      if (S().wanted !== id || my !== S().loopGen) return;
      await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
    }
  }
}

async function setup(id: string) {
  S().setupInFlight = id;
  try {
    await BleManager.retrieveServices(id);
    let maxPayload: number | null = null;
    try {
      maxPayload = await BleManager.getMaximumWriteValueLengthForWithoutResponse(id);
    } catch {
      // not fatal; iOS normally negotiates >= 185
    }
    bleStore.set({
      link: "connected",
      connectedAt: Date.now(),
      maxPayload,
      error:
        maxPayload !== null && maxPayload < FRAME_BYTES
          ? `MTU too small: ${maxPayload + 3} < ${MIN_MTU}. Audio frames will not fit.`
          : null,
    });
    await BleManager.startNotification(id, SERVICE_UUID, AUDIO_UUID);
    await BleManager.startNotification(id, SERVICE_UUID, STATUS_UUID);
    // startNotification resolves once iOS confirms the subscription.
    bleStore.set({ audioNotifying: true, statusNotifying: true });
    await refreshStatus();
  } finally {
    if (S().setupInFlight === id) S().setupInFlight = null;
  }
}

function handleStatus(bytes: Uint8Array, via: "notify" | "read") {
  const st = parseStatus(bytes);
  if (!st) return null;
  const at = Date.now();
  try {
    onStatus(st, at);
  } catch (e) {
    setError(e); // never let recorder trouble hide the status from the UI
  }
  const cur = bleStore.get();
  const patch: Partial<BleUiState> = { status: st, statusAt: at };
  if (via === "notify") {
    patch.statusViaNotify = cur.statusViaNotify + 1;
    patch.lastStatusNotifyAt = at;
  } else {
    patch.statusViaRead = cur.statusViaRead + 1;
  }
  if (st.v !== PROTOCOL_VERSION) patch.error = `Pendant speaks protocol v${st.v}, app expects v${PROTOCOL_VERSION}`;
  bleStore.set(patch);
  kickSoon(at);
  return st;
}

/** Read Status directly (doesn't rely on Status notifications). Coalesces concurrent calls. */
export function refreshStatus(): Promise<PendantStatus | null> {
  const s = S();
  if (s.readInFlight) return s.readInFlight;
  const id = bleStore.get().deviceId;
  if (!id || bleStore.get().link !== "connected") return Promise.resolve(null);
  const p = (async () => {
    try {
      const raw = await BleManager.read(id, SERVICE_UUID, STATUS_UUID);
      return handleStatus(Uint8Array.from(raw), "read");
    } finally {
      S().readInFlight = null;
    }
  })();
  s.readInFlight = p;
  return p;
}

function pollStatus() {
  const s = S();
  if (!s.foreground || bleStore.get().link !== "connected") return;
  const age = Date.now() - (bleStore.get().statusAt ?? 0);
  if (age >= STATUS_POLL_STALE_MS) void refreshStatus().catch(() => {});
}

export async function disconnect() {
  const id = bleStore.get().deviceId;
  S().wanted = null;
  S().loopGen++;
  if (id) {
    try {
      await BleManager.disconnect(id);
    } catch (e) {
      setError(e);
    }
  }
  bleStore.set({ link: "idle", connectedAt: null, audioNotifying: null, statusNotifying: null });
}

/** Forget the remembered device (no auto-connect on next launch). */
export async function forget() {
  await disconnect();
  kvSet("device", null);
  bleStore.set({ deviceId: null, deviceName: null, status: null });
}

export async function sendCommand(cmd: string) {
  const id = bleStore.get().deviceId;
  if (!id || bleStore.get().link !== "connected") throw new Error("not connected");
  try {
    await BleManager.write(id, SERVICE_UUID, CONTROL_UUID, encodeCommand(cmd), 180);
  } catch (e) {
    throw bleError(e);
  }
  // The board applies commands in its main loop (a few ms); read back so the UI reflects it now.
  await new Promise((r) => setTimeout(r, 250));
  await refreshStatus().catch(setError);
}

/**
 * Set mute and confirm the board actually reports it (retries the read-back a few times).
 * Throws if the board still reports the old state after ~2 s.
 */
export async function setMuted(muted: boolean) {
  await sendCommand(muted ? "mute 1" : "mute 0");
  for (let i = 0; i < 6; i++) {
    if (bleStore.get().status?.muted === muted) return;
    await new Promise((r) => setTimeout(r, 300));
    await refreshStatus().catch(setError);
  }
  throw new Error(`pendant still reports muted=${String(bleStore.get().status?.muted)}`);
}
