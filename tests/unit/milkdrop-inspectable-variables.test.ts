import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import type { MilkdropRuntimeSignals } from '../../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';

/**
 * Inspect shows what a preset's equations own. Enumerating the frame's
 * variable proxy instead snapshotted the whole VM state every frame (~1,650
 * keys for any preset) and buried the author's variables in built-ins.
 */
const SOURCE = [
  'title=Owned',
  'per_frame_init_1=speed = 0.5;',
  'per_frame_1=q1 = bass*speed; loop(2, hits = hits + 1);',
  'per_pixel_1=zoom = zoom + 0.01*rad;',
  'wavecode_0_enabled=1',
  'wave_0_per_frame1=t1 = time;',
  'shapecode_0_enabled=1',
  'shape_0_per_frame1=x = 0.5 + 0.1*q1;',
  '',
].join('\n');

const signals = (frame: number) =>
  ({
    time: frame / 60,
    deltaMs: 16.7,
    frame,
    fps: 60,
    aspect: 1,
    bass: 1.2,
    mid: 1,
    mids: 1,
    treb: 1,
    treble: 1,
    bassAtt: 1,
    midAtt: 1,
    midsAtt: 1,
    trebleAtt: 1,
    bass_att: 1,
    mid_att: 1,
    mids_att: 1,
    treb_att: 1,
    treble_att: 1,
    rms: 0.5,
    vol: 0.5,
    music: 0.5,
    beat: 0,
    beatPulse: 0,
    beat_pulse: 0,
    transient: 0,
    spectralFlux: 0,
    bandFlux: 0,
    frequencyData: new Uint8Array(64),
    waveformData: new Float32Array(512),
  }) as unknown as MilkdropRuntimeSignals;

describe('inspectable variables', () => {
  test('are the q-registers and what the equations assign, with live values', () => {
    const vm = createMilkdropVM(
      compileMilkdropPresetSource(SOURCE, { id: 'owned' }),
    );
    const frame = vm.step(signals(3));
    const owned = vm.getInspectableVariables();
    const names = Object.keys(owned);

    expect(names.slice(0, 32)).toEqual(
      Array.from({ length: 32 }, (_, i) => `q${i + 1}`),
    );
    expect(names.slice(32).sort()).toEqual(
      ['hits', 'shape1_x', 'speed', 'wave1_t1', 'zoom'].sort(),
    );
    // The same values the full snapshot reports.
    for (const name of names) {
      expect(owned[name]).toBe(frame.variables[name] as number);
    }
    expect(owned.q1).toBeCloseTo(0.6, 6);
    expect(owned.speed).toBe(0.5);
    // A small fraction of the full state.
    expect(names.length).toBeLessThan(Object.keys(frame.variables).length / 20);
  });

  test('follow the preset when the VM switches to another', () => {
    const vm = createMilkdropVM(
      compileMilkdropPresetSource(SOURCE, { id: 'first' }),
    );
    vm.step(signals(1));
    // Read once first, so the names are cached for the old preset.
    expect(Object.keys(vm.getInspectableVariables())).toContain('speed');
    vm.setPreset(
      compileMilkdropPresetSource('title=B\nper_frame_1=other = 2;\n', {
        id: 'second',
      }),
    );
    vm.step(signals(2));
    const names = Object.keys(vm.getInspectableVariables());
    expect(names).toContain('other');
    expect(names).not.toContain('speed');
  });
});
