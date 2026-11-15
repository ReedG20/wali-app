import { useMutation } from "convex/react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";
import { reconnectNow } from "./connection";
import { api } from "./convex-api";
import { friendlyError, isTimeout, withTimeout } from "./errors";
import { singleton } from "./runtime";

/** How long a tap waits for the server before saying so instead of looking dead. */
const WAIT_MS = 8000;
/** Don't stack the "Still connecting" alert when several taps time out together. */
const STALLED_ALERT_GAP_MS = 4000;

type Slot = {
  /** The create that's on its way, shared by every New chat button. */
  pending: Promise<string> | null;
  /** The create whose outcome (opening the chat, or its error) has already been shown. */
  handled: Promise<string> | null;
  stalledAlertAt: number;
};
/** Survives Fast Refresh (runtime.ts). */
const slot = () => singleton<Slot>("newChat", () => ({ pending: null, handled: null, stalledAlertAt: 0 }));

/**
 * Starts a chat and opens it. The server makes the thread, so with no connection the tap used to
 * do nothing at all (no chat, no spinner, no error).
 *
 * Every tap waits on the same create, so a second tap never sends a second one and never finds a
 * dead button. Whichever tap sees the create finish opens the chat, once: a double tap doesn't
 * push the same chat twice. If the server hasn't answered within 8 s the tap says so; the create
 * stays queued in the Convex client and lands when the socket is back, and a later tap opens it.
 */
export function useNewChat() {
  const create = useMutation(api.threads.create);
  return useCallback(async () => {
    void Haptics.selectionAsync();
    const st = slot();
    if (!st.pending) {
      const p = (create({}) as Promise<string>).finally(() => {
        if (st.pending === p) st.pending = null;
      });
      // Taps time out and move on; the create itself must never be an unhandled rejection.
      p.catch(() => {});
      st.pending = p;
    }
    const mine = st.pending;
    try {
      const id = await withTimeout(mine, WAIT_MS);
      if (st.handled === mine) return;
      st.handled = mine;
      router.push({ pathname: "/(app)/chats/[id]", params: { id } });
    } catch (e) {
      if (isTimeout(e)) {
        reconnectNow();
        const now = Date.now();
        if (now - st.stalledAlertAt < STALLED_ALERT_GAP_MS) return;
        st.stalledAlertAt = now;
        Alert.alert("Still connecting", "wali can't reach the server right now. Your new chat will be in Chats as soon as it reconnects.");
      } else {
        if (st.handled === mine) return;
        st.handled = mine;
        Alert.alert("Couldn't start a chat", friendlyError(e, "Try again."));
      }
    }
  }, [create]);
}
