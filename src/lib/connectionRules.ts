// Pure decisions used by connection.ts, kept apart from the Convex client so they can be tested.

/** A mutation with no answer for this long, on a socket open at least this long, means nothing is getting through. */
export const STUCK_MUTATION_MS = 10_000;

/**
 * Is a mutation stuck on a socket that should be delivering it?
 *
 * Convex stamps a request with the time it was first sent and keeps that stamp across
 * reconnects. A message written while offline is therefore "old" the instant the connection
 * returns, without being stuck at all, so its age is counted from the later of when it was sent
 * and when this socket opened.
 */
export function mutationIsStuck(
  cs: { isWebSocketConnected: boolean; inflightMutations: number; inflightActions: number; timeOfOldestInflightRequest: Date | null },
  /** When this socket opened, or when the app last came to the front if that's later. 0 = not open. */
  since: number,
  now: number,
  paused: boolean,
): boolean {
  if (!cs.isWebSocketConnected || paused || !since) return false;
  // With an action in flight the oldest request may be that action, and actions can be slow.
  if (cs.inflightMutations === 0 || cs.inflightActions > 0) return false;
  const sent = cs.timeOfOldestInflightRequest?.getTime();
  if (!sent) return false;
  return now - Math.max(sent, since) > STUCK_MUTATION_MS;
}
