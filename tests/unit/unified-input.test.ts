import { beforeEach, describe, expect, test } from 'bun:test';
import {
  createUnifiedInput,
  type UnifiedInputState,
} from '../../src/js/core/unified-input.ts';
import {
  flushAnimationFrame,
  installAnimationFrameController,
} from '../environment/animation-frame.ts';
import { replaceProperty } from '../test-helpers.ts';

const flushInput = async () => {
  // Fire the pending requestAnimationFrame synchronously instead of waiting
  // out the environment's 16ms auto-advance timer.
  flushAnimationFrame();
  await Promise.resolve();
};

beforeEach(() => {
  // createUnifiedInput schedules its poll via the shared animation-frame
  // controller. A prior file in the same process can replace the rAF globals
  // or leave the queue in a stale state; a fresh install guarantees the
  // controlled rAF is the one the input loop registers against.
  installAnimationFrameController();
});

function createTarget() {
  const target = document.createElement('div');
  target.tabIndex = 0;
  target.setPointerCapture = () => {};
  target.releasePointerCapture = () => {};
  target.hasPointerCapture = () => false;
  target.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  document.body.appendChild(target);
  return target;
}

function dispatchPointer(
  target: HTMLElement,
  type: string,
  {
    clientX,
    clientY,
    pointerId = 1,
    pointerType = 'mouse',
  }: {
    clientX: number;
    clientY: number;
    pointerId?: number;
    pointerType?: string;
  },
) {
  const event = new window.Event(type, {
    bubbles: true,
    cancelable: true,
  }) as Event & PointerEvent;
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
    pointerId: { value: pointerId },
    pointerType: { value: pointerType },
  });
  target.dispatchEvent(event);
}

function dispatchWheel(target: HTMLElement, deltaY: number) {
  const event = new window.Event('wheel', {
    bubbles: true,
    cancelable: true,
  }) as Event & WheelEvent;
  Object.defineProperty(event, 'deltaY', { value: deltaY });
  target.dispatchEvent(event);
}

describe('unified input desktop performance state', () => {
  test('captures hover, wheel, drag, and accent pulses from pointer input', async () => {
    const target = createTarget();
    let latestState: UnifiedInputState | null = null;
    const input = createUnifiedInput({
      target,
      onInput: (state) => {
        latestState = state;
      },
    });

    dispatchPointer(target, 'pointermove', { clientX: 150, clientY: 25 });
    await flushInput();
    if (!latestState) {
      throw new Error('Expected a unified input state after pointer hover.');
    }
    const hoverState = latestState as UnifiedInputState;
    expect(hoverState.performance.hoverActive).toBe(true);
    expect(hoverState.performance.hover?.x).toBeCloseTo(0.5, 2);
    expect(hoverState.performance.hover?.y).toBeCloseTo(0.5, 2);

    dispatchWheel(target, -120);
    await flushInput();
    if (!latestState) {
      throw new Error('Expected a unified input state after wheel input.');
    }
    const wheelState = latestState as UnifiedInputState;
    expect(wheelState.performance.wheelAccum).toBeGreaterThan(0);

    dispatchPointer(target, 'pointerdown', { clientX: 100, clientY: 50 });
    await flushInput();
    if (!latestState) {
      throw new Error('Expected a unified input state after pointer press.');
    }
    const accentState = latestState as UnifiedInputState;
    expect(accentState.performance.accentPulse).toBeGreaterThan(0);

    input.dispose();
    target.remove();
  });

  test('polls an already-connected gamepad on startup', async () => {
    const target = createTarget();
    const originalGetGamepads = navigator.getGamepads;
    let latestState: UnifiedInputState | null = null;
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: () => [
        {
          connected: true,
          axes: [0.75, -0.5, 0, 0],
          buttons: [],
        },
      ],
    });

    const input = createUnifiedInput({
      target,
      onInput: (state) => {
        latestState = state;
      },
    });

    await flushInput();

    if (!latestState) {
      throw new Error(
        'Expected a unified input state for a connected gamepad.',
      );
    }
    const state = latestState as UnifiedInputState;
    expect(state.source).toBe('gamepad');
    expect(state.performance.sourceFlags.gamepad).toBe(true);
    expect(state.primary?.normalizedX).toBeGreaterThan(0);
    expect(state.primary?.normalizedY).toBeGreaterThan(0);

    input.dispose();
    target.remove();
    Object.defineProperty(navigator, 'getGamepads', {
      configurable: true,
      value: originalGetGamepads,
    });
  });
});

describe('unified input multi-touch gestures', () => {
  const pinch = (
    target: HTMLElement,
    type: string,
    id: number,
    x: number,
    y: number,
  ) =>
    dispatchPointer(target, type, {
      clientX: x,
      clientY: y,
      pointerId: id,
      pointerType: 'touch',
    });

  test('rotation is unwrapped across the +/-pi seam', async () => {
    const target = createTarget();
    let latest: UnifiedInputState | null = null;
    const input = createUnifiedInput({
      target,
      onInput: (state) => {
        latest = state;
      },
      keyboardEnabled: false,
      gamepadEnabled: false,
    });

    // The second finger sits left of the first, so the pair's angle starts
    // just under +pi — the seam atan2 folds at.
    pinch(target, 'pointerdown', 1, 100, 50);
    pinch(target, 'pointerdown', 2, 20, 51);
    await flushInput();
    pinch(target, 'pointermove', 2, 20, 49);
    await flushInput();

    const state = latest as UnifiedInputState | null;
    // A ~1.5 degree turn is a ~1.5 degree turn, not a reported full circle.
    expect(Math.abs(state?.gesture?.rotation ?? 0)).toBeLessThan(0.2);

    input.dispose();
    target.remove();
  });

  test('lifting one of three fingers does not jump scale or rotation', async () => {
    const target = createTarget();
    let latest: UnifiedInputState | null = null;
    const input = createUnifiedInput({
      target,
      onInput: (state) => {
        latest = state;
      },
      keyboardEnabled: false,
      gamepadEnabled: false,
    });

    pinch(target, 'pointerdown', 1, 100, 50);
    pinch(target, 'pointerdown', 2, 120, 50);
    pinch(target, 'pointerdown', 3, 20, 50);
    await flushInput();
    await flushInput();
    // Nothing moves — only the first finger comes off.
    pinch(target, 'pointerup', 1, 100, 50);
    await flushInput();

    const state = latest as UnifiedInputState | null;
    expect(state?.gesture?.scale ?? 1).toBeCloseTo(1, 1);
    expect(Math.abs(state?.gesture?.rotation ?? 0)).toBeLessThan(0.1);
    // The swap used to hand the primary slot to a different finger and
    // report the gap between two hands as one frame of drag.
    expect(state?.performance.dragIntensity ?? 0).toBeLessThan(0.1);

    input.dispose();
    target.remove();
  });

  test('a key held while focus moves away does not stay held', async () => {
    const target = createTarget();
    // The synthetic pinch integrates against deltaMs, and the release timer
    // counts real milliseconds, so this one needs a clock it can move.
    let fakeNow = 10_000;
    const restoreNow = replaceProperty(performance, 'now', () => fakeNow);
    let latest: UnifiedInputState | null = null;
    const input = createUnifiedInput({
      target,
      onInput: (state) => {
        latest = state;
      },
      gamepadEnabled: false,
    });

    const keydown = new window.Event('keydown', { bubbles: true }) as Event &
      KeyboardEvent;
    Object.defineProperties(keydown, {
      key: { value: '=' },
      repeat: { value: false },
    });
    target.dispatchEvent(keydown);
    fakeNow += 16;
    await flushInput();
    fakeNow += 16;
    await flushInput();
    expect(
      (latest as UnifiedInputState | null)?.gesture?.scale ?? 1,
    ).toBeGreaterThan(1);

    // Focus moves on mid-press, so the keyup lands somewhere else and this
    // surface never hears it.
    target.dispatchEvent(new window.Event('blur'));
    // One frame, one frame's worth of time: the release ramp only advances on
    // frames the loop schedules, and with the held set empty there is nothing
    // left to keep scheduling them. Jumping the clock past the ramp before
    // flushing would hide exactly that.
    fakeNow += 16;
    await flushInput();
    expect((latest as UnifiedInputState | null)?.gesture).toBeNull();

    input.dispose();
    target.remove();
    restoreNow();
  });

  test('an ordinary key release runs the gesture ramp to completion', async () => {
    const target = createTarget();
    let fakeNow = 20_000;
    const restoreNow = replaceProperty(performance, 'now', () => fakeNow);
    let latest: UnifiedInputState | null = null;
    const input = createUnifiedInput({
      target,
      onInput: (state) => {
        latest = state;
      },
      gamepadEnabled: false,
    });

    const keydown = new window.Event('keydown', { bubbles: true }) as Event &
      KeyboardEvent;
    Object.defineProperties(keydown, {
      key: { value: '=' },
      repeat: { value: false },
    });
    target.dispatchEvent(keydown);
    fakeNow += 16;
    await flushInput();
    fakeNow += 16;
    await flushInput();
    expect(
      (latest as UnifiedInputState | null)?.gesture?.scale ?? 1,
    ).toBeGreaterThan(1);

    const keyup = new window.Event('keyup', { bubbles: true }) as Event &
      KeyboardEvent;
    Object.defineProperty(keyup, 'key', { value: '=' });
    target.dispatchEvent(keyup);
    // The held set is empty from here on, so the ramp only finishes if the
    // loop keeps scheduling itself while the synthetic gesture is live.
    for (let frame = 0; frame < 40; frame += 1) {
      fakeNow += 16;
      await flushInput();
    }
    expect((latest as UnifiedInputState | null)?.gesture).toBeNull();

    input.dispose();
    target.remove();
    restoreNow();
  });
});

/**
 * Steering used to be WASD plus the bare arrows, of which the shell had
 * claimed A, S and both arrows — so the cluster could go up, down and right
 * and never left — and it only moved the scene while Space or Enter was also
 * held, with Space bound to stop-audio.
 */
describe('steering the stage by keyboard', () => {
  const steer = (target: HTMLElement, key: string, shiftKey = true) => {
    const keydown = new window.Event('keydown', { bubbles: true }) as Event &
      KeyboardEvent;
    Object.defineProperties(keydown, {
      key: { value: key },
      shiftKey: { value: shiftKey },
      repeat: { value: false },
    });
    target.dispatchEvent(keydown);
    return keydown;
  };

  test('a shifted arrow drags the scene with no second key held', async () => {
    const target = createTarget();
    let latest: UnifiedInputState | null = null;
    const input = createUnifiedInput({
      target,
      onInput: (state) => {
        latest = state;
      },
      gamepadEnabled: false,
    });

    steer(target, 'ArrowLeft');
    await flushInput();
    await flushInput();

    const state = latest as UnifiedInputState | null;
    expect(state?.isPressed).toBe(true);
    // Left is the direction the old cluster could never go.
    expect(state?.dragDelta.x ?? 0).toBeLessThan(0);

    input.dispose();
    target.remove();
  });

  test('an unshifted arrow is left to the shell entirely', async () => {
    const target = createTarget();
    let latest: UnifiedInputState | null = null;
    const input = createUnifiedInput({
      target,
      onInput: (state) => {
        latest = state;
      },
      gamepadEnabled: false,
    });

    const event = steer(target, 'ArrowLeft', false);
    await flushInput();
    await flushInput();

    expect(event.defaultPrevented).toBe(false);
    const state = latest as UnifiedInputState | null;
    expect(state?.isPressed ?? false).toBe(false);
    expect(state?.dragDelta.x ?? 0).toBe(0);

    input.dispose();
    target.remove();
  });
});
