import test from "node:test";
import assert from "node:assert/strict";
import { createPointerClickTracker } from "../src/input/pointer.js";

const event = (overrides = {}) => ({
  pointerId: 1,
  button: 0,
  clientX: 100,
  clientY: 100,
  ...overrides,
});

test("a long primary-pointer hold remains a click", () => {
  const tracker = createPointerClickTracker();
  assert.equal(tracker.start(event()), true);
  // The tracker deliberately has no clock: a 250ms, 900ms, or 1200ms hold
  // has the same result as long as the pointer does not move.
  assert.deepEqual(tracker.end(event()), { handled: true, clicked: true });
  assert.equal(tracker.active, false);
});

test("movement cancels a click and a second pointer cannot hijack it", () => {
  const tracker = createPointerClickTracker();
  assert.equal(tracker.start(event()), true);
  assert.equal(tracker.start(event({ pointerId: 2 })), false);
  assert.equal(tracker.move(event({ pointerId: 2, clientX: 140 })), false);
  assert.equal(tracker.move(event({ clientX: 108 })), true);
  assert.deepEqual(tracker.end(event()), { handled: true, clicked: false });
});

test("pointer cancellation resets the tracker for the next click", () => {
  const tracker = createPointerClickTracker();
  assert.equal(tracker.start(event()), true);
  assert.equal(tracker.cancel(event()), true);
  assert.deepEqual(tracker.end(event()), { handled: false, clicked: false });
  assert.equal(tracker.start(event({ pointerId: 3 })), true);
  assert.deepEqual(
    tracker.end(event({ pointerId: 3 })),
    { handled: true, clicked: true }
  );
});
