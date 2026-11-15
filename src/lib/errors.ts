// Turns whatever a Convex call, BLE call or fetch threw into one sentence a person can act on.
// Raw errors look like "[CONVEX A(push:sendTest)] Connection lost while action was in flight
// Called by client"; none of that belongs in an alert.

const CONNECTION_LOST = /Connection lost while action was in flight/i;
const TIMED_OUT = /timed out/i;
const NETWORK = /network request failed|failed to fetch|the internet connection appears to be offline|could not connect to the server|network connection was lost/i;

export class TimeoutError extends Error {
  constructor(message = "Timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export function isConnectionLost(e: unknown): boolean {
  return CONNECTION_LOST.test(rawMessage(e));
}

export function isTimeout(e: unknown): boolean {
  return e instanceof TimeoutError || (typeof e !== "string" && TIMED_OUT.test(rawMessage(e)));
}

/**
 * Connection dropped, timed out or offline: worth retrying, and never the user's fault.
 * Only for errors thrown on this phone. A string stored by the server ("Request timed out" on a
 * browser task) is about the server's own work, not this phone's connection.
 */
export function isConnectionProblem(e: unknown): boolean {
  if (typeof e === "string") return false;
  const m = rawMessage(e);
  return CONNECTION_LOST.test(m) || isTimeout(e) || NETWORK.test(m);
}

function rawMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; reason?: unknown };
    const m = o.message ?? o.reason;
    if (typeof m === "string") return m;
  }
  return typeof e === "string" ? e : "";
}

export const CONNECTION_MESSAGE = "wali couldn't reach the server. Check your connection and try again.";

/** One plain sentence for an alert or an inline error. */
export function friendlyError(e: unknown, fallback = "Something went wrong. Try again."): string {
  if (isConnectionProblem(e)) return CONNECTION_MESSAGE;
  const cleaned = rawMessage(e)
    // "[CONVEX A(agentNode:connections)] [Request ID: abc] Server Error"
    .replace(/\[CONVEX [^\]]*\]\s*/g, "")
    .replace(/\[Request ID: [^\]]*\]\s*/g, "")
    .replace(/^.*Uncaught (?:\w*Error): /s, "")
    .split("\n")[0]
    .replace(/\s*Called by client\s*$/i, "")
    .trim();
  if (!cleaned || /^server error$/i.test(cleaned)) return fallback;
  return cleaned;
}

/** Reject with a TimeoutError if `p` hasn't settled after `ms`. The call itself keeps running. */
export function withTimeout<T>(p: Promise<T>, ms: number, message?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
