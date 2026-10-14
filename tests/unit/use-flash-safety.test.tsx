/**
 * `useFlashSafety`: priming the governor from the catalog's measurement.
 *
 * The renderer creates the stage canvas after the workspace mounts, and
 * replaces it when the backend changes, while the preset (and so its
 * profile) is usually known first. The governor has to start primed on the
 * controller that is built for whichever canvas arrives, not only on one
 * that happened to exist when the profile did.
 *
 * Driven through the real controller and sampler: the canvas readback is the
 * only thing faked, a uniform mid-grey frame, so the dimming seen on the
 * stage is the primed hold and nothing else.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { primingHoldForMeasurement } from 'flash-guard';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  resetAccessibilityPreferenceState,
  setAccessibilityPreference,
} from '../../src/js/core/accessibility-preferences.ts';
import { notifyFrameDrawn } from '../../src/js/core/frame-drawn.ts';
import type { PresetSensoryProfile } from '../../src/js/core/sensory-profile.ts';
import { stageLuminanceScale } from '../../src/js/core/services/stage-luminance.ts';
import { useFlashSafety } from '../../src/js/frontend/hooks/use-flash-safety.ts';

const HIGH: PresetSensoryProfile = {
  flashRiskLevel: 'high',
  maxTransitionsPerSecondEstimate: 5,
  meanLuminance: 0.3,
  maxLuminanceDelta: 0.5,
  measuredAt: '2026-08-20T00:00:00.000Z',
};
const CALM: PresetSensoryProfile = { ...HIGH, flashRiskLevel: 'none' };
const PRIMED_SCALE = 1 - primingHoldForMeasurement(HIGH);

type DomWindow = Window & {
  HTMLCanvasElement: typeof HTMLCanvasElement;
  MutationObserver: typeof MutationObserver;
};

/**
 * The stage watches for its canvas with a MutationObserver and checks it with
 * `instanceof HTMLCanvasElement`; the shared test DOM leaves both on the
 * window only, so they are hoisted for this file and put back after it.
 */
const hoisted = ['HTMLCanvasElement', 'MutationObserver'] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
let savedGetContext: HTMLCanvasElement['getContext'] | null = null;

beforeEach(() => {
  const win = window as unknown as DomWindow;
  for (const name of hoisted) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: win[name],
    });
  }
  // The sampler's main-thread read: draw the stage canvas into a scratch
  // canvas and read it back. Every read is the same mid-grey frame.
  const proto = win.HTMLCanvasElement.prototype;
  savedGetContext = proto.getContext;
  proto.getContext = (() => ({
    imageSmoothingEnabled: true,
    drawImage: () => {},
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4).fill(128),
    }),
  })) as unknown as HTMLCanvasElement['getContext'];
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  setAccessibilityPreference({ reduceFlashing: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  stage?.remove();
  stage = null;
  const win = window as unknown as DomWindow;
  if (savedGetContext)
    win.HTMLCanvasElement.prototype.getContext = savedGetContext;
  for (const name of hoisted) {
    const descriptor = saved.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  saved.clear();
  resetAccessibilityPreferenceState();
});

let root: Root | null = null;
let stage: HTMLDivElement | null = null;
let frameMs = 0;

function Host({
  stageRef,
  profile,
}: {
  stageRef: { current: HTMLDivElement | null };
  profile?: PresetSensoryProfile;
}) {
  useFlashSafety(stageRef, profile);
  return null;
}

/** Mounts the hook over an empty stage, as the workspace does before the engine. */
function mount(profile?: PresetSensoryProfile) {
  stage = document.createElement('div');
  document.body.appendChild(stage);
  const stageRef = { current: stage };
  const host = document.createElement('div');
  root = createRoot(host);
  const render = (next?: PresetSensoryProfile) =>
    act(() => {
      root?.render(createElement(Host, { stageRef, profile: next }));
    });
  render(profile);
  return { stage, render };
}

/** The renderer making (or replacing) its canvas; the observer attaches to it. */
async function addCanvas(into: HTMLDivElement) {
  const canvas = document.createElement('canvas');
  await act(async () => {
    into.replaceChildren(canvas);
  });
  return canvas;
}

/** One drawn frame, which is when the governor samples and applies. */
function drawFrame() {
  frameMs += 1000 / 60;
  notifyFrameDrawn(frameMs);
}

describe('useFlashSafety priming', () => {
  test('a profile known before the canvas exists primes the controller made for it', async () => {
    const { stage } = mount(HIGH);
    await addCanvas(stage);
    drawFrame();
    expect(PRIMED_SCALE).toBeLessThan(1);
    expect(stageLuminanceScale(stage)).toBeCloseTo(PRIMED_SCALE, 3);
  });

  test('a replacement canvas for the same preset starts primed too', async () => {
    const { stage } = mount(HIGH);
    await addCanvas(stage);
    drawFrame();
    // A backend change: the old controller stops and gives the stage back,
    // and the new one must not start from nothing.
    await addCanvas(stage);
    drawFrame();
    expect(stageLuminanceScale(stage)).toBeCloseTo(PRIMED_SCALE, 3);
  });

  test('a profile that arrives after the canvas still primes it', async () => {
    const { stage, render } = mount();
    await addCanvas(stage);
    drawFrame();
    expect(stageLuminanceScale(stage)).toBe(1);
    render(HIGH);
    drawFrame();
    expect(stageLuminanceScale(stage)).toBeCloseTo(PRIMED_SCALE, 3);
  });

  test('moving to a calm preset clears the hold a later canvas would get', async () => {
    const { stage, render } = mount(HIGH);
    render(CALM);
    await addCanvas(stage);
    drawFrame();
    expect(stageLuminanceScale(stage)).toBe(1);
  });
});
