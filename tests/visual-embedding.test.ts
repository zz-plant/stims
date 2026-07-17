import { afterEach, expect, test } from 'bun:test';
import { extractFrameStats } from '../assets/js/core/services/visual-embedding.ts';

const originalCreateElement = document.createElement.bind(document);

afterEach(() => {
  document.createElement =
    originalCreateElement as typeof document.createElement;
});

test('reuses a bounded scratch canvas for frame readback', () => {
  const createdCanvases: Array<{ width: number; height: number }> = [];
  const scratch = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: () => {},
      getImageData: (
        _x: number,
        _y: number,
        width: number,
        height: number,
      ) => ({
        data: new Uint8ClampedArray(width * height * 4),
      }),
    }),
  };
  document.createElement = ((tagName: string) => {
    expect(tagName).toBe('canvas');
    createdCanvases.push(scratch);
    return scratch;
  }) as typeof document.createElement;
  const source = { width: 1024, height: 512 } as HTMLCanvasElement;

  extractFrameStats(source);
  extractFrameStats(source);

  expect(createdCanvases).toHaveLength(1);
  expect(scratch.width).toBe(64);
  expect(scratch.height).toBe(32);
});

test('returns empty stats when canvas readback is blocked', () => {
  const scratch = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: () => {},
      getImageData: () => {
        throw new DOMException('Canvas is tainted', 'SecurityError');
      },
    }),
  };
  document.createElement = (() =>
    scratch) as unknown as typeof document.createElement;

  expect(
    extractFrameStats({ width: 64, height: 64 } as HTMLCanvasElement),
  ).toEqual({
    histogram: new Array(24).fill(0),
    edgeDensity: 0,
    motionEstimate: 0,
  });
});

test('frame sampling does not claim a rendering context on the source canvas', () => {
  const source = document.createElement('canvas');
  source.width = 64;
  source.height = 64;
  let sourceContextRequests = 0;
  source.getContext = (() => {
    sourceContextRequests += 1;
    return null;
  }) as typeof source.getContext;

  extractFrameStats(source);

  expect(sourceContextRequests).toBe(0);
});
