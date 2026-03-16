import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import type { MilkdropRuntimeSignals } from '../assets/js/milkdrop/types.ts';
import { createMilkdropVM } from '../assets/js/milkdrop/vm.ts';

function makeSignals({
  frame = 1,
  beatPulse = 0.1,
}: {
  frame?: number;
  beatPulse?: number;
} = {}): MilkdropRuntimeSignals {
  const frequencyData = new Uint8Array(64);
  frequencyData.fill(160);

  return {
    time: frame / 60,
    deltaMs: 16.67,
    frame,
    fps: 60,
    bass: 0.7,
    mid: 0.5,
    mids: 0.5,
    treb: 0.4,
    treble: 0.4,
    bassAtt: 0.6,
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
    beat: frame % 2,
    beatPulse,
    beat_pulse: beatPulse,
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
  };
}

describe('milkdrop vm', () => {
  test('generates parity-oriented frame state with custom waves, shapes, borders, and post state', () => {
    const preset = compileMilkdropPresetSource(
      `
title=VM Smoke
bBrighten=1
ob_size=0.02
wavecode_0_enabled=1
wavecode_0_samples=48
wave_0_per_point1=y = y + sin(sample * pi * 4) * 0.08;
shapecode_0_enabled=1
shapecode_0_sides=7
shape_0_per_frame1=rad = 0.18 + bass_att * 0.04;
per_frame_1=q1 = q1 + 1; wave_a = min(1, wave_a + 0.1);
per_pixel_1=rot = rot + 0.001;
      `.trim(),
      { id: 'vm-smoke' },
    );

    const vm = createMilkdropVM(preset);
    const frameState = vm.step(makeSignals({ frame: 1 }));

    expect(frameState.presetId).toBe('vm-smoke');
    expect(frameState.title).toBe('VM Smoke');
    expect(frameState.mainWave.positions.length).toBeGreaterThan(0);
    expect(frameState.mainWave.positions.length % 3).toBe(0);
    expect(frameState.customWaves.length).toBe(1);
    expect(frameState.mesh.positions.length).toBeGreaterThan(0);
    expect(frameState.shapes.length).toBeGreaterThan(0);
    expect(frameState.borders.length).toBeGreaterThan(0);
    expect(frameState.post.brighten).toBe(true);
    expect(frameState.variables.q1).toBeCloseTo(1, 6);
  });

  test('accumulates and caps trail history across steps', () => {
    const preset = compileMilkdropPresetSource('title=Trail Test', {
      id: 'trail-test',
    });
    const vm = createMilkdropVM(preset);

    let trailsCount = 0;
    for (let frame = 1; frame <= 8; frame += 1) {
      const state = vm.step(makeSignals({ frame }));
      trailsCount = state.trails.length;
    }

    expect(trailsCount).toBeGreaterThan(0);
    expect(trailsCount).toBeLessThanOrEqual(5);
  });

  test('detail scale affects main-wave density and setPreset resets q/t registers', () => {
    const presetA = compileMilkdropPresetSource(
      `
title=Preset A
per_frame_1=q1=q1+1;
per_frame_2=t1=t1+1;
      `.trim(),
      { id: 'preset-a' },
    );
    const presetB = compileMilkdropPresetSource('title=Preset B', {
      id: 'preset-b',
    });

    const vm = createMilkdropVM(presetA);
    const highDetail = vm.step(makeSignals({ frame: 1, beatPulse: 0.2 }));
    vm.setDetailScale(0.5);
    const lowDetail = vm.step(makeSignals({ frame: 2, beatPulse: 0.2 }));

    expect(lowDetail.mainWave.positions.length).toBeLessThan(
      highDetail.mainWave.positions.length,
    );

    vm.setPreset(presetB);
    const resetFrame = vm.step(makeSignals({ frame: 3, beatPulse: 0.2 }));
    expect(resetFrame.presetId).toBe('preset-b');
    expect(resetFrame.variables.q1).toBe(0);
    expect(resetFrame.variables.t1).toBe(0);
  });
});
