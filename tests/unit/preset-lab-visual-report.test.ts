import { describe, expect, test } from 'bun:test';
import {
  computeVisualReport,
  type RawImage,
  repairPreset,
} from '../../scripts/preset-lab-metrics.ts';

function img(w: number, h: number, fill: number): RawImage {
  const data = new Uint8Array(w * h * 3).fill(fill);
  return { data, width: w, height: h, channels: 3 };
}

describe('visual report', () => {
  test('empty frames -> near-black frozen', () => {
    const r = computeVisualReport([]);
    expect(r.frameCount).toBe(0);
    expect(r.nearBlack).toBe(true);
    expect(r.frozen).toBe(true);
  });

  test('bright varying frames -> not near-black, not frozen', () => {
    const a = img(2, 2, 100);
    const b = img(2, 2, 120);
    const r = computeVisualReport([a, b]);
    expect(r.nearBlack).toBe(false);
    expect(r.motionEstimate).toBeGreaterThan(0);
    expect(r.frozen).toBe(false);
  });

  test('identical frames -> frozen', () => {
    const a = img(2, 2, 100);
    const r = computeVisualReport([a, a]);
    expect(r.frozen).toBe(true);
    expect(r.motionEstimate).toBe(0);
  });
});

describe('repairPreset', () => {
  test('no failures -> no changes', () => {
    const src = 'per_frame_1=zoom = 1.0;\n';
    const r = repairPreset(src, [], null);
    expect(r.applied).toEqual([]);
    expect(r.source).toBe(src);
  });

  test('decay=0 gets raised', () => {
    const src = 'per_frame_1=decay = 0.0;\n';
    const r = repairPreset(src, [], {
      frameCount: 2,
      luminanceMean: 1,
      luminanceStdDev: 0,
      motionEstimate: 0,
      nearBlack: true,
      blownOut: false,
      frozen: true,
    });
    expect(r.source).toContain('decay = 0.94;');
    expect(r.applied).toContain('raise decay from 0');
  });

  test('zoom=0 gets restored', () => {
    const src = 'per_frame_1=zoom = 0.0;\n';
    const r = repairPreset(src, [], {
      frameCount: 2,
      luminanceMean: 1,
      luminanceStdDev: 0,
      motionEstimate: 0,
      nearBlack: true,
      blownOut: false,
      frozen: true,
    });
    expect(r.source).toContain('zoom = 1.0;');
  });
});
