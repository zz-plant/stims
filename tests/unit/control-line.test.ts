import { describe, expect, test } from 'bun:test';
import {
  baseReachesControl,
  findControlLine,
} from '../../src/js/milkdrop/control-line.ts';

const SOURCE = [
  '[preset00]',
  'zoom=1.004',
  'zoomexp=1.2',
  'rot=0.0',
  'per_frame_1=zoom = zoom + 0.01*bass;',
  'per_frame_2=q1 = (rot == 0);',
  'per_pixel_1=rot = rot + 0.05*rad*mid_att;',
  'per_pixel_2=zoom = zoom + 0.02*sin(ang*3);',
].join('\n');

describe('findControlLine', () => {
  test('prefers the per-pixel assignment', () => {
    expect(findControlLine(SOURCE, 'zoom')).toBe(8);
    expect(findControlLine(SOURCE, 'rot')).toBe(7);
  });

  test('falls back to per-frame code, then the field line', () => {
    const noPixel = SOURCE.split('\n').slice(0, 6).join('\n');
    expect(findControlLine(noPixel, 'zoom')).toBe(5);
    // `rot == 0` reads rot; only the field line sets it.
    expect(findControlLine(noPixel, 'rot')).toBe(4);
  });

  test('does not match a longer name or a comparison', () => {
    expect(
      findControlLine('per_frame_1=myzoom = 2;\nzoomexp=1', 'zoom'),
    ).toBeNull();
    expect(findControlLine('per_frame_1=q1 = zoom == 1;', 'zoom')).toBeNull();
  });

  test('handles CRLF sources and returns null when unset', () => {
    expect(findControlLine('a=1\r\nper_pixel_1=warp = 0.5;', 'warp')).toBe(2);
    expect(findControlLine(SOURCE, 'dx')).toBeNull();
  });
});

describe('baseReachesControl', () => {
  test('a per-pixel statement that builds on the base lets a slider reach it', () => {
    expect(baseReachesControl('per_pixel_1=rot = rot + 0.1*rad;', 'rot')).toBe(
      true,
    );
    // Never set by code at all: the base is what draws.
    expect(baseReachesControl('zoom=1.01', 'zoom')).toBe(true);
  });

  test('per-frame code or a from-scratch per-pixel statement overwrites it', () => {
    expect(
      baseReachesControl(
        'per_frame_1=rot = 0.1;\nper_pixel_1=rot = rot + 0.1;',
        'rot',
      ),
    ).toBe(false);
    expect(baseReachesControl('per_pixel_1=rot = 2*rad;', 'rot')).toBe(false);
    // One from-scratch statement among several is enough.
    expect(
      baseReachesControl(
        'per_pixel_1=zoom = zoom*1.01;\nper_pixel_2=zoom = 1 + q1;',
        'zoom',
      ),
    ).toBe(false);
  });

  test('reading a longer name is not reading the control', () => {
    expect(baseReachesControl('per_pixel_1=zoom = zoomexp*2;', 'zoom')).toBe(
      false,
    );
  });
});
