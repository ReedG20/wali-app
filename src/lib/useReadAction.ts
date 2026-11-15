import { useAction } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useCallback } from "react";

/**
 * Convex never retries an action whose WebSocket dropped mid-call ("Connection lost while action
 * was in flight"): an action may have side effects. That happens whenever iOS suspends wali or the
 * network changes, and it surfaced as a "Couldn't load memory" alert. For actions that only READ,
 * retrying is safe, so this wraps useAction with a couple of quick retries for that one error.
 * Don't use it for actions that change things (connect an app, sync, send).
 */
const CONNECTION_LOST = /Connection lost while action was in flight/i;

export function isConnectionLost(e: unknown): boolean {
  return CONNECTION_LOST.test(e instanceof Error ? e.message : String(e));
}

export function useReadAction<F extends FunctionReference<"action">>(ref: F) {
  const run = useAction(ref);
  return useCallback(
    async (...args: Parameters<typeof run>): Promise<Awaited<ReturnType<typeof run>>> => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await run(...args);
        } catch (e) {
          if (attempt >= 2 || !isConnectionLost(e)) throw e;
          await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
        }
      }
    },
    [run],
  );
}
