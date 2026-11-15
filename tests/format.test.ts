// What people read: error sentences, durations, storage and memory dates.
import assert from "node:assert/strict";
import { test } from "node:test";
import { actionState } from "../src/lib/actionState.ts";
import { mutationIsStuck } from "../src/lib/connectionRules.ts";
import { friendlyError, isConnectionLost, isConnectionProblem, isTimeout, TimeoutError, withTimeout } from "../src/lib/errors.ts";
import { pendantName } from "../src/lib/pendantName.ts";
import { duration, splitDatePrefix, storage } from "../src/lib/time.ts";

test("a dropped Convex action reads as a connection problem, not a stack trace", () => {
  const raw = new Error("[CONVEX A(push:sendTest)] Connection lost while action was in flight\n  Called by client");
  assert.equal(isConnectionProblem(raw), true);
  const text = friendlyError(raw);
  assert.doesNotMatch(text, /CONVEX|Called by client|in flight/);
  assert.match(text, /connection/i);
});

test("server errors keep their message and lose the Convex wrapping", () => {
  const raw = new Error("[CONVEX M(messages:send)] [Request ID: 1f2e3d] Server Error\nUncaught Error: wali is still answering\n    at handler (../convex/messages.ts:52:11)\n\n  Called by client");
  assert.equal(friendlyError(raw), "wali is still answering");
});

test("an error with nothing useful in it falls back", () => {
  assert.equal(friendlyError(new Error("[CONVEX A(agentNode:connections)] Server Error\n  Called by client"), "Try again."), "Try again.");
  assert.equal(friendlyError(undefined, "Try again."), "Try again.");
  assert.equal(friendlyError({ message: "Peripheral not connected" }), "Peripheral not connected");
});

test("withTimeout rejects with a TimeoutError and passes results through", async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 10), TimeoutError);
  assert.equal(await withTimeout(Promise.resolve(7), 1000), 7);
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 1000), /boom/);
  // This phone giving up is not a connection problem: the call may still be running.
  assert.equal(isConnectionProblem(new TimeoutError()), false);
  assert.match(friendlyError(new TimeoutError()), /longer than it should/i);
});

test("durations use one format", () => {
  assert.equal(duration(9_000), "9 sec");
  assert.equal(duration(142_000), "2 min 22 sec");
  assert.equal(duration(120_000), "2 min");
  assert.equal(duration(3_840_000), "1 hr 4 min");
  assert.equal(duration(-5), "0 sec");
});

test("storage is shown in GB once it's big enough", () => {
  assert.equal(storage(121_893), "119 GB");
  assert.equal(storage(512), "512 MB");
  assert.equal(storage(2_048), "2.0 GB");
});

test("memory date stamps are split off the text", () => {
  const a = splitDatePrefix("[2026-11-15] They plan to ask Ife on Monday.");
  assert.equal(a.text, "They plan to ask Ife on Monday.");
  assert.equal(a.date?.getFullYear(), 2026);
  assert.equal(a.date?.getMonth(), 10);
  assert.equal(a.date?.getDate(), 15);
  assert.deepEqual(splitDatePrefix("No stamp here [2026-11-15]"), { text: "No stamp here [2026-11-15]", date: null });
});

test("the pendant's old Bluetooth name is shown as wali", () => {
  assert.equal(pendantName("Mind-Pendant"), "wali pendant");
  assert.equal(pendantName(null), "wali pendant");
  assert.equal(pendantName("Ife's pendant"), "Ife's pendant");
});

test("a server-stored error string is not mistaken for this phone's connection", () => {
  assert.equal(isConnectionProblem("Request timed out"), false);
  assert.equal(friendlyError("Request timed out", "It didn't finish."), "Request timed out");
});

test("a timeout on the server is the server's error, not this phone's connection", () => {
  const server = new Error("[CONVEX A(agentNode:memoryOverview)] [Request ID: 9a] Server Error\nUncaught Error: Supermemory request timed out\n    at handler\n\n  Called by client");
  assert.equal(isConnectionProblem(server), false);
  assert.equal(isTimeout(server), false);
  assert.equal(isConnectionLost(server), false);
  assert.equal(friendlyError(server), "Supermemory request timed out");
  const serverNet = new Error("[CONVEX A(push:sendTest)] Server Error\nUncaught TypeError: Network request failed\n  Called by client");
  assert.equal(isConnectionProblem(serverNet), false);
  // The phone's own fetch failing is a connection problem.
  assert.equal(isConnectionProblem(new TypeError("Network request failed")), true);
});

test("an approval that became a browser run follows the run", () => {
  const done = { status: "done" } as const;
  assert.equal(actionState(done, { status: "running" }), "running");
  assert.equal(actionState(done, { status: "starting" }), "running");
  assert.equal(actionState(done, { status: "completed" }), "done");
  assert.equal(actionState(done, { status: "failed" }), "failed");
  assert.equal(actionState({ status: "running" }, { status: "cancelled" }), "failed");
  // No run attached: the approval's own status.
  assert.equal(actionState({ status: "pending" }, null), "pending");
  assert.equal(actionState({ status: "approved" }, null), "running");
  assert.equal(actionState({ status: "declined" }, null), "declined");
  assert.equal(actionState({ status: "failed" }, null), "failed");
  assert.equal(actionState({ status: "done" }, null), "done");
});

test("a message written offline is not 'stuck' the moment the connection returns", () => {
  const now = 1_000_000;
  const cs = (sentAgoMs: number, over: Partial<{ isWebSocketConnected: boolean; inflightMutations: number; inflightActions: number }> = {}) => ({
    isWebSocketConnected: true,
    inflightMutations: 1,
    inflightActions: 0,
    timeOfOldestInflightRequest: new Date(now - sentAgoMs),
    ...over,
  });
  // Sent 60 s ago while offline; the socket opened 1 s ago: it has had 1 s, not 60.
  assert.equal(mutationIsStuck(cs(60_000), now - 1_000, now, false), false);
  // Same message, and the socket has now been open 11 s with no answer: stuck.
  assert.equal(mutationIsStuck(cs(60_000), now - 11_000, now, false), true);
  // Sent 11 s ago on a socket that has been open for a minute: stuck.
  assert.equal(mutationIsStuck(cs(11_000), now - 60_000, now, false), true);
  assert.equal(mutationIsStuck(cs(5_000), now - 60_000, now, false), false);
  // Sent a minute ago and the socket has been open a minute, but the app only came back to the
  // front a second ago (connection.ts passes the later of the two): suspended time doesn't count.
  assert.equal(mutationIsStuck(cs(60_000), Math.max(now - 60_000, now - 1_000), now, false), false);
  // Never while an action is in flight, while paused for sign-in, or while disconnected.
  assert.equal(mutationIsStuck(cs(60_000, { inflightActions: 1 }), now - 60_000, now, false), false);
  assert.equal(mutationIsStuck(cs(60_000), now - 60_000, now, true), false);
  assert.equal(mutationIsStuck(cs(60_000, { isWebSocketConnected: false }), 0, now, false), false);
  assert.equal(mutationIsStuck(cs(60_000, { inflightMutations: 0 }), now - 60_000, now, false), false);
});
