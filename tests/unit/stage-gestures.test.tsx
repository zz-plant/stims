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
