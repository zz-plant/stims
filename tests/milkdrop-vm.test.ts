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
    bass: 0.7,
    mids: 0.5,
    treble: 0.4,
    bassAtt: 0.6,
    midsAtt: 0.45,
    trebleAtt: 0.35,
    rms: 0.5,
    beat: frame % 2,
    beatPulse,
    weightedEnergy: 0.58,
    frequencyData,
  };
}

describe('milkdrop vm', () => {
  test('generates frame state with waveform, mesh, and variables', () => {
    const preset = compileMilkdropPresetSource(
      `
title=VM Smoke
per_frame_1=q1 = q1 + 1; wave_a = min(1, wave_a + 0.1);
per_pixel_1=rot = rot + 0.001;
      `.trim(),
      { id: 'vm-smoke' },
    );

    const vm = createMilkdropVM(preset);
    const frameState = vm.step(makeSignals({ frame: 1 }));

    expect(frameState.presetId).toBe('vm-smoke');
    expect(frameState.title).toBe('VM Smoke');
    expect(frameState.waveform.positions.length).toBeGreaterThan(0);
    expect(frameState.waveform.positions.length % 3).toBe(0);
    expect(frameState.mesh.positions.length).toBeGreaterThan(0);
    expect(frameState.shapes.length).toBeGreaterThan(0);
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

  test('detail scale affects waveform density and setPreset resets register state', () => {
    const presetA = compileMilkdropPresetSource(
      `
title=Preset A
per_frame_1=q1=q1+1;
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

    expect(lowDetail.waveform.positions.length).toBeLessThan(
      highDetail.waveform.positions.length,
    );

    vm.setPreset(presetB);
    const resetFrame = vm.step(makeSignals({ frame: 3, beatPulse: 0.2 }));
    expect(resetFrame.presetId).toBe('preset-b');
    expect(resetFrame.variables.q1).toBe(0);
  });
});
