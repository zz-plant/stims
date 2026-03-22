import { describe, expect, test } from 'bun:test';
import {
  createDefaultCustomWaveSlot,
  createDefaultShapeSlot,
  DEFAULT_MILKDROP_STATE,
  MAX_CUSTOM_SHAPES,
  MAX_CUSTOM_WAVES,
} from '../assets/js/milkdrop/compiler/default-state.ts';

describe('milkdrop compiler default state', () => {
  test('seeds the first custom shape slot with the canonical starter palette', () => {
    expect(createDefaultShapeSlot(1)).toMatchObject({
      shape_1_enabled: 1,
      shape_1_sides: 6,
      shape_1_rad: 0.17,
      shape_1_a: 0.24,
      shape_1_additive: 1,
      shape_1_thickoutline: 1,
    });
  });

  test('seeds fallback shape slots and custom waves across the exported runtime state', () => {
    expect(createDefaultShapeSlot(4)).toMatchObject({
      shape_4_enabled: 0,
      shape_4_sides: 8,
      shape_4_rad: 0.09,
      shape_4_border_b: 1,
    });
    expect(createDefaultCustomWaveSlot(3)).toMatchObject({
      custom_wave_3_enabled: 0,
      custom_wave_3_samples: 64,
      custom_wave_3_smoothing: 0.5,
      custom_wave_3_a: 0.4,
    });

    expect(DEFAULT_MILKDROP_STATE.shape_1_enabled).toBe(1);
    expect(DEFAULT_MILKDROP_STATE[`shape_${MAX_CUSTOM_SHAPES}_enabled`]).toBe(
      0,
    );
    expect(DEFAULT_MILKDROP_STATE.custom_wave_1_samples).toBe(64);
    expect(
      DEFAULT_MILKDROP_STATE[`custom_wave_${MAX_CUSTOM_WAVES}_enabled`],
    ).toBe(0);
  });
});
