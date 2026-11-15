import { useMutation } from "convex/react";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";
import { reconnectNow } from "./connection";
import { api } from "./convex-api";
import { friendlyError, isTimeout, withTimeout } from "./errors";

/** One "new chat" at a time across every button that offers it. */
let creating = false;
/** The create is queued behind a dead connection and we've already said so once. */
let stalled = false;

const STALLED_TITLE = "Still connecting";
const STALLED_BODY = "wali can't reach the server right now. Your new chat will appear in Chats as soon as it reconnects.";

/** How long to wait for the server before telling the user instead of looking dead. */
const WAIT_MS = 8000;

/**
 * Starts a chat and opens it. The server makes the thread, so with no connection the tap used to
 * do nothing at all (no chat, no spinner, no error) and every extra tap queued another empty chat
 * for later. Now: repeat taps are ignored while one is on its way, and after a few seconds
 * without an answer we say so. The queued create still lands once the socket is back; the chat
 * then shows up in the list rather than opening unprompted.
 */
export function useNewChat() {
  const create = useMutation(api.threads.create);
  return useCallback(async () => {
    if (creating) {
      // Never a dead button: a tap while the first one is still queued gets the same explanation.
      if (stalled) Alert.alert(STALLED_TITLE, STALLED_BODY);
      return;
    }
    creating = true;
    void Haptics.selectionAsync();
    const pending = create({}) as Promise<string>;
    try {
      const id = await withTimeout(pending, WAIT_MS);
      router.push({ pathname: "/(app)/chats/[id]", params: { id } });
    } catch (e) {
      if (isTimeout(e)) {
        reconnectNow();
        stalled = true;
        Alert.alert(STALLED_TITLE, STALLED_BODY);
        // Keep ignoring taps until the queued create settles, so they don't pile up.
        await pending.catch(() => {});
      } else {
        Alert.alert("Couldn't start a chat", friendlyError(e, "Try again."));
      }
    } finally {
      creating = false;
      stalled = false;
    }
  }, [create]);
}
