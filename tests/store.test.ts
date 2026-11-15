// Store rules that keep background CPU down (see src/lib/store.ts).
import { test } from "node:test";
import assert from "node:assert/strict";

const { createStore, setUiActive } = await import("../src/lib/store.ts");

test("set() with nothing changed does not notify", () => {
  const s = createStore({ a: 1, b: "x" });
  let n = 0;
  s.subscribe(() => n++);
  s.set({ a: 1 });
  s.set({ a: 1, b: "x" });
  assert.equal(n, 0);
  s.set({ a: 2 });
  assert.equal(n, 1);
  assert.equal(s.get().a, 2);
});

test("while the app is inactive, state updates but React is notified once on return", () => {
  const s = createStore({ v: 0 });
  let n = 0;
  s.subscribe(() => n++);
  setUiActive(false);
  try {
    for (let i = 1; i <= 50; i++) s.set({ v: i });
    assert.equal(n, 0, "no renders in the background");
    assert.equal(s.get().v, 50, "get() is always current");
  } finally {
    setUiActive(true);
  }
  assert.equal(n, 1, "one catch-up notification");
  setUiActive(true);
  assert.equal(n, 1, "re-activating again doesn't re-notify");
});
