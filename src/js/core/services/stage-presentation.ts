/**
 * What the stage shows on top of its canvas, carried into every copy of it.
 *
 * Three things the viewer sees are not canvas pixels. The flash governor, the
 * visitor's brightness ceiling and the D blackout are one CSS brightness
 * filter on the stage element (stage-luminance.ts), and the Y white flash is
 * an overlay beside the canvas (stage-utilities.ts). Every copy of the stage
 * made with `canvas.captureStream()` carries canvas pixels only, so without
 * this module Reduce flashing protected the tab and not the picture-in-picture
 * window, the projector or a recording, and a blackout did not black out a
 * recording.
 *
 * ## Two ways to carry it
 *
 * - **CSS, for a `<video>` in a document this page writes** (the projector,
 *   document picture-in-picture): `mirrorStagePresentation` copies the stage's
 *   filter onto the video and shows a white element during the flash. The
 *   browser composites both, so it costs nothing per frame.
 * - **Pixels, for a stream the browser presents itself** (video
 *   picture-in-picture, where the browser draws the window and CSS on the
 *   video does nothing) **or encodes** (recording): `createPresentedStageCanvas`
 *   paints the stage's frames into a canvas with the dimming and the flash
 *   baked in, and that canvas is what gets captured.
 *
 * ## What each copy carries
 *
 * A live view (both picture-in-picture paths, the projector) shows exactly
 * what the stage shows. A recording leaves out the brightness ceiling: that
 * is a comfort setting for the person at this screen, and baked into a file it
 * makes the video dim on everyone else's. The governor's dimming and the
 * operator's cuts stay in, because a strobe shared onward reaches viewers who
 * never set the preference, and a recorded set should go black and white
 * where the room did. Decided 2026-10-13.
 */

import { isFreezeFrameActive } from '../accessibility-preferences.ts';
import { subscribeToFrameDrawn } from '../frame-drawn.ts';
import {
  type StageLuminanceChannel,
  stageLuminanceScale,
} from './stage-luminance.ts';
import {
  stageUtilityMode,
  subscribeToStageUtilityMode,
} from './stage-utilities.ts';

/** What the stage shows over its canvas at one moment. */
export type StagePresentation = {
  /** The brightness multiplier, 0 (black) to 1 (untouched). */
  luminance: number;
  /** Whether the Y white flash is covering the stage. */
  flash: boolean;
};

const RECORDED_CHANNELS: readonly StageLuminanceChannel[] = [
  'governor',
  'presentation',
];

/** Everything the stage shows: for picture-in-picture and the projector. */
export function readLiveStagePresentation(
  stage: HTMLElement | null,
): StagePresentation {
  return {
    luminance: stage ? stageLuminanceScale(stage) : 1,
    flash: stageUtilityMode() === 'flash',
  };
}

/** What a recording carries: all of it but the brightness ceiling. */
export function readRecordedStagePresentation(
  stage: HTMLElement | null,
): StagePresentation {
  return {
    luminance: stage ? stageLuminanceScale(stage, RECORDED_CHANNELS) : 1,
    flash: stageUtilityMode() === 'flash',
  };
}

/**
 * Keeps `filtered` dimmed exactly as the stage is and shows `flash` while
 * the white flash is on. Returns the function that stops following.
 *
 * `flash` is shown and hidden through its `hidden` attribute, so its own
 * styles must not set `display`.
 */
export function mirrorStagePresentation(
  stage: HTMLElement,
  { filtered, flash }: { filtered: HTMLElement; flash: HTMLElement },
): () => void {
  const copyFilter = () => {
    filtered.style.filter = stage.style.filter;
  };
  copyFilter();
  let observer: MutationObserver | null = null;
  if (typeof MutationObserver === 'function') {
    // The stage element only, not its subtree: the filter lives on it, and
    // the dock below it restyles on every hover.
    observer = new MutationObserver(copyFilter);
    observer.observe(stage, { attributes: true, attributeFilter: ['style'] });
  }
  const showFlash = () => {
    flash.hidden = stageUtilityMode() !== 'flash';
  };
  showFlash();
  const stopFlash = subscribeToStageUtilityMode(showFlash);
  return () => {
    observer?.disconnect();
    stopFlash();
  };
}

export type PresentedStageCanvas = {
  /** Repainted after every drawn stage frame; capture this one. */
  readonly canvas: HTMLCanvasElement;
  dispose: () => void;
};

/**
 * A canvas that shows the stage as presented: its frames, dimmed and cut the
 * way the stage is.
 *
 * ## When it paints
 *
 * Inside the render loops' frame-drawn notification, the one moment the
 * stage canvas can be read (see frame-drawn.ts). A separate animation-frame
 * loop read a WebGPU canvas back transparent and a WebGL one partly cleared.
 *
 * ## Why it holds a copy of the last frame
 *
 * While the stage is paused (Freeze visuals, Space) the loops still notify,
 * but nothing is drawn, and a WebGL canvas without `preserveDrawingBuffer`
 * cannot be read: measured 2026-10-13, every read while paused came back
 * empty on WebGL, while WebGPU kept its last frame. The stage itself keeps
 * showing that frame, and a performer may well black it out or flash it
 * while it is held. So the latest drawn frame is copied into `held` and the
 * output is painted from that copy, which is still there when the stage
 * cannot be read. The copy is a second GPU blit per frame; at native 4K the
 * pair cost no measurable frame time on an M-series Mac.
 *
 * ## How it dims
 *
 * A black fill at alpha `1 - luminance` over the frame. That matches CSS
 * `brightness()` to within 1/255 per channel (measured against `ctx.filter`
 * on the live stage), so the copy needs no canvas filter support.
 *
 * `size` fixes the output size, filled by a centred crop (a portrait export
 * from a landscape stage); without it the output follows the stage canvas.
 * Returns null where a 2D context is unavailable.
 */
export function createPresentedStageCanvas({
  getCanvas,
  presentation,
  size,
  createCanvas = () => document.createElement('canvas'),
}: {
  getCanvas: () => HTMLCanvasElement | null;
  presentation: () => StagePresentation;
  size?: { width: number; height: number };
  createCanvas?: () => HTMLCanvasElement;
}): PresentedStageCanvas | null {
  const canvas = createCanvas();
  const held = createCanvas();
  const output = canvas.getContext('2d', { alpha: false });
  const heldContext = held.getContext('2d', { alpha: false });
  if (!output || !heldContext) return null;

  // Assigning a canvas dimension clears it, even to the value it already
  // has, and a cleared `held` while paused is exactly the loss it exists to
  // prevent.
  const fit = (target: HTMLCanvasElement, width: number, height: number) => {
    if (target.width !== width) target.width = width;
    if (target.height !== height) target.height = height;
  };
  const fitTo = (source: HTMLCanvasElement) => {
    const width = size?.width ?? Math.max(1, source.width);
    const height = size?.height ?? Math.max(1, source.height);
    fit(held, width, height);
    fit(canvas, width, height);
    return { width, height };
  };
  // Sized now rather than at the first frame, so a capture taken before it
  // starts at its real size instead of the default 300 x 150.
  const first = getCanvas();
  if (first) fitTo(first);

  const paint = () => {
    const source = getCanvas();
    if (!source) return;
    const sourceWidth = Math.max(1, source.width);
    const sourceHeight = Math.max(1, source.height);
    const { width, height } = fitTo(source);

    if (!isFreezeFrameActive()) {
      const scale = Math.max(width / sourceWidth, height / sourceHeight);
      const cropWidth = width / scale;
      const cropHeight = height / scale;
      heldContext.drawImage(
        source,
        (sourceWidth - cropWidth) / 2,
        (sourceHeight - cropHeight) / 2,
        cropWidth,
        cropHeight,
        0,
        0,
        width,
        height,
      );
    }

    const { luminance, flash } = presentation();
    output.globalAlpha = 1;
    if (flash) {
      // No dimming applies: the stage's flash sits above its filter.
      output.fillStyle = '#ffffff';
      output.fillRect(0, 0, width, height);
      return;
    }
    output.drawImage(held, 0, 0);
    // The stage drops its filter at the same threshold, so the copy and the
    // stage agree on when the picture is untouched.
    if (luminance < 0.999) {
      output.globalAlpha = 1 - Math.max(0, luminance);
      output.fillStyle = '#000000';
      output.fillRect(0, 0, width, height);
      output.globalAlpha = 1;
    }
  };

  const unsubscribe = subscribeToFrameDrawn(paint);
  return {
    canvas,
    dispose: () => {
      unsubscribe();
      // Release the backing stores now rather than whenever the canvases
      // are collected; at 4K the pair holds about 66 MB.
      canvas.width = 0;
      canvas.height = 0;
      held.width = 0;
      held.height = 0;
    },
  };
}
