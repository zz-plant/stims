import { describe, expect, test } from 'bun:test';
import {
  createDefaultCustomWaveSlot,
  createDefaultShapeSlot,
  DEFAULT_MILKDROP_STATE,
  MAX_CUSTOM_SHAPES,
  MAX_CUSTOM_WAVES,
} from '../../src/js/milkdrop/compiler/default-state.ts';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';

describe('milkdrop compiler default state', () => {
  test('seeds the first custom shape slot with projectM-neutral defaults', () => {
    expect(createDefaultShapeSlot(1)).toMatchObject({
      shape_1_enabled: 0,
      shape_1_sides: 4,
      shape_1_rad: 0.1,
      shape_1_a: 1,
      shape_1_additive: 0,
      shape_1_thickoutline: 0,
    });
  });

  test('seeds fallback shape slots and custom waves across the exported runtime state', () => {
    expect(createDefaultShapeSlot(4)).toMatchObject({
      shape_4_enabled: 0,
      shape_4_sides: 4,
      shape_4_rad: 0.1,
      shape_4_border_b: 1,
    });
    expect(createDefaultCustomWaveSlot(3)).toMatchObject({
      custom_wave_3_enabled: 0,
      custom_wave_3_samples: 512,
      custom_wave_3_smoothing: 0.5,
      custom_wave_3_a: 1,
    });

    expect(DEFAULT_MILKDROP_STATE.shape_1_enabled).toBe(0);
    expect(DEFAULT_MILKDROP_STATE[`shape_${MAX_CUSTOM_SHAPES}_enabled`]).toBe(
      0,
    );
    expect(DEFAULT_MILKDROP_STATE.custom_wave_1_samples).toBe(512);
    expect(
      DEFAULT_MILKDROP_STATE[`custom_wave_${MAX_CUSTOM_WAVES}_enabled`],
    ).toBe(0);
    expect(DEFAULT_MILKDROP_STATE.texture_wrap).toBe(1);
    expect(DEFAULT_MILKDROP_STATE.video_echo_alpha).toBe(0);
  });

  test('preserves legacy MilkDrop blur ranges for direct shader uniforms', () => {
    const compiled = compileMilkdropPresetSource(`
[preset00]
b1n=0.1
b1x=0.9
b2n=0.2
b2x=0.7
b3n=0.3
b3x=0.6
    `);

    expect(compiled.ir.numericFields).toMatchObject({
      blur1_min: 0.1,
      blur1_max: 0.9,
      blur2_min: 0.2,
      blur2_max: 0.7,
      blur3_min: 0.3,
      blur3_max: 0.6,
    });
  });
});
