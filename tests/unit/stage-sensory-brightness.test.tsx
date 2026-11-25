/**
 * `useStageSensoryBrightness`: the sensory dial's share of the stage filter.
 *
 * A palette or voice change of the overload dial eases in over a few
 * seconds, so the hook writes the channel on every frame of the ramp and
 * stops once it ends. The clock and the frame queue are faked; the hook,
 * the dial service and the stage filter run for real.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MIN_STAGE_BRIGHTNESS } from '../../src/js/core/accessibility-preferences.ts';
import {
  resetSensoryTranslationServiceStateForTests,
  SENSORY_RAMP_MS,
  setSensoryMoodKnobs,
} from '../../src/js/core/services/sensory-translation.ts';
import { stageLuminanceScale } from '../../src/js/core/services/stage-luminance.ts';
import { useStageSensoryBrightness } from '../../src/js/frontend/hooks/use-flash-safety.ts';

let now = 0;
let frames: FrameRequestCallback[] = [];
let root: Root;
let host: HTMLDivElement;
let stage: HTMLDivElement;
const originalRaf = globalThis.requestAnimationFrame;
const originalCaf = globalThis.cancelAnimationFrame;

function Probe() {
  useStageSensoryBrightness({ current: stage });
  return null;
}

/** Advance the clock by `ms` and run the frames queued before it. */
function step(ms: number) {
  now += ms;
  const due = frames;
  frames = [];
  for (const frame of due) frame(now);
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  now = 0;
  frames = [];
  globalThis.requestAnimationFrame = (cb) => frames.push(cb);
  globalThis.cancelAnimationFrame = (id) => {
    frames.splice(id - 1, 1);
  };
  resetSensoryTranslationServiceStateForTests(
    { overloadCeiling: 1 },
    () => now,
  );
  stage = document.createElement('div');
  host = document.createElement('div');
  document.body.append(host, stage);
  root = createRoot(host);
  act(() => root.render(createElement(Probe)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  stage.remove();
  globalThis.requestAnimationFrame = originalRaf;
  globalThis.cancelAnimationFrame = originalCaf;
  resetSensoryTranslationServiceStateForTests();
  localStorage.clear();
});

describe('useStageSensoryBrightness', () => {
  test('a ramped calm dims the stage over the ramp, then stops writing', () => {
    expect(stageLuminanceScale(stage)).toBe(1);
    setSensoryMoodKnobs({ overloadCeiling: 0 }, { rampMs: SENSORY_RAMP_MS });

    // Nothing jumps on the change itself.
    expect(stageLuminanceScale(stage)).toBe(1);

    const seen: number[] = [];
    for (let elapsed = 0; elapsed < SENSORY_RAMP_MS; elapsed += 500) {
      step(500);
      seen.push(stageLuminanceScale(stage));
    }
    // Each frame is darker than the last, and none skips most of the way.
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeLessThan(seen[i - 1] as number);
    }
    expect(1 - (seen[0] as number)).toBeLessThan(
      0.5 * (1 - MIN_STAGE_BRIGHTNESS),
    );
    expect(seen.at(-1)).toBeCloseTo(MIN_STAGE_BRIGHTNESS, 9);
    expect(frames).toHaveLength(0);
  });

  test('an unramped change (a dragged slider) applies at once with no frame loop', () => {
    setSensoryMoodKnobs({ overloadCeiling: 0 });
    expect(stageLuminanceScale(stage)).toBeCloseTo(MIN_STAGE_BRIGHTNESS, 9);
    expect(frames).toHaveLength(0);
  });

  test('unmounting mid-ramp cancels the loop and releases the channel', () => {
    setSensoryMoodKnobs({ overloadCeiling: 0 }, { rampMs: SENSORY_RAMP_MS });
    step(500);
    expect(frames).toHaveLength(1);
    act(() => root.unmount());
    expect(frames).toHaveLength(0);
    expect(stageLuminanceScale(stage)).toBe(1);
    root = createRoot(host);
  });
});
