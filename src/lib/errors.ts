// The one place that turns whatever a Convex call, BLE call or fetch threw into a sentence a
// person can act on. Raw errors look like "[CONVEX A(push:sendTest)] Connection lost while action
// was in flight\n  Called by client"; none of that belongs in an alert.

const CONNECTION_LOST = /Connection lost while action was in flight/i;
/** React Native's own fetch / socket failures. */
const NETWORK = /network request failed|failed to fetch|the internet connection appears to be offline|could not connect to the server|network connection was lost/i;
/** Marks a message that came from a function running on the server, not from this phone. */
const FROM_SERVER = /Uncaught \w*Error|Server Error|\[Request ID:/;

/** This phone gave up waiting (withTimeout). The call itself may still be running on the server. */
export class TimeoutError extends Error {
  constructor(message = "Timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

/** The socket dropped while an action was in flight: its result is lost, and Convex doesn't retry it. */
export function isConnectionLost(e: unknown): boolean {
  return typeof e !== "string" && CONNECTION_LOST.test(rawMessage(e));
}

/** Only this phone's own deadline. A server error that mentions a timeout is the server's business. */
export function isTimeout(e: unknown): boolean {
  return e instanceof TimeoutError;
}

/**
 * The call never reached the server or its answer never came back: dropped socket, or the
 * phone's network stack failing. Not for stored strings (an error saved on a browser task), and
 * not for errors thrown by a server function, whatever their wording.
 */
export function isConnectionProblem(e: unknown): boolean {
  if (typeof e === "string") return false;
  const m = rawMessage(e);
  if (CONNECTION_LOST.test(m)) return true;
  return !FROM_SERVER.test(m) && NETWORK.test(m);
}

function rawMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    // BLE errors arrive as plain objects ({ message, code } or { reason }), not Errors.
    const o = e as { message?: unknown; reason?: unknown };
    const m = o.message ?? o.reason;
    if (typeof m === "string") return m;
  }
  return typeof e === "string" ? e : "";
}

export const CONNECTION_MESSAGE = "wali couldn't reach the server. Check your connection and try again.";
export const TIMEOUT_MESSAGE = "That's taking longer than it should. Try again in a moment.";

/** One plain sentence for an alert or an inline error. */
export function friendlyError(e: unknown, fallback = "Something went wrong. Try again."): string {
  if (isConnectionProblem(e)) return CONNECTION_MESSAGE;
  if (isTimeout(e)) return TIMEOUT_MESSAGE;
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
