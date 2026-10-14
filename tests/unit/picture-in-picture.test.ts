/**
 * Video picture-in-picture: the browser draws the floating window itself, so
 * CSS on the video, which is how the projector and the document popout carry
 * the stage's dimming, does nothing here. These pin that the window plays a
 * presented copy of the stage with the dimming and the white flash painted
 * in, that the copy follows a replaced canvas, and that closing the window
 * stops the copy's per-frame work.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { notifyFrameDrawn } from '../../src/js/core/frame-drawn.ts';
import { createPictureInPictureController } from '../../src/js/core/services/picture-in-picture-service.ts';
import {
  resetStageLuminance,
  setStageLuminanceChannel,
} from '../../src/js/core/services/stage-luminance.ts';
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

const restore: Array<() => void> = [];

function define(target: object, name: string, descriptor: PropertyDescriptor) {
  const prior = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, ...descriptor });
  restore.push(() => {
    if (prior) Object.defineProperty(target, name, prior);
    else Reflect.deleteProperty(target, name);
  });
}

/**
 * The test DOM has no Picture-in-Picture API, keeps the media and canvas
 * constructors on `window` only, and rejects a srcObject that is not a real
 * MediaStream. This installs a minimal PiP that opens and closes the way the
 * browser does, firing the same events on the video.
 */
function installPictureInPicture() {
  const globals = globalThis as unknown as Record<string, unknown>;
  const source = window as unknown as Record<string, unknown>;
  for (const name of [
    'HTMLVideoElement',
    'HTMLMediaElement',
    'HTMLCanvasElement',
  ]) {
    if (globals[name] === undefined)
      define(globals, name, { value: source[name] });
  }
  const videoProto = (globals.HTMLVideoElement as { prototype: object })
    .prototype;
  const mediaProto = Object.getPrototypeOf(videoProto) as object;
  const canvasProto = (globals.HTMLCanvasElement as { prototype: object })
    .prototype;

  let pipElement: HTMLVideoElement | null = null;
  define(document, 'pictureInPictureEnabled', { get: () => true });
  define(document, 'pictureInPictureElement', { get: () => pipElement });
  define(document, 'exitPictureInPicture', {
    value: async () => {
      const left = pipElement;
      pipElement = null;
      left?.dispatchEvent(new Event('leavepictureinpicture'));
    },
  });
  define(videoProto, 'requestPictureInPicture', {
    value(this: HTMLVideoElement) {
      pipElement = this;
      this.dispatchEvent(new Event('enterpictureinpicture'));
      return Promise.resolve({});
    },
  });
  if (!('captureStream' in canvasProto)) {
    define(canvasProto, 'captureStream', { value: () => ({}) });
  }
  const sources = new WeakMap<object, unknown>();
  define(mediaProto, 'srcObject', {
    get(this: object) {
      return sources.get(this) ?? null;
    },
    set(this: object, value: unknown) {
      sources.set(this, value);
    },
  });
}

/** The canvas the floating window is playing, if any. */
function playing(): GreyCanvas | null {
  const video = document.querySelector('video.pip-video-helper');
  const stream = (video as { srcObject?: unknown } | null)?.srcObject as {
    getVideoTracks(): Array<{ canvas: GreyCanvas }>;
  } | null;
  return stream?.getVideoTracks()[0]?.canvas ?? null;
}

let stage: HTMLDivElement;
let disposeController = () => {};

beforeEach(() => {
  installPictureInPicture();
  stage = document.createElement('div');
});

afterEach(() => {
  disposeController();
  disposeController = () => {};
  resetStageLuminance(stage);
  resetStageUtilitiesForTests();
  while (restore.length) restore.pop()?.();
  for (const video of document.querySelectorAll('video')) video.remove();
});

function openOn(getCanvas: () => HTMLCanvasElement | null) {
  const factory = greyCanvasFactory();
  const controller = createPictureInPictureController({
    getCanvas,
    getStage: () => stage,
    createCanvas: factory.create,
  });
  disposeController = controller.dispose;
  return controller;
}

const frame = () => notifyFrameDrawn(0);

describe('video picture-in-picture', () => {
  test('the floating window shows the stage dimmed and flashed as the stage is', async () => {
    const canvas = greyCanvas(200);
    const controller = openOn(() => canvas);
    expect(await controller.enter()).toEqual({ ok: true });
    expect(controller.isActive()).toBe(true);
    frame();
    // A copy, not the stage canvas: that is what carries the dimming.
    expect(playing()).not.toBe(canvas);
    expect(playing()?.level).toBe(200);

    setStageLuminanceChannel(stage, 'governor', 0.5);
    frame();
    expect(playing()?.level).toBeCloseTo(100);

    // A live view shows the visitor's ceiling too, unlike a recording.
    setStageLuminanceChannel(stage, 'ceiling', 0.5);
    frame();
    expect(playing()?.level).toBeCloseTo(50);

    setStageLuminanceChannel(stage, 'presentation', 0);
    frame();
    expect(playing()?.level).toBe(0);

    setStageLuminanceChannel(stage, 'presentation', 1);
    handleFlashKeyDown(false);
    frame();
    expect(playing()?.level).toBe(255);
    handleFlashKeyUp();
  });

  test('keeps playing when the renderer replaces the stage canvas', async () => {
    let canvas = greyCanvas(200);
    const controller = openOn(() => canvas);
    await controller.enter();
    frame();
    const floating = playing();

    canvas = greyCanvas(30);
    frame();
    expect(playing()).toBe(floating);
    expect(floating?.level).toBe(30);
  });

  test('closing the window stops the copy and its capture', async () => {
    const canvas = greyCanvas(200);
    const controller = openOn(() => canvas);
    await controller.enter();
    frame();
    const copy = playing() as GreyCanvas;

    await controller.exit();
    expect(controller.isActive()).toBe(false);
    expect(copy.captureStopped).toBe(true);
    canvas.level = 90;
    frame();
    expect(copy.level).not.toBe(90);
  });

  test('refuses rather than floating an undimmed stage when it cannot paint a copy', async () => {
    const controller = createPictureInPictureController({
      getCanvas: () => greyCanvas(200),
      getStage: () => stage,
      createCanvas: () =>
        ({ getContext: () => null }) as unknown as HTMLCanvasElement,
    });
    disposeController = controller.dispose;
    expect(await controller.enter()).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(controller.isActive()).toBe(false);
  });
});
