import { describe, expect, test } from 'bun:test';
import {
  createUnifiedInput,
  type UnifiedInputState,
} from '../assets/js/core/unified-input.ts';

const flushInput = async () => {
  await new Promise((resolve) => setTimeout(resolve, 24));
};

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
