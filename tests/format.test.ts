// What people read: error sentences, durations, storage and memory dates.
import assert from "node:assert/strict";
import { test } from "node:test";
import { friendlyError, isConnectionProblem, TimeoutError, withTimeout } from "../src/lib/errors.ts";
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
  assert.match(friendlyError(new TimeoutError()), /connection/i);
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
