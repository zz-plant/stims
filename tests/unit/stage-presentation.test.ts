/**
 * Every copy of the stage made from `canvas.captureStream()` carries canvas
 * pixels only, and the stage's dimming and white flash are not canvas
 * pixels. These pin what a copy shows: the presented canvas that video
 * picture-in-picture and recordings capture, and the CSS mirror the
 * projector and the document popout put on their video.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  resetAccessibilityPreferenceState,
  setAccessibilityPreference,
} from '../../src/js/core/accessibility-preferences.ts';
import { notifyFrameDrawn } from '../../src/js/core/frame-drawn.ts';
import {
  resetStageLuminance,
  setStageLuminanceChannel,
} from '../../src/js/core/services/stage-luminance.ts';
import {
  createPresentedStageCanvas,
  mirrorStagePresentation,
  type PresentedStageCanvas,
  readLiveStagePresentation,
  readRecordedStagePresentation,
} from '../../src/js/core/services/stage-presentation.ts';
import {
  handleFlashKeyDown,
  handleFlashKeyUp,
  resetStageUtilitiesForTests,
} from '../../src/js/core/services/stage-utilities.ts';
import {
  type GreyCanvas,
  greyCanvas,
  greyCanvasFactory,
} from '../grey-canvas.ts';

const cleanup: Array<() => void> = [];

beforeEach(() => {
  resetAccessibilityPreferenceState();
});

afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
  resetStageUtilitiesForTests();
  resetAccessibilityPreferenceState();
  localStorage.clear();
});

function makeStage() {
  const stage = document.createElement('div');
  cleanup.push(() => resetStageLuminance(stage));
  return stage;
}

function present(
  source: () => GreyCanvas,
  read: (stage: HTMLElement) => ReturnType<typeof readLiveStagePresentation>,
  stage: HTMLElement,
  size?: { width: number; height: number },
) {
  const factory = greyCanvasFactory();
  const presented = createPresentedStageCanvas({
    getCanvas: source,
    presentation: () => read(stage),
    size,
    createCanvas: factory.create,
  }) as PresentedStageCanvas;
  cleanup.push(() => presented.dispose());
  const shown = () => (presented.canvas as GreyCanvas).level;
  return { presented, shown, factory };
}

const frame = () => notifyFrameDrawn(0);

describe('a presented copy of the stage', () => {
  test('shows the stage dimmed by every luminance channel', () => {
    const stage = makeStage();
    const source = greyCanvas(200);
    const { shown } = present(() => source, readLiveStagePresentation, stage);

    frame();
    expect(shown()).toBe(200);

    setStageLuminanceChannel(stage, 'governor', 0.5);
    frame();
    expect(shown()).toBeCloseTo(100);

    setStageLuminanceChannel(stage, 'ceiling', 0.5);
    frame();
    expect(shown()).toBeCloseTo(50);
  });

  test('a recording keeps the governor and the blackout but not the ceiling', () => {
    const stage = makeStage();
    const source = greyCanvas(200);
    const { shown } = present(
      () => source,
      readRecordedStagePresentation,
      stage,
    );

    // A comfort setting for the person at this screen, not for the file.
    setStageLuminanceChannel(stage, 'ceiling', 0.5);
    frame();
    expect(shown()).toBe(200);

    setStageLuminanceChannel(stage, 'governor', 0.5);
    frame();
    expect(shown()).toBeCloseTo(100);

    setStageLuminanceChannel(stage, 'presentation', 0);
    frame();
    expect(shown()).toBe(0);
  });

  test('the white flash covers the picture, dimmed or not, and leaves with the key', () => {
    const stage = makeStage();
    const source = greyCanvas(200);
    const { shown } = present(() => source, readLiveStagePresentation, stage);
    setStageLuminanceChannel(stage, 'governor', 0.5);

    handleFlashKeyDown(false);
    frame();
    expect(shown()).toBe(255);

    handleFlashKeyUp();
    frame();
    expect(shown()).toBeCloseTo(100);
  });

  // Measured on Chrome, a paused WebGL stage reads back empty; read as
  // black is the other way a driver could get it wrong, and the copy must
  // hold through both.
  for (const [readsAs, paused] of [
    ['empty', null],
    ['black', 0],
  ] as const) {
    test(`holds the paused frame through a read that comes back ${readsAs}, so a cut made while paused can be undone`, () => {
      const stage = makeStage();
      const source = greyCanvas(200);
      const { shown } = present(() => source, readLiveStagePresentation, stage);
      frame();

      // Paused: the loops still notify, but a WebGL stage cannot be read.
      setAccessibilityPreference({ freezeFrame: true });
      source.level = paused;
      setStageLuminanceChannel(stage, 'governor', 0.5);
      frame();
      frame();
      expect(shown()).toBeCloseTo(100);

      setStageLuminanceChannel(stage, 'presentation', 0);
      frame();
      expect(shown()).toBe(0);

      setStageLuminanceChannel(stage, 'presentation', 1);
      setStageLuminanceChannel(stage, 'governor', 1);
      frame();
      expect(shown()).toBe(200);

      // Resumed: the stage's new frames come through again.
      setAccessibilityPreference({ freezeFrame: false });
      source.level = 40;
      frame();
      expect(shown()).toBe(40);
    });
  }

  test('follows the stage when the renderer replaces its canvas', () => {
    const stage = makeStage();
    let source = greyCanvas(200);
    const { shown } = present(() => source, readLiveStagePresentation, stage);
    frame();
    expect(shown()).toBe(200);

    source = greyCanvas(30, { width: 640, height: 360 });
    frame();
    expect(shown()).toBe(30);
  });

  test('without a size it matches the stage canvas, through a resize', () => {
    const stage = makeStage();
    const source = greyCanvas(200, { width: 1280, height: 720 });
    const { presented } = present(
      () => source,
      readLiveStagePresentation,
      stage,
    );
    frame();
    expect([presented.canvas.width, presented.canvas.height]).toEqual([
      1280, 720,
    ]);

    // A native 4K recording resizes the renderer after the copy exists.
    source.width = 3840;
    source.height = 2160;
    source.level = 200;
    frame();
    expect([presented.canvas.width, presented.canvas.height]).toEqual([
      3840, 2160,
    ]);
  });

  test('a fixed size takes the centre of the stage and fills the frame', () => {
    const stage = makeStage();
    const source = greyCanvas(200, { width: 1280, height: 720 });
    const { presented, shown, factory } = present(
      () => source,
      readLiveStagePresentation,
      stage,
      { width: 1080, height: 1920 },
    );
    frame();
    expect([presented.canvas.width, presented.canvas.height]).toEqual([
      1080, 1920,
    ]);
    expect(shown()).toBe(200);
    // A portrait frame from a landscape stage: full height, centred.
    const rects = factory.made.flatMap((canvas) => canvas.sourceRects);
    expect(rects).toEqual([[437.5, 0, 405, 720]]);
  });

  test('stops painting once disposed', () => {
    const stage = makeStage();
    const source = greyCanvas(200);
    const { presented, shown } = present(
      () => source,
      readLiveStagePresentation,
      stage,
    );
    presented.dispose();
    frame();
    expect(shown()).toBe(0);
    expect(presented.canvas.width).toBe(0);
  });
});

/** The test DOM keeps MutationObserver on `window` only. */
function installMutationObserver() {
  const globals = globalThis as unknown as Record<string, unknown>;
  if (globals.MutationObserver !== undefined) return;
  globals.MutationObserver = (
    window as unknown as Record<string, unknown>
  ).MutationObserver;
  cleanup.push(() => {
    Reflect.deleteProperty(globals, 'MutationObserver');
  });
}

describe('mirroring onto a video in a document this page writes', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('the video takes the stage filter and the flash element shows the flash', async () => {
    installMutationObserver();
    const stage = makeStage();
    const video = document.createElement('video');
    const flash = document.createElement('div');
    const stop = mirrorStagePresentation(stage, { filtered: video, flash });
    cleanup.push(stop);
    expect(flash.hidden).toBe(true);

    setStageLuminanceChannel(stage, 'governor', 0.5);
    await tick();
    expect(video.style.filter).toBe('brightness(0.500)');

    setStageLuminanceChannel(stage, 'presentation', 0);
    await tick();
    expect(video.style.filter).toBe('brightness(0.000)');

    handleFlashKeyDown(false);
    expect(flash.hidden).toBe(false);
    handleFlashKeyUp();
    expect(flash.hidden).toBe(true);
  });

  test('stops following once stopped', async () => {
    installMutationObserver();
    const stage = makeStage();
    const video = document.createElement('video');
    const flash = document.createElement('div');
    const stop = mirrorStagePresentation(stage, { filtered: video, flash });
    stop();

    setStageLuminanceChannel(stage, 'governor', 0.5);
    await tick();
    handleFlashKeyDown(false);
    expect(video.style.filter).toBe('');
    expect(flash.hidden).toBe(true);
  });
});
