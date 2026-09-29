import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { applyMotionDampening } from '../../src/js/milkdrop/runtime/motion-dampener.ts';
import type {
  MilkdropFrameState,
  MilkdropRuntimeSignals,
} from '../../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';

/**
 * A warp shader's `uv` is MilkDrop's per-vertex warped coordinate, so the
 * warp field ships the gather form of the per-pixel transform as
 * `sampleUvs`: for each lattice vertex, the [0,1] coordinate the previous
 * frame is read from. The WebGL feedback manager rasterises it into the
 * texture the warp template's `uv` reads.
 */
function signals(frame: number): MilkdropRuntimeSignals {
  return {
    time: frame / 60,
    deltaMs: 16.67,
    frame,
    fps: 60,
    aspect: 1,
    bass: 0.5,
    mid: 0.5,
    mids: 0.5,
    treb: 0.5,
    treble: 0.5,
    bassAtt: 0.5,
    midAtt: 0.5,
    bass_att: 0.5,
    mid_att: 0.5,
    midsAtt: 0.5,
    mids_att: 0.5,
    treb_att: 0.5,
    trebleAtt: 0.5,
    treble_att: 0.5,
    rms: 0.5,
    vol: 0.5,
    music: 0.5,
    beat: 0,
    beatPulse: 0,
    beat_pulse: 0,
    frequencyData: new Uint8Array(64).fill(128),
    waveformData: new Float32Array(512),
  } as unknown as MilkdropRuntimeSignals;
}

function warpFieldFor(perPixel: string) {
  const preset = compileMilkdropPresetSource(
    [
      '[preset00]',
      'zoom=1.0',
      'rot=0.0',
      `per_pixel_1=${perPixel}`,
      'warp_1=`shader_body',
      'warp_2=`{',
      'warp_3=`    ret = tex2D(sampler_main, uv).xyz;',
      'warp_4=`}',
    ].join('\n'),
    { id: 'warp-field-sample-uvs', origin: 'bundled' },
  );
  const frame = createMilkdropVM(preset).step(signals(0));
  return frame;
}

describe('warp field sample coordinates', () => {
  test('a per-pixel zoom of 2 samples halfway toward the centre', () => {
    const frame = warpFieldFor('zoom = 2;');
    const field = frame.warpField;
    expect(field).toBeTruthy();
    const { uvs, sampleUvs } = field as NonNullable<typeof field>;
    expect(sampleUvs.length).toBe(uvs.length);
    for (let index = 0; index < uvs.length; index += 1) {
      const lattice = uvs[index] ?? 0;
      expect(sampleUvs[index]).toBeCloseTo(0.5 + (lattice - 0.5) / 2, 4);
    }
  });

  test('the motion dampener pulls sample coordinates back to the lattice', () => {
    const frame = warpFieldFor('zoom = 2;') as MilkdropFrameState;
    const { uvs, sampleUvs } = frame.warpField as NonNullable<
      MilkdropFrameState['warpField']
    >;
    applyMotionDampening(frame, 0);
    for (let index = 0; index < uvs.length; index += 1) {
      expect(sampleUvs[index]).toBeCloseTo(uvs[index] ?? 0, 6);
    }
  });
});
