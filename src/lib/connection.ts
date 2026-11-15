// Keeps the Convex WebSocket honest on a phone, and tells the UI when it isn't connected.
//
// Why this exists (bug tour, 2026-11-15): chats and transcripts sat on a spinner for 40 s, a sent
// message vanished, "New chat" did nothing and actions failed with "Connection lost while action
// was in flight". The Convex client only learns about network changes from the browser's
// `window "online"` event, which React Native doesn't have (see convex's web_socket_manager.ts:
// "React Native has window but not addEventListener"). So after the phone moved between Wi-Fi and
// cellular, or came back from the background, the client kept waiting on a dead socket until its
// 60 s server-inactivity timer fired, and then sat out a reconnect backoff of up to 16 s.
//
// What it does:
// - NetInfo says the network came back, or the network path changed: reconnect now.
// - The app returns to the foreground after a while: reconnect now.
// - A mutation is stuck or a screen has waited too long on a query: drop the socket and reconnect.
// - Shortens the dead-socket timer from 60 s to 30 s (the server pings every 15 s).
// - Publishes "ok" / "reconnecting" / "offline" for the UI (ConnectionPill, Loading, home header).
//
// It reaches into the client's WebSocket manager (not public API). Every access is guarded, so if
// a Convex upgrade renames something this quietly does nothing and the client's own (slower)
// reconnect logic still applies.
import NetInfo from "@react-native-community/netinfo";
import { AppState } from "react-native";
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
/** A mutation that hasn't completed in this long means the socket is stalled, not slow. */
const STUCK_MUTATION_MS = 10_000;
/** Never force more than one reconnect per this window (a forced reconnect fails in-flight actions). */
const MIN_RESTART_GAP_MS = 15_000;
/** Back from the background after at least this long: the socket is probably dead. */
const STALE_AFTER_BACKGROUND_MS = 20_000;
const INACTIVITY_MS = 30_000;

type Manager = {
  socket?: { state?: string };
  serverInactivityThreshold?: number;
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
  backgroundedAt: number | null;
  networkKey: string | null;
  showTimer: ReturnType<typeof setTimeout> | null;
};
const mem = () =>
  singleton<Mem>("connection.mem", () => ({ lastRestartAt: 0, backgroundedAt: null, networkKey: null, showTimer: null }));

/** If the client is waiting out a reconnect backoff, connect right now instead. Harmless otherwise. */
export function reconnectNow() {
  try {
    manager()?.tryReconnectImmediately?.();
  } catch {
    // the client reconnects on its own schedule
  }
}

/**
 * Drop the current socket (it may be dead without knowing it) and open a new one. Queries
 * resubscribe and mutations are re-sent by the client; in-flight actions fail, so this is
 * rate-limited and only used when there's evidence the socket is stuck.
 */
export function restartConnection(reason: string, opts: { force?: boolean } = {}): boolean {
  const m = manager();
  const s = mem();
  const now = Date.now();
  if (!m) return false;
  if (!opts.force) {
    if (now - s.lastRestartAt < MIN_RESTART_GAP_MS) return false;
    // On suspicion alone, never drop a socket that has an action in flight: the action would fail
    // ("Connection lost while action was in flight") and may simply be a slow one.
    if (inflightActions() > 0) return false;
  }
  s.lastRestartAt = now;
  try {
    const state = m.socket?.state;
    if (state === "ready" || state === "connecting") m.closeAndReconnect?.(reason);
    m.tryReconnectImmediately?.();
    return true;
  } catch {
    return false;
  }
}

function inflightActions(): number {
  try {
    return convex.connectionState().inflightActions;
  } catch {
    return 0;
  }
}

/**
 * A screen has been waiting on data for too long: make sure it isn't waiting on a dead socket.
 * Does nothing while an action is in flight (the wait may be that action; see restartConnection).
 */
export function nudgeConnection() {
  if (connectionStore.get().socket) restartConnection("StalledQuery");
  else reconnectNow();
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

/** Mounted once by the signed-in app. Idempotent (Fast Refresh safe). */
export function startConnectionWatch() {
  const s = mem();
  // Tear down a previous watch first (Fast Refresh, sign-out and back in), so its teardown can't
  // clear the timer this run is about to arm.
  replace("connection.watch", () => {});
  const m = manager();
  if (m && typeof m.serverInactivityThreshold === "number" && m.serverInactivityThreshold > INACTIVITY_MS) {
    m.serverInactivityThreshold = INACTIVITY_MS;
  }

  let unsubState = () => {};
  try {
    publish({ socket: convex.connectionState().isWebSocketConnected });
    unsubState = convex.subscribeToConnectionState((cs) => publish({ socket: cs.isWebSocketConnected }));
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
    // Back online, or Wi-Fi <-> cellular, or a different Wi-Fi: a socket that still looks open is
    // bound to a path that's gone, so replace it now (forced: its actions are lost either way).
    const changed = !was || (prevKey !== null && prevKey !== key);
    if (!changed) return;
    const state = manager()?.socket?.state;
    if (state === "ready" || state === "connecting") restartConnection("NetworkChanged", { force: true });
    else reconnectNow();
  });

  const appSub = AppState.addEventListener("change", (state) => {
    const now = Date.now();
    // Only a real trip to the background counts. "inactive" is Control Center or a system prompt.
    if (state === "background") {
      s.backgroundedAt ??= now;
      return;
    }
    if (state !== "active") return;
    const away = s.backgroundedAt ? now - s.backgroundedAt : 0;
    s.backgroundedAt = null;
    // A drop that happened while nobody was looking gets the same grace period as any other:
    // don't flash "Reconnecting…" the instant the app opens.
    if (!connectionStore.get().socket) {
      connectionStore.set({ status: "ok" });
      publish({});
    }
    if (away > STALE_AFTER_BACKGROUND_MS) restartConnection("Resumed", { force: true });
    else reconnectNow();
  });

  replace("connection.watch", () => {
    unsubState();
    unsubNet();
    appSub.remove();
    if (s.showTimer) clearTimeout(s.showTimer);
    s.showTimer = null;
  });

  // Mutations normally finish in well under a second. One that's still in flight after 10 s on a
  // socket that claims to be open means nothing is getting through.
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
      // With no action in flight, the oldest in-flight request is a mutation: one specific
      // request that has been waiting too long, not just "some mutation was in flight each time
      // we looked".
      const oldest = cs.timeOfOldestInflightRequest?.getTime();
      if (cs.isWebSocketConnected && cs.inflightMutations > 0 && cs.inflightActions === 0 && oldest && Date.now() - oldest > STUCK_MUTATION_MS) {
        restartConnection("StalledMutation");
      }
    },
    3000,
  );
}

/** "ok", or what to tell the user after the connection has been down for a moment. */
export function useConnectionStatus(): ConnectionStatus {
  return useStoreSelector(connectionStore, (st) => st.status);
}
