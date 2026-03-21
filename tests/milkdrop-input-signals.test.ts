import { describe, expect, test } from 'bun:test';
import { buildMilkdropInputSignalOverrides } from '../assets/js/milkdrop/runtime.ts';
import type { UnifiedInputState } from '../assets/js/utils/unified-input.ts';

describe('milkdrop input signal overrides', () => {
  test('maps desktop performance state into runtime signals', () => {
    const input: UnifiedInputState = {
      time: 100,
      deltaMs: 16,
      pointers: [],
      pointerCount: 0,
      centroid: { x: 0, y: 0 },
      normalizedCentroid: { x: 0.25, y: -0.4 },
      primary: null,
      isPressed: false,
      justPressed: false,
      justReleased: false,
      dragDelta: { x: 0.12, y: -0.08 },
      source: 'pointer',
      gesture: null,
      mic: { level: 0.4, available: true },
      performance: {
        hoverActive: true,
        hover: { x: 0.3, y: -0.2 },
        wheelDelta: 0.5,
        wheelAccum: 0.75,
        dragIntensity: 0.3,
        dragAngle: Math.PI / 4,
        accentPulse: 0.9,
        sourceFlags: {
          pointer: true,
          keyboard: false,
          gamepad: false,
          mouse: true,
          touch: false,
          pen: false,
        },
        actions: {
          accent: 0.9,
          modeNext: 0.8,
          modePrevious: 0.1,
          presetNext: 0.4,
          presetPrevious: 0.2,
          quickLook1: 0.6,
          quickLook2: 0.3,
          quickLook3: 0.2,
          remix: 0.7,
        },
      },
    };

    const overrides = buildMilkdropInputSignalOverrides(input);

    expect(overrides.hoverActive).toBe(1);
    expect(overrides.hoverX).toBeCloseTo(0.3, 6);
    expect(overrides.wheelDelta).toBeCloseTo(0.5, 6);
    expect(overrides.wheelAccum).toBeCloseTo(0.75, 6);
    expect(overrides.dragIntensity).toBeCloseTo(0.3, 6);
    expect(overrides.accentPulse).toBeCloseTo(0.9, 6);
    expect(overrides.actionModeNext).toBeCloseTo(0.8, 6);
    expect(overrides.actionQuickLook1).toBeCloseTo(0.6, 6);
    expect(overrides.actionRemix).toBeCloseTo(0.7, 6);
    expect(overrides.inputSourcePointer).toBe(1);
    expect(overrides.inputSourceMouse).toBe(1);
    expect(overrides.input_source_touch).toBe(0);
  });

  test('can reuse a target object without recomputing divergent aliases', () => {
    const input: UnifiedInputState = {
      time: 100,
      deltaMs: 16,
      pointers: [],
      pointerCount: 0,
      centroid: { x: 0, y: 0 },
      normalizedCentroid: { x: 0.25, y: -0.4 },
      primary: null,
      isPressed: true,
      justPressed: false,
      justReleased: false,
      dragDelta: { x: 0.3, y: 0.4 },
      source: 'pointer',
      gesture: null,
      mic: { level: 0.4, available: true },
      performance: {
        hoverActive: false,
        hover: null,
        wheelDelta: 0,
        wheelAccum: 0,
        dragIntensity: 0,
        dragAngle: 0,
        accentPulse: 0,
        sourceFlags: {
          pointer: true,
          keyboard: false,
          gamepad: false,
          mouse: true,
          touch: false,
          pen: false,
        },
        actions: {
          accent: 0,
          modeNext: 0,
          modePrevious: 0,
          presetNext: 0,
          presetPrevious: 0,
          quickLook1: 0,
          quickLook2: 0,
          quickLook3: 0,
          remix: 0,
        },
      },
    };

    const target = { stale: 1 } as Partial<
      ReturnType<typeof buildMilkdropInputSignalOverrides>
    >;
    const overrides = buildMilkdropInputSignalOverrides(input, target);

    expect(overrides).toBe(target);
    expect(overrides.inputSpeed).toBeCloseTo(0.5, 6);
    expect(overrides.input_speed).toBeCloseTo(0.5, 6);
  });
});
