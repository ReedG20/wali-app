// Scriptable fake of react-native-ble-manager + a pendant behind it.
import { AUDIO_UUID, SERVICE_UUID, STATUS_UUID } from "../../src/lib/protocol.ts";

type Cb = (e: never) => void;

export const PERIPHERAL = "PENDANT-1";

export type FakeBle = {
  listeners: Map<string, Set<Cb>>;
  connected: boolean;
  /** connect() never resolves (models an iOS pending connect while out of range). */
  connectHangs: boolean;
  calls: string[];
  status: Record<string, unknown>;
  writes: string[];
  emit: (event: string, payload: unknown) => void;
  listenerCount: (event?: string) => number;
  notifyAudio: (frame: Uint8Array) => void;
  notifyStatus: () => void;
  dropLink: () => void;
};

const g = globalThis as typeof globalThis & { __ble?: FakeBle };

function bytes(s: string) {
  return Array.from(s, (c) => c.charCodeAt(0));
}

export const ble: FakeBle = (g.__ble ??= {
  listeners: new Map(),
  connected: false,
  connectHangs: false,
  calls: [],
  writes: [],
  status: { v: 2, fw: "1.1", boot: 40213, seq: 1000, muted: false, mode: "gated", lvl: 10, nf: -65, wake: 150, gain: 4, buf: 0, lost: 0, sd: 1, sdFree: 1000 },
  emit(event, payload) {
    for (const cb of [...(this.listeners.get(event) ?? [])]) cb(payload as never);
  },
  listenerCount(event) {
    if (event) return this.listeners.get(event)?.size ?? 0;
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  },
  notifyAudio(frame) {
    this.emit("value", { peripheral: PERIPHERAL, characteristic: AUDIO_UUID.toLowerCase(), service: SERVICE_UUID, value: Array.from(frame) });
  },
  notifyStatus() {
    this.emit("value", { peripheral: PERIPHERAL, characteristic: STATUS_UUID.toLowerCase(), service: SERVICE_UUID, value: bytes(JSON.stringify(this.status)) });
  },
  dropLink() {
    this.connected = false;
    this.emit("disconnect", { peripheral: PERIPHERAL });
  },
});

function on(event: string) {
  return (cb: Cb) => {
    let set = ble.listeners.get(event);
    if (!set) ble.listeners.set(event, (set = new Set()));
    set.add(cb);
    return { remove: () => set!.delete(cb) };
  };
}

const BleManager = {
  async start() {
    ble.calls.push("start");
  },
  async scan() {
    ble.calls.push("scan");
  },
  async stopScan() {},
  connect(id: string) {
    ble.calls.push(`connect:${id}`);
    if (ble.connectHangs) return new Promise<void>(() => {});
    ble.connected = true;
    return Promise.resolve();
  },
  async disconnect(id: string) {
    ble.calls.push(`disconnect:${id}`);
    ble.connected = false;
  },
  async isPeripheralConnected() {
    return ble.connected;
  },
  async retrieveServices() {
    if (!ble.connected) throw new Error("Peripheral not connected");
    ble.calls.push("retrieveServices");
  },
  async getMaximumWriteValueLengthForWithoutResponse() {
    return 512;
  },
  async startNotification(_id: string, _svc: string, ch: string) {
    if (!ble.connected) throw new Error("Peripheral not connected");
    ble.calls.push(`notify:${ch.slice(0, 8)}`);
  },
  async read(_id: string, _svc: string, ch: string) {
    if (!ble.connected) throw new Error("Peripheral not connected");
    ble.calls.push(`read:${ch.slice(0, 8)}`);
    return bytes(JSON.stringify(ble.status));
  },
  async write(_id: string, _svc: string, _ch: string, data: number[]) {
    if (!ble.connected) throw new Error("Peripheral not connected");
    const cmd = String.fromCharCode(...data);
    ble.writes.push(cmd);
    const [c, a] = cmd.split(" ");
    if (c === "mute") ble.status = { ...ble.status, muted: a === "1" };
    if (c === "mode") ble.status = { ...ble.status, mode: a };
  },
  onDidUpdateState: on("state"),
  onDiscoverPeripheral: on("discover"),
  onStopScan: on("stopScan"),
  onDidUpdateValueForCharacteristic: on("value"),
  onDidUpdateNotificationStateFor: on("notifyState"),
  onDisconnectPeripheral: on("disconnect"),
  onCentralManagerWillRestoreState: on("restore"),
};

export default BleManager;
export type Peripheral = { id: string; name?: string; rssi: number; advertising?: { localName?: string } };
