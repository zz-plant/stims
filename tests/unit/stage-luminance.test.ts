import { afterEach, expect, test } from 'bun:test';
import {
  resetStageLuminance,
  setStageLuminanceChannel,
  stageLuminanceScale,
} from '../../src/js/core/services/stage-luminance.ts';

function stage(): HTMLElement {
  return document.createElement('div');
}

const created: HTMLElement[] = [];
function trackedStage(): HTMLElement {
  const element = stage();
  created.push(element);
  return element;
}

afterEach(() => {
  for (const element of created.splice(0)) resetStageLuminance(element);
});

test('an unengaged stage carries no filter at all', () => {
  const element = trackedStage();
  setStageLuminanceChannel(element, 'governor', 1);
  // Not `brightness(1)`: an identity filter still forces a compositing layer
  // the renderer does not otherwise need.
  expect(element.style.filter).toBe('');
});

test('the visitor ceiling survives a governor that writes every frame', () => {
  const element = trackedStage();
  setStageLuminanceChannel(element, 'ceiling', 0.5);
  expect(element.style.filter).toBe('brightness(0.500)');

  // This is the regression the module exists for: the governor ticks on rAF
  // and, writing style.filter directly, used to erase the ceiling within a
  // frame of it being set.
  for (let i = 0; i < 5; i += 1) {
    setStageLuminanceChannel(element, 'governor', 1);
  }
  expect(element.style.filter).toBe('brightness(0.500)');
});

test('the two channels multiply, so the darker intent wins', () => {
  const element = trackedStage();
  setStageLuminanceChannel(element, 'ceiling', 0.5);
  setStageLuminanceChannel(element, 'governor', 0.4);
  expect(stageLuminanceScale(element)).toBeCloseTo(0.2, 5);
  expect(element.style.filter).toBe('brightness(0.200)');
});

test('releasing the governor restores the ceiling, not full brightness', () => {
  const element = trackedStage();
  setStageLuminanceChannel(element, 'ceiling', 0.6);
  setStageLuminanceChannel(element, 'governor', 0.3);
  setStageLuminanceChannel(element, 'governor', 1);
  expect(element.style.filter).toBe('brightness(0.600)');
});

test('a nonsense scale falls back to unity rather than blacking the stage', () => {
  const element = trackedStage();
  setStageLuminanceChannel(element, 'ceiling', Number.NaN);
  expect(stageLuminanceScale(element)).toBe(1);
});

test('channels are per-stage, so a second canvas does not inherit a clamp', () => {
  const first = trackedStage();
  const second = trackedStage();
  setStageLuminanceChannel(first, 'governor', 0.2);
  expect(second.style.filter).toBe('');
  expect(stageLuminanceScale(second)).toBe(1);
});
