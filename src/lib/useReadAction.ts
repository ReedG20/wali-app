import { useAction } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useCallback } from "react";
import { reconnectNow } from "./connection";
import { isConnectionLost, withTimeout } from "./errors";

export { isConnectionLost } from "./errors";

/**
 * Convex never retries an action whose WebSocket dropped mid-call ("Connection lost while action
 * was in flight"): an action may have side effects. That happens whenever iOS suspends wali or the
 * network changes, and it surfaced as a "Couldn't load memory" alert. For actions that only READ,
 * running it again is safe, so this wraps useAction with a few retries for that one error.
 *
 * It does NOT retry when this phone merely gave up waiting: the first call is still running on
 * the server then, and a retry would stack a second and third copy of a slow load. A deadline
 * ends in a TimeoutError the screen shows with a "Try again" button instead.
 *
 * Don't use it for actions that change things (connect an app, sync, send).
 */
const DEADLINE_MS = 30_000;
const MAX_ATTEMPTS = 3;

export function useReadAction<F extends FunctionReference<"action">>(ref: F) {
  const run = useAction(ref);
  return useCallback(
    async (...args: Parameters<typeof run>): Promise<Awaited<ReturnType<typeof run>>> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await withTimeout(run(...args), DEADLINE_MS);
        } catch (e) {
          if (attempt >= MAX_ATTEMPTS - 1 || !isConnectionLost(e)) throw e;
          reconnectNow();
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
        }
      }
    },
    [run],
  );
}

/**
 * For actions that DO something (send a test notification, connect an app): one attempt only, but
 * with a deadline, so a dead connection ends in an error the user can act on.
 */
export function useTimedAction<F extends FunctionReference<"action">>(ref: F, ms = 25_000) {
  const run = useAction(ref);
  return useCallback(
    (...args: Parameters<typeof run>): Promise<Awaited<ReturnType<typeof run>>> => withTimeout(run(...args), ms),
    [run, ms],
  );
}
