import { describe, expect, test } from 'bun:test';
import {
  buildInspectResult,
  drivingControls,
  pixelToCoords,
} from '../../src/js/milkdrop/overlay/canvas-inspector.ts';

describe('canvas inspector', () => {
  test('pixelToCoords normalizes and computes rad/ang', () => {
    const c = pixelToCoords(0, 0, 100, 100);
    expect(c.u).toBe(0);
    expect(c.v).toBe(0);
    expect(c.x).toBe(-1);
    expect(c.y).toBe(1);
    expect(c.rad).toBeCloseTo(Math.sqrt(2), 5);
  });

  test('pixelToCoords center', () => {
    const c = pixelToCoords(50, 50, 100, 100);
    expect(c.u).toBe(0.5);
    expect(c.v).toBe(0.5);
    expect(c.x).toBe(0);
    expect(c.y).toBe(0);
    expect(c.rad).toBe(0);
  });

  test('drivingControls from perPixelOutputs', () => {
    const df = {
      drawnAudio: {
        perPixel: ['rot', 'zoom'],
        perPixelOutputs: new Map([
          ['rot', ['mid']],
          ['zoom', ['bass']],
        ]),
        waves: [],
        shapes: [],
      },
    } as any;
    const c = drivingControls(df);
    expect(c).toHaveLength(2);
    expect(c.find((x) => x.name === 'rot')?.audio).toEqual(['mid']);
  });

  test('drivingControls falls back to perPixel', () => {
    const df = {
      drawnAudio: {
        perPixel: ['warp'],
        perPixelOutputs: new Map(),
        waves: [],
        shapes: [],
      },
    } as any;
    const c = drivingControls(df);
    expect(c).toHaveLength(1);
    expect(c[0].name).toBe('warp');
    expect(c[0].audio).toEqual([]);
  });

  test('buildInspectResult combines', () => {
    const df = null;
    const r = buildInspectResult(10, 20, 100, 100, df);
    expect(r.coords.u).toBeCloseTo(0.1, 5);
    expect(r.controls).toEqual([]);
  });

  test('null dataflow yields empty controls', () => {
    expect(drivingControls(null)).toEqual([]);
  });
});
