import { describe, expect, test } from 'bun:test';
import { Group } from 'three';
import { trimGroupChildren } from '../assets/js/milkdrop/renderer-adapter-shared.ts';
import {
  createParticleFieldObject,
  renderParticleFieldGroup,
} from '../assets/js/milkdrop/renderer-helpers/particle-field-renderer.ts';
import type { MilkdropRuntimeSignals } from '../assets/js/milkdrop/types.ts';
import {
  buildParticleFieldVisual,
  shouldEnableParticleField,
} from '../assets/js/milkdrop/vm/geometry-builder.ts';
import type { MeshField } from '../assets/js/milkdrop/vm/shared.ts';

function makeSignals(
  overrides: Partial<MilkdropRuntimeSignals> = {},
): MilkdropRuntimeSignals {
  const frequencyData = new Uint8Array(64);
  frequencyData.fill(160);
  const waveformData = new Uint8Array(64);
  waveformData.fill(128);
  return {
    time: 1 / 60,
    deltaMs: 16.67,
    frame: 1,
    fps: 60,
    bass: 0.7,
    mid: 0.5,
    mids: 0.5,
    treb: 0.4,
    treble: 0.4,
    bassAtt: 0.6,
    midAtt: 0.45,
    bass_att: 0.6,
    mid_att: 0.45,
    midsAtt: 0.45,
    mids_att: 0.45,
    treb_att: 0.35,
    trebleAtt: 0.35,
    treble_att: 0.35,
    rms: 0.5,
    vol: 0.5,
    music: 0.58,
    beat: 1,
    beatPulse: 0.2,
    beat_pulse: 0.2,
    transient: 0,
    spectralFlux: 0,
    weightedEnergy: 0.58,
    inputX: 0,
    inputY: 0,
    input_x: 0,
    input_y: 0,
    inputDx: 0,
    inputDy: 0,
    input_dx: 0,
    input_dy: 0,
    inputSpeed: 0,
    input_speed: 0,
    inputPressed: 0,
    input_pressed: 0,
    inputJustPressed: 0,
    input_just_pressed: 0,
    inputJustReleased: 0,
    input_just_released: 0,
    inputCount: 0,
    input_count: 0,
    gestureScale: 1,
    gesture_scale: 1,
    gestureRotation: 0,
    gesture_rotation: 0,
    gestureTranslateX: 0,
    gestureTranslateY: 0,
    gesture_translate_x: 0,
    gesture_translate_y: 0,
    hoverActive: 0,
    hover_active: 0,
    hoverX: 0,
    hoverY: 0,
    hover_x: 0,
    hover_y: 0,
    wheelDelta: 0,
    wheel_delta: 0,
    wheelAccum: 0,
    wheel_accum: 0,
    dragIntensity: 0,
    drag_intensity: 0,
    dragAngle: 0,
    drag_angle: 0,
    accentPulse: 0,
    accent_pulse: 0,
    actionAccent: 0,
    action_accent: 0,
    actionModeNext: 0,
    action_mode_next: 0,
    actionModePrevious: 0,
    action_mode_previous: 0,
    actionPresetNext: 0,
    action_preset_next: 0,
    actionPresetPrevious: 0,
    action_preset_previous: 0,
    actionQuickLook1: 0,
    action_quick_look_1: 0,
    actionQuickLook2: 0,
    action_quick_look_2: 0,
    actionQuickLook3: 0,
    action_quick_look_3: 0,
    actionRemix: 0,
    action_remix: 0,
    inputSourcePointer: 0,
    input_source_pointer: 0,
    inputSourceKeyboard: 0,
    input_source_keyboard: 0,
    inputSourceGamepad: 0,
    input_source_gamepad: 0,
    inputSourceMouse: 0,
    input_source_mouse: 0,
    inputSourceTouch: 0,
    input_source_touch: 0,
    inputSourcePen: 0,
    input_source_pen: 0,
    motionX: 0,
    motionY: 0,
    motionZ: 0,
    motion_x: 0,
    motion_y: 0,
    motion_z: 0,
    motionEnabled: 0,
    motion_enabled: 0,
    motionStrength: 0,
    motion_strength: 0,
    frequencyData,
    waveformData,
    ...overrides,
  };
}

function makeMeshField(density: number, pointCount: number): MeshField {
  const points = Array.from({ length: pointCount }, (_, index) => {
    const angle = (index / Math.max(1, pointCount)) * Math.PI * 2;
    const radius = 0.28 + (index % 7) / 28;
    return {
      sourceX: Math.cos(angle),
      sourceY: Math.sin(angle),
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
    };
  });

  return {
    density,
    points,
    program: null,
    signals: null,
  };
}

function makePositions(count: number) {
  const positions: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / Math.max(1, count)) * Math.PI * 2;
    const radius = 0.35 + (index % 5) / 40;
    positions.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.18);
  }
  return positions;
}

describe('milkdrop particle field', () => {
  test('derives an enabled particle field descriptor from mesh and audio state', () => {
    const signals = makeSignals();
    const descriptor = buildParticleFieldVisual({
      state: {
        wave_scale: 1.15,
        wave_a: 0.72,
        warp: 0.24,
        mesh_density: 24,
        wave_mode: 2,
      },
      meshField: makeMeshField(24, 144),
      signals,
      detailScale: 1.15,
      deviceProfile: { isMobile: false, lowPower: false },
    });

    expect(descriptor).toMatchObject({
      enabled: true,
      anchorSource: 'mesh-field',
    });
    expect(descriptor.instanceCount).toBeGreaterThan(0);
    expect(descriptor.size).toBeGreaterThan(0);
    expect(descriptor.alpha).toBeGreaterThan(0);
    expect(descriptor.motionScale).toBeGreaterThan(0);
  });

  test('scales instance count with mesh density and detail scale', () => {
    const signals = makeSignals({ beatPulse: 0.3, music: 0.7 });
    const low = buildParticleFieldVisual({
      state: {
        wave_scale: 1,
        wave_a: 0.5,
        warp: 0.1,
        mesh_density: 14,
        wave_mode: 0,
      },
      meshField: makeMeshField(14, 72),
      signals,
      detailScale: 0.9,
      deviceProfile: { isMobile: false, lowPower: false },
    });
    const high = buildParticleFieldVisual({
      state: {
        wave_scale: 1,
        wave_a: 0.5,
        warp: 0.1,
        mesh_density: 32,
        wave_mode: 0,
      },
      meshField: makeMeshField(32, 196),
      signals,
      detailScale: 1.6,
      deviceProfile: { isMobile: false, lowPower: false },
    });

    expect(low.enabled).toBe(true);
    expect(high.enabled).toBe(true);
    expect(high.instanceCount).toBeGreaterThan(low.instanceCount);
  });

  test('gates the particle field off on mobile, low-power, and sparse-mesh cases', () => {
    expect(
      shouldEnableParticleField({
        meshDensity: 8,
        pointCount: 72,
        detailScale: 1,
        isMobile: false,
        lowPower: false,
      }),
    ).toBe(false);
    expect(
      shouldEnableParticleField({
        meshDensity: 16,
        pointCount: 72,
        detailScale: 1,
        isMobile: true,
        lowPower: false,
      }),
    ).toBe(false);
    expect(
      shouldEnableParticleField({
        meshDensity: 16,
        pointCount: 72,
        detailScale: 1,
        isMobile: false,
        lowPower: true,
      }),
    ).toBe(false);
  });

  test('disposes the particle field when it becomes disabled', () => {
    const signals = makeSignals();
    const descriptor = buildParticleFieldVisual({
      state: {
        wave_scale: 1.1,
        wave_a: 0.68,
        warp: 0.16,
        mesh_density: 24,
        wave_mode: 1,
      },
      meshField: makeMeshField(24, 144),
      signals,
      detailScale: 1.1,
      deviceProfile: { isMobile: false, lowPower: false },
    });

    const positions = makePositions(96);
    const mesh = {
      positions,
      color: { r: 0.4, g: 0.7, b: 1 },
      alpha: 1,
    };
    const group = new Group();
    const object = createParticleFieldObject({
      particleField: descriptor,
      mesh,
      meshPositions: positions,
      signals,
      alphaMultiplier: 1,
    });

    expect(object).not.toBeNull();
    if (!object) {
      return;
    }

    let geometryDisposed = 0;
    let materialDisposed = 0;
    object.geometry.dispose = () => {
      geometryDisposed += 1;
    };
    object.material.dispose = () => {
      materialDisposed += 1;
    };
    group.add(object);

    renderParticleFieldGroup({
      target: 'particle-field',
      group,
      particleField: {
        ...descriptor,
        enabled: false,
        instanceCount: 0,
      },
      mesh,
      meshPositions: positions,
      signals,
      trimGroupChildren,
    });

    expect(group.children).toHaveLength(0);
    expect(geometryDisposed).toBe(1);
    expect(materialDisposed).toBe(1);
  });
});
