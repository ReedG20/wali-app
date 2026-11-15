// Keeps the Convex WebSocket honest on a phone, and tells the UI when it isn't connected.
//
// Why this exists (bug tour, 2026-11-15): chats and transcripts sat on a spinner for 40 s, a sent
// message vanished, "New chat" did nothing and actions failed with "Connection lost while action
// was in flight". The Convex client only learns about network changes from the browser's
// `window "online"` event, which React Native doesn't have (see convex's web_socket_manager.ts:
// "React Native has window but not addEventListener"). So after the network dropped it sat out a
// reconnect backoff of up to 16 s after the network was back, and a socket that had died without
// an error went unnoticed until the client's 60 s server-inactivity timer fired.
//
// What it does:
// - The network came back, the network path changed, or the app returned to the foreground: skip
//   whatever is left of the reconnect backoff (`tryReconnectImmediately`, a no-op while connected).
// - Replaces a socket that still claims to be open in two cases only: right after a network
//   change, and when a mutation has had no answer for 10 s on a socket that has been open, with
//   the app in front, for that long. Never while an action is in flight: replacing the socket
//   fails every in-flight action with "Connection lost while action was in flight", which is the
//   error this module exists to prevent. It does not reset on foregrounding, a slow spinner
//   never resets anything, and the client's own 60 s dead-socket timer is left as it is.
// - Publishes "ok" / "reconnecting" / "offline" for the UI (ConnectionPill, Loading, home header).
//
// It reaches into the client's WebSocket manager (not public API). Every access is guarded, so if
// a Convex upgrade renames something this quietly does nothing and the client's own (slower)
// reconnect logic still applies.
import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
import { mutationIsStuck } from "./connectionRules";
import { convex } from "./convex";
import { replace, replaceInterval, singleton } from "./runtime";
import { sharedStore, useStoreSelector } from "./store";

export type ConnectionStatus = "ok" | "reconnecting" | "offline";

type State = {
  /** What the UI shows. "reconnecting" and "offline" only appear after SHOW_AFTER_MS, so blips stay invisible. */
  status: ConnectionStatus;
  /** NetInfo: the phone has a network at all. */
  online: boolean;
  /** The Convex socket is open. */
  socket: boolean;
};

export const connectionStore = sharedStore<State>("connection", { status: "ok", online: true, socket: true });

/** How long the socket must be down before the UI says so. */
const SHOW_AFTER_MS = 2500;
/** Never replace the socket more often than this. */
const MIN_RESTART_GAP_MS = 15_000;
/** Give up replacing the socket for one stuck mutation after this many tries; the client's own timers take over. */
const MAX_STUCK_RESTARTS = 2;

type Manager = {
  socket?: { state?: string; paused?: string };
  tryReconnectImmediately?: () => void;
  closeAndReconnect?: (reason: string) => void;
};

function manager(): Manager | null {
  try {
    const sync = (convex as unknown as { sync?: { webSocketManager?: Manager } }).sync;
    return sync?.webSocketManager ?? null;
  } catch {
    return null;
  }
}

type Mem = {
  lastRestartAt: number;
  /** When the socket last became open (0 while it's closed). */
  connectedSince: number;
  connectionCount: number;
  /** When the app last came to the foreground. */
  activeSince: number;
  /** Restarts spent on the mutation that's currently stuck. */
  stuckRestarts: number;
  networkKey: string | null;
  showTimer: ReturnType<typeof setTimeout> | null;
};
const mem = () =>
  singleton<Mem>("connection.mem", () => ({ lastRestartAt: 0, connectedSince: 0, connectionCount: 0, activeSince: 0, stuckRestarts: 0, networkKey: null, showTimer: null }));

/** If the client is waiting out a reconnect backoff, connect right now instead. Does nothing while connected. */
export function reconnectNow() {
  try {
    manager()?.tryReconnectImmediately?.();
  } catch {
    // the client reconnects on its own schedule
  }
}

/**
 * Drop the current socket (it may be dead without knowing it) and open a new one. Queries
 * resubscribe and mutations are re-sent by the client. In-flight actions would fail, so this
 * refuses while any action is in flight, and it is rate-limited. Returns whether it did anything.
 */
function restartConnection(reason: string): boolean {
  const m = manager();
  const s = mem();
  const now = Date.now();
  if (!m || now - s.lastRestartAt < MIN_RESTART_GAP_MS) return false;
  let cs;
  try {
    cs = convex.connectionState();
  } catch {
    return false;
  }
  if (cs.inflightActions > 0) return false;
  try {
    const state = m.socket?.state;
    if (state !== "ready" && state !== "connecting") {
      m.tryReconnectImmediately?.();
      return false;
    }
    s.lastRestartAt = now;
    m.closeAndReconnect?.(reason);
    m.tryReconnectImmediately?.();
    return true;
  } catch {
    return false;
  }
}

function publish(patch: Partial<Pick<State, "online" | "socket">>) {
  const s = mem();
  connectionStore.set(patch);
  const { online, socket } = connectionStore.get();
  // An open socket is the truth. NetInfo can say "no internet" behind a VPN or captive portal
  // while everything works.
  if (socket) {
    if (s.showTimer) clearTimeout(s.showTimer);
    s.showTimer = null;
    connectionStore.set({ status: "ok" });
    return;
  }
  const next: ConnectionStatus = online ? "reconnecting" : "offline";
  // Already showing a problem: switch between the two immediately. Otherwise wait out blips.
  if (connectionStore.get().status !== "ok") {
    connectionStore.set({ status: next });
    return;
  }
  if (s.showTimer) return;
  s.showTimer = setTimeout(() => {
    s.showTimer = null;
    const cur = connectionStore.get();
    if (!cur.socket) connectionStore.set({ status: cur.online ? "reconnecting" : "offline" });
  }, SHOW_AFTER_MS);
}

/** Record when the socket opened, so "stuck" is measured against this connection, not an old one. */
function noteSocket(cs: { isWebSocketConnected: boolean; connectionCount: number }) {
  const s = mem();
  if (!cs.isWebSocketConnected) s.connectedSince = 0;
  else if (!s.connectedSince || cs.connectionCount !== s.connectionCount) s.connectedSince = Date.now();
  s.connectionCount = cs.connectionCount;
  publish({ socket: cs.isWebSocketConnected });
}

/** Mounted once by the signed-in app. Idempotent (Fast Refresh safe). */
export function startConnectionWatch() {
  const s = mem();
  // Tear down a previous watch first (Fast Refresh, sign-out and back in), so its teardown can't
  // clear the timer this run is about to arm.
  replace("connection.watch", () => {});
  let unsubState = () => {};
  try {
    noteSocket(convex.connectionState());
    unsubState = convex.subscribeToConnectionState(noteSocket);
  } catch {
    // no connection state: the pill just never shows
  }

  const unsubNet = NetInfo.addEventListener((st) => {
    const online = st.isConnected !== false && st.isInternetReachable !== false;
    const details = (st.details ?? null) as { ipAddress?: string | null } | null;
    const key = `${st.type}|${details?.ipAddress ?? ""}`;
    const was = connectionStore.get().online;
    const prevKey = s.networkKey;
    s.networkKey = online ? key : null;
    publish({ online });
    if (!online) return;
    // Back online, or Wi-Fi <-> cellular, or a different Wi-Fi. Usually the old socket has already
    // failed and the client is waiting out its backoff: connect now. If it still claims to be
    // open it is bound to a path that's gone, so replace it (unless an action is in flight).
    const changed = !was || (prevKey !== null && prevKey !== key);
    if (!changed) return;
    reconnectNow();
    restartConnection("NetworkChanged");
  });

  const appSub = AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    s.activeSince = Date.now();
    // A drop that happened while nobody was looking gets the same grace period as any other:
    // don't flash "Reconnecting…" the instant the app opens.
    if (!connectionStore.get().socket) {
      connectionStore.set({ status: "ok" });
      publish({});
    }
    // No reset here. If iOS suspended the app long enough for the socket to die, the client's
    // own inactivity timer has expired and resets it as soon as JS runs again; if the socket
    // survived, resetting it would only fail whatever action is in flight.
    reconnectNow();
  });

  replace("connection.watch", () => {
    unsubState();
    unsubNet();
    appSub.remove();
    if (s.showTimer) clearTimeout(s.showTimer);
    s.showTimer = null;
  });

  replaceInterval(
    "connection.watchdog",
    () => {
      if (AppState.currentState !== "active") return;
      let cs;
      try {
        cs = convex.connectionState();
      } catch {
        return;
      }
      if (cs.inflightMutations === 0) {
        s.stuckRestarts = 0;
        return;
      }
      // "yes" while connecting, "uninitialized" once open but still waiting for the sign-in
      // token: either way nothing is being sent, so nothing can be stuck.
      const p = manager()?.socket?.paused;
      const paused = p !== undefined && p !== "no";
      // Counted from when this socket opened or the app last came to the front, whichever is
      // later: time spent suspended isn't time the server failed to answer.
      if (!mutationIsStuck(cs, Math.max(s.connectedSince, s.activeSince), Date.now(), paused)) return;
      if (s.stuckRestarts >= MAX_STUCK_RESTARTS) return;
      if (restartConnection("StalledMutation")) s.stuckRestarts++;
    },
    3000,
  );
}

/** "ok", or what to tell the user after the connection has been down for a moment. */
export function useConnectionStatus(): ConnectionStatus {
  return useStoreSelector(connectionStore, (st) => st.status);
}
