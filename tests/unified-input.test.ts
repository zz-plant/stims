import { describe, expect, test } from 'bun:test';
import {
  createUnifiedInput,
  type UnifiedInputState,
} from '../assets/js/utils/unified-input.ts';

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
    expect(latestState?.performance.hoverActive).toBe(true);
    expect(latestState?.performance.hover?.x).toBeCloseTo(0.5, 2);
    expect(latestState?.performance.hover?.y).toBeCloseTo(0.5, 2);

    dispatchWheel(target, -120);
    await flushInput();
    expect(latestState?.performance.wheelAccum).toBeGreaterThan(0);

    dispatchPointer(target, 'pointerdown', { clientX: 100, clientY: 50 });
    dispatchPointer(target, 'pointermove', { clientX: 130, clientY: 60 });
    await flushInput();
    expect(latestState?.performance.dragIntensity).toBeGreaterThan(0);
    expect(latestState?.performance.accentPulse).toBeGreaterThan(0);

    input.dispose();
    target.remove();
  });

  test('tracks keyboard action pulses and keyboard source movement', async () => {
    const target = createTarget();
    let latestState: UnifiedInputState | null = null;
    const input = createUnifiedInput({
      target,
      onInput: (state) => {
        latestState = state;
      },
    });

    target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'q' }));
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key: '1' }));
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'r' }));
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ' }));
    input.scheduleFrame();
    await flushInput();

    expect(latestState?.source).toBe('keyboard');
    expect(latestState?.performance.actions.modePrevious).toBeGreaterThan(0);
    expect(latestState?.performance.actions.quickLook1).toBeGreaterThan(0);
    expect(latestState?.performance.actions.remix).toBeGreaterThan(0);
    expect(latestState?.performance.actions.accent).toBeGreaterThan(0);
    expect(latestState?.performance.sourceFlags.keyboard).toBe(true);

    input.dispose();
    target.remove();
  });
});
