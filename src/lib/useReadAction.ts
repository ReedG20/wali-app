import { useAction } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useCallback } from "react";
import { reconnectNow } from "./connection";
import { isConnectionLost, isTimeout, withTimeout } from "./errors";

export { isConnectionLost } from "./errors";

/**
 * Convex never retries an action whose WebSocket dropped mid-call ("Connection lost while action
 * was in flight"): an action may have side effects. That happens whenever iOS suspends wali or the
 * network changes, and it surfaced as a "Couldn't load memory" alert. For actions that only READ,
 * retrying is safe, so this wraps useAction with a few retries for that one error, and gives up
 * with a TimeoutError instead of spinning forever when nothing comes back at all.
 * Don't use it for actions that change things (connect an app, sync, send).
 */
const ATTEMPT_TIMEOUT_MS = 15_000;
const MAX_ATTEMPTS = 3;

export function useReadAction<F extends FunctionReference<"action">>(ref: F) {
  const run = useAction(ref);
  return useCallback(
    async (...args: Parameters<typeof run>): Promise<Awaited<ReturnType<typeof run>>> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await withTimeout(run(...args), ATTEMPT_TIMEOUT_MS);
        } catch (e) {
          const retryable = isConnectionLost(e) || isTimeout(e);
          if (attempt >= MAX_ATTEMPTS - 1 || !retryable) throw e;
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
