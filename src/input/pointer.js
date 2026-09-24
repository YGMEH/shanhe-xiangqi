const DEFAULT_MOVEMENT_THRESHOLD = 7;

/**
 * Tracks a primary-pointer click without using elapsed time.
 *
 * A click can legitimately last a long time on a slow frame or a touch
 * device, so duration must not decide whether a move is submitted. Pointer
 * identity and movement are the stable signals; cancellation also makes sure
 * a pointer that leaves the canvas cannot poison the next click.
 */
export function createPointerClickTracker(
  movementThreshold = DEFAULT_MOVEMENT_THRESHOLD
) {
  let active = null;

  const pointerIdOf = (event) => event.pointerId ?? "primary";
  const matches = (event) => active?.pointerId === pointerIdOf(event);

  return {
    start(event) {
      if (event.button !== 0 || active) return false;
      active = {
        pointerId: pointerIdOf(event),
        x: event.clientX,
        y: event.clientY,
        moved: false,
      };
      return true;
    },

    move(event) {
      if (!matches(event)) return false;
      if (
        Math.hypot(event.clientX - active.x, event.clientY - active.y) >
        movementThreshold
      ) {
        active.moved = true;
      }
      return true;
    },

    end(event) {
      if (!matches(event)) return { handled: false, clicked: false };
      const clicked = event.button === 0 && !active.moved;
      active = null;
      return { handled: true, clicked };
    },

    cancel(event) {
      if (!matches(event)) return false;
      active = null;
      return true;
    },

    reset() {
      active = null;
    },

    get active() {
      return active !== null;
    },
  };
}
