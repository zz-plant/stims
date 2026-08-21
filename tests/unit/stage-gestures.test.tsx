import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createElement, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { useStageGesture } from '../../src/js/frontend/hooks/useStageGesture.ts';
import { replaceProperty } from '../test-helpers.ts';
import { createToyContainer } from '../toy-test-helpers.ts';

function createGestureHarness() {
  const callbacks = {
    shuffle: mock(() => {}),
    previous: mock(() => {}),
    openBrowse: mock(() => {}),
    closePanel: mock(() => {}),
    toggleFavorite: mock(() => {}),
    toggleFullscreen: mock(() => {}),
    status: mock(() => {}),
  };

  function Harness() {
    const stageRef = useRef<HTMLDivElement | null>(null);
    useStageGesture({
      enabled: true,
      stageRef,
      handleShufflePreset: callbacks.shuffle,
      handlePreviousPreset: callbacks.previous,
      openBrowse: callbacks.openBrowse,
      closePanel: callbacks.closePanel,
      toggleFavoritePreset: callbacks.toggleFavorite,
      handleToggleFullscreen: callbacks.toggleFullscreen,
      setStatusMessage: callbacks.status,
      hapticsEnabled: false,
      longPressMs: 20,
    });
    return createElement('div', { ref: stageRef, 'data-stage': 'true' });
  }

  return { callbacks, Harness };
}

function dispatchTouch(
  stage: HTMLElement,
  type: string,
  { pointerId, x, y }: { pointerId: number; x: number; y: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { configurable: true, value: pointerId },
    pointerType: { configurable: true, value: 'touch' },
    clientX: { configurable: true, value: x },
    clientY: { configurable: true, value: y },
  });
  stage.dispatchEvent(event);
}

describe('useStageGesture touch gestures', () => {
  let toy: ReturnType<typeof createToyContainer>;
  let root: ReturnType<typeof createRoot>;
  let restorePerformance: (() => void) | null = null;

  beforeEach(() => {
    toy = createToyContainer('stage-gestures-test');
    // The swipe debounce compares performance.now() against a 0-based ref.
    // Bun's process-uptime clock starts near zero, so offset it well past
    // SWIPE_DEBOUNCE_MS while keeping the real clock advancing for React.
    const realNow = performance.now.bind(performance);
    const offsetNow = () => realNow() + 1_000_000;
    restorePerformance = replaceProperty(performance, 'now', offsetNow);
  });

  afterEach(() => {
    restorePerformance?.();
    restorePerformance = null;
    root?.unmount();
    toy.dispose();
    document.body.innerHTML = '';
  });

  function mount() {
    const { callbacks, Harness } = createGestureHarness();
    root = createRoot(toy.container);
    flushSync(() => {
      root.render(createElement(Harness));
    });
    const stage = toy.container.querySelector<HTMLDivElement>('[data-stage]');
    if (!stage) throw new Error('stage did not mount');
    return { callbacks, stage };
  }

  test('swiping left shuffles to the next preset', () => {
    const { callbacks, stage } = mount();

    dispatchTouch(stage, 'pointerdown', { pointerId: 1, x: 300, y: 100 });
    dispatchTouch(stage, 'pointerup', { pointerId: 1, x: 100, y: 100 });

    expect(callbacks.shuffle).toHaveBeenCalledTimes(1);
    expect(callbacks.previous).not.toHaveBeenCalled();
  });

  test('swiping right moves to the previous preset', () => {
    const { callbacks, stage } = mount();

    dispatchTouch(stage, 'pointerdown', { pointerId: 1, x: 100, y: 100 });
    dispatchTouch(stage, 'pointerup', { pointerId: 1, x: 300, y: 100 });

    expect(callbacks.previous).toHaveBeenCalledTimes(1);
    expect(callbacks.shuffle).not.toHaveBeenCalled();
  });

  test('a pinch never reads as a swipe, tap, or long-press', () => {
    const { callbacks, stage } = mount();

    dispatchTouch(stage, 'pointerdown', { pointerId: 1, x: 200, y: 200 });
    dispatchTouch(stage, 'pointerdown', { pointerId: 2, x: 300, y: 200 });
    dispatchTouch(stage, 'pointermove', { pointerId: 1, x: 100, y: 200 });
    dispatchTouch(stage, 'pointermove', { pointerId: 2, x: 400, y: 200 });
    dispatchTouch(stage, 'pointerup', { pointerId: 1, x: 100, y: 200 });
    dispatchTouch(stage, 'pointerup', { pointerId: 2, x: 400, y: 200 });

    expect(callbacks.shuffle).not.toHaveBeenCalled();
    expect(callbacks.previous).not.toHaveBeenCalled();
    expect(callbacks.toggleFavorite).not.toHaveBeenCalled();
    expect(callbacks.toggleFullscreen).not.toHaveBeenCalled();
  });

  test('a cancelled touch releases tracking so the next swipe works', () => {
    const { callbacks, stage } = mount();

    dispatchTouch(stage, 'pointerdown', { pointerId: 1, x: 300, y: 100 });
    dispatchTouch(stage, 'pointercancel', { pointerId: 1, x: 150, y: 100 });
    dispatchTouch(stage, 'pointerdown', { pointerId: 2, x: 300, y: 100 });
    dispatchTouch(stage, 'pointerup', { pointerId: 2, x: 100, y: 100 });

    expect(callbacks.shuffle).toHaveBeenCalledTimes(1);
  });

  test('a long press toggles the favorite', async () => {
    const { callbacks, stage } = mount();

    dispatchTouch(stage, 'pointerdown', { pointerId: 1, x: 200, y: 200 });
    await new Promise((resolve) => setTimeout(resolve, 60));
    dispatchTouch(stage, 'pointerup', { pointerId: 1, x: 200, y: 200 });

    expect(callbacks.toggleFavorite).toHaveBeenCalledTimes(1);
    expect(callbacks.shuffle).not.toHaveBeenCalled();
  });

  test('a double tap toggles fullscreen', () => {
    const { callbacks, stage } = mount();

    dispatchTouch(stage, 'pointerdown', { pointerId: 1, x: 200, y: 200 });
    dispatchTouch(stage, 'pointerup', { pointerId: 1, x: 200, y: 200 });
    dispatchTouch(stage, 'pointerdown', { pointerId: 2, x: 200, y: 200 });
    dispatchTouch(stage, 'pointerup', { pointerId: 2, x: 200, y: 200 });

    expect(callbacks.toggleFullscreen).toHaveBeenCalledTimes(1);
  });

  test('swiping up opens browse', () => {
    const { callbacks, stage } = mount();

    dispatchTouch(stage, 'pointerdown', { pointerId: 1, x: 200, y: 300 });
    dispatchTouch(stage, 'pointerup', { pointerId: 1, x: 200, y: 100 });
    expect(callbacks.openBrowse).toHaveBeenCalledTimes(1);
  });

  test('swiping down closes the panel', () => {
    const { callbacks, stage } = mount();

    dispatchTouch(stage, 'pointerdown', { pointerId: 2, x: 200, y: 100 });
    dispatchTouch(stage, 'pointerup', { pointerId: 2, x: 200, y: 300 });
    expect(callbacks.closePanel).toHaveBeenCalledTimes(1);
  });
});

describe('useStageGesture pointer bookkeeping', () => {
  let toy: ReturnType<typeof createToyContainer>;
  let root: ReturnType<typeof createRoot>;
  let restorePerformance: (() => void) | null = null;

  beforeEach(() => {
    toy = createToyContainer('stage-gesture-bookkeeping-test');
    const realNow = performance.now.bind(performance);
    restorePerformance = replaceProperty(
      performance,
      'now',
      () => realNow() + 1_000_000,
    );
  });

  afterEach(() => {
    restorePerformance?.();
    restorePerformance = null;
    root?.unmount();
    toy.dispose();
    document.body.innerHTML = '';
  });

  test('a touch that started on a control cannot unlock the pinch guard', () => {
    const { callbacks, Harness } = createGestureHarness();
    root = createRoot(toy.container);
    flushSync(() => {
      root.render(createElement(Harness));
    });
    const stage = toy.container.querySelector<HTMLDivElement>('[data-stage]');
    if (!stage) throw new Error('stage did not mount');
    const control = document.createElement('button');
    stage.appendChild(control);

    // One finger on the stage, a second on an overlay control that comes and
    // goes. The control's touches are not the stage's to count — when they
    // were, the tally fell back to zero and the next real finger was tracked
    // as a fresh single touch, so lifting out of a two-finger pinch scrubbed
    // the preset.
    dispatchTouch(stage, 'pointerdown', { pointerId: 1, x: 200, y: 200 });
    dispatchTouch(control, 'pointerdown', { pointerId: 9, x: 40, y: 40 });
    dispatchTouch(control, 'pointerup', { pointerId: 9, x: 40, y: 40 });
    dispatchTouch(stage, 'pointerdown', { pointerId: 2, x: 300, y: 200 });
    dispatchTouch(stage, 'pointerup', { pointerId: 1, x: 100, y: 200 });
    dispatchTouch(stage, 'pointerup', { pointerId: 2, x: 400, y: 200 });

    expect(callbacks.shuffle).not.toHaveBeenCalled();
    expect(callbacks.previous).not.toHaveBeenCalled();
  });

  test('a finger that rested on the stage before moving is not a swipe', () => {
    const { callbacks, Harness } = createGestureHarness();
    root = createRoot(toy.container);
    flushSync(() => {
      root.render(createElement(Harness));
    });
    const stage = toy.container.querySelector<HTMLDivElement>('[data-stage]');
    if (!stage) throw new Error('stage did not mount');

    let clock = 5_000_000;
    const restoreClock = replaceProperty(performance, 'now', () => clock);
    dispatchTouch(stage, 'pointerdown', { pointerId: 1, x: 300, y: 100 });
    clock += 4_000;
    dispatchTouch(stage, 'pointerup', { pointerId: 1, x: 100, y: 100 });
    restoreClock();

    expect(callbacks.shuffle).not.toHaveBeenCalled();
  });

  test('a double tap right after a swipe still reaches fullscreen', () => {
    const { callbacks, Harness } = createGestureHarness();
    root = createRoot(toy.container);
    flushSync(() => {
      root.render(createElement(Harness));
    });
    const stage = toy.container.querySelector<HTMLDivElement>('[data-stage]');
    if (!stage) throw new Error('stage did not mount');

    dispatchTouch(stage, 'pointerdown', { pointerId: 1, x: 300, y: 100 });
    dispatchTouch(stage, 'pointerup', { pointerId: 1, x: 100, y: 100 });
    expect(callbacks.shuffle).toHaveBeenCalledTimes(1);

    // Inside the swipe debounce, which used to swallow taps wholesale.
    dispatchTouch(stage, 'pointerdown', { pointerId: 2, x: 200, y: 200 });
    dispatchTouch(stage, 'pointerup', { pointerId: 2, x: 200, y: 200 });
    dispatchTouch(stage, 'pointerdown', { pointerId: 3, x: 200, y: 200 });
    dispatchTouch(stage, 'pointerup', { pointerId: 3, x: 200, y: 200 });

    expect(callbacks.toggleFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe('useStageGesture wheel', () => {
  let toy: ReturnType<typeof createToyContainer>;
  let root: ReturnType<typeof createRoot>;
  let restorePerformance: (() => void) | null = null;

  beforeEach(() => {
    toy = createToyContainer('stage-gesture-wheel-test');
    const realNow = performance.now.bind(performance);
    restorePerformance = replaceProperty(
      performance,
      'now',
      () => realNow() + 1_000_000,
    );
  });

  afterEach(() => {
    restorePerformance?.();
    restorePerformance = null;
    root?.unmount();
    toy.dispose();
    document.body.innerHTML = '';
  });

  function mountStage() {
    const { callbacks, Harness } = createGestureHarness();
    root = createRoot(toy.container);
    flushSync(() => {
      root.render(createElement(Harness));
    });
    const stage = toy.container.querySelector<HTMLDivElement>('[data-stage]');
    if (!stage) throw new Error('stage did not mount');
    return { callbacks, stage };
  }

  function wheel(stage: HTMLElement, deltaY: number) {
    const event = new Event('wheel', { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      deltaY: { configurable: true, value: deltaY },
      deltaMode: { configurable: true, value: 0 },
    });
    stage.dispatchEvent(event);
    return event;
  }

  test('a small scroll belongs to the runtime, not the preset list', () => {
    const { callbacks, stage } = mountStage();

    const event = wheel(stage, 40);

    expect(callbacks.shuffle).not.toHaveBeenCalled();
    // Left alive so it reaches the canvas as a wheel_delta preset signal.
    expect(event.defaultPrevented).toBe(false);
  });

  test('a deliberate scroll changes the preset and is consumed', () => {
    const { callbacks, stage } = mountStage();

    wheel(stage, 40);
    wheel(stage, 40);
    const crossing = wheel(stage, 60);

    expect(callbacks.shuffle).toHaveBeenCalledTimes(1);
    // Consumed, so the same flick cannot also nudge the visuals.
    expect(crossing.defaultPrevented).toBe(true);
  });

  test('scrolling the other way goes back', () => {
    const { callbacks, stage } = mountStage();

    wheel(stage, -130);

    expect(callbacks.previous).toHaveBeenCalledTimes(1);
    expect(callbacks.shuffle).not.toHaveBeenCalled();
  });
});
