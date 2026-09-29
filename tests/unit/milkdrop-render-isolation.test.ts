import { afterEach, describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import {
  clearRenderIsolation,
  toggleMute,
  toggleSolo,
} from '../../src/js/milkdrop/render-isolation.ts';
import type { MilkdropRuntimeSignals } from '../../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';

/**
 * Solo and mute from the Outline: the frame the renderer receives must leave
 * out exactly the hidden waves and shapes, and nothing about the source or
 * the running state may change.
 */
const SOURCE = [
  'title=Isolation',
  'wave_a=0.8',
  'wavecode_0_enabled=1',
  'wavecode_1_enabled=1',
  'shapecode_0_enabled=1',
  'shapecode_1_enabled=1',
  'shape_1_per_frame1=x = 0.5 + 0.1*sin(time);',
  'per_frame_1=q1 = q1 + 1;',
  '',
].join('\n');

function signals(frame: number): MilkdropRuntimeSignals {
  return {
    time: frame / 60,
    deltaMs: 16.67,
    frame,
    fps: 60,
    aspect: 16 / 9,
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
    beat: 0,
    beatPulse: 0,
    beat_pulse: 0,
    transient: 0,
    spectralFlux: 0,
    bandFlux: 0,
    frequencyData: new Uint8Array(64).fill(160),
    waveformData: new Float32Array(512),
  } as unknown as MilkdropRuntimeSignals;
}

// The title makes each source unique: the compile cache is keyed on the text
// and would otherwise hand back the first test's preset id.
const compile = (id: string) =>
  compileMilkdropPresetSource(
    SOURCE.replace('title=Isolation', `title=${id}`),
    {
      id,
    },
  );

function frameOf(id: string, frames = 1) {
  const vm = createMilkdropVM(compile(id));
  let frame = vm.step(signals(1));
  for (let n = 2; n <= frames; n += 1) frame = vm.step(signals(n));
  return {
    shapes: frame.shapes.map((shape) => shape.key),
    waves: frame.customWaves.length,
    mainWaveAlpha: frame.mainWave.alpha,
    q1: frame.variables.q1,
  };
}

afterEach(() => {
  clearRenderIsolation();
});

describe('render isolation', () => {
  test('with nothing isolated every enabled wave and shape draws', () => {
    const frame = frameOf('iso-none');
    expect(frame.shapes).toEqual(['shape_1', 'shape_2']);
    expect(frame.waves).toBe(2);
    expect(frame.mainWaveAlpha).toBeGreaterThan(0);
  });

  test('soloing a shape draws only that shape, and hides waves and the main wave', () => {
    toggleSolo('iso-solo', { kind: 'shape', index: 2 });
    const frame = frameOf('iso-solo');
    expect(frame.shapes).toEqual(['shape_2']);
    expect(frame.waves).toBe(0);
    expect(frame.mainWaveAlpha).toBe(0);
  });

  test('soloing a wave keeps only that wave', () => {
    toggleSolo('iso-wave', { kind: 'wave', index: 1 });
    const frame = frameOf('iso-wave');
    expect(frame.shapes).toEqual([]);
    expect(frame.waves).toBe(1);
  });

  test('muting hides one element and leaves the rest', () => {
    toggleMute('iso-mute', { kind: 'shape', index: 1 });
    const frame = frameOf('iso-mute');
    expect(frame.shapes).toEqual(['shape_2']);
    expect(frame.waves).toBe(2);
    expect(frame.mainWaveAlpha).toBeGreaterThan(0);
  });

  test('toggling solo again restores the frame', () => {
    toggleSolo('iso-toggle', { kind: 'shape', index: 2 });
    toggleSolo('iso-toggle', { kind: 'shape', index: 2 });
    expect(frameOf('iso-toggle').shapes).toEqual(['shape_1', 'shape_2']);
  });

  test('isolation set for one preset does not touch another', () => {
    toggleSolo('iso-a', { kind: 'shape', index: 2 });
    expect(frameOf('iso-b').shapes).toEqual(['shape_1', 'shape_2']);
  });

  test('the preset keeps running while its parts are hidden', () => {
    const plain = frameOf('iso-run-plain', 5).q1;
    toggleSolo('iso-run', { kind: 'wave', index: 2 });
    expect(frameOf('iso-run', 5).q1).toBe(plain);
  });
});
