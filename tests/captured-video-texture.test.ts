import { afterEach, expect, test } from 'bun:test';
import {
  __milkdropCapturedVideoTextureTestUtils,
  clearMilkdropCapturedVideoStream,
  setMilkdropCapturedVideoCropTarget,
} from '../assets/js/core/services/captured-video-texture.ts';
import { replaceProperty } from './test-helpers.ts';

let restoreInnerWidth = () => {};
let restoreInnerHeight = () => {};

afterEach(() => {
  restoreInnerWidth();
  restoreInnerHeight();
  restoreInnerWidth = () => {};
  restoreInnerHeight = () => {};
  clearMilkdropCapturedVideoStream();
  document.body.innerHTML = '';
});

test('captured video source crop stays inside video dimensions at viewport edges', () => {
  restoreInnerWidth = replaceProperty(window, 'innerWidth', 1000);
  restoreInnerHeight = replaceProperty(window, 'innerHeight', 500);
  window.dispatchEvent(new Event('resize'));

  const target = document.createElement('div');
  target.getBoundingClientRect = () =>
    ({
      left: 950,
      top: 450,
      right: 1000,
      bottom: 500,
      width: 50,
      height: 50,
      x: 950,
      y: 450,
      toJSON: () => ({}),
    }) as DOMRect;
  setMilkdropCapturedVideoCropTarget(target);

  const source = __milkdropCapturedVideoTextureTestUtils.resolveSourceRect({
    videoWidth: 200,
    videoHeight: 100,
  } as HTMLVideoElement);

  expect(source.sx + source.sw).toBeLessThanOrEqual(200);
  expect(source.sy + source.sh).toBeLessThanOrEqual(100);
});

test('captured video limits use smaller mobile caps and lower fallback upload cadence', () => {
  const mobile =
    __milkdropCapturedVideoTextureTestUtils.resolveCapturedVideoLimits(true);
  const desktop =
    __milkdropCapturedVideoTextureTestUtils.resolveCapturedVideoLimits(false);

  expect(mobile.maxWidth).toBeLessThan(desktop.maxWidth);
  expect(mobile.maxHeight).toBeLessThan(desktop.maxHeight);
  expect(mobile.fallbackFrameIntervalMs).toBeGreaterThan(
    desktop.fallbackFrameIntervalMs,
  );
});
