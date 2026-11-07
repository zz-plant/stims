import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
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

function warpFieldFor(perPixel: string, aspect = 1) {
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
  const frame = createMilkdropVM(preset).step({ ...signals(0), aspect });
  return frame;
}

describe('warp field sample coordinates', () => {
  test('a per-pixel zoom of 2 samples halfway toward the centre', () => {
    const frame = warpFieldFor('zoom = 2; warp = 0;');
    const field = frame.warpField;
    expect(field).toBeTruthy();
    const { uvs, sampleUvs } = field as NonNullable<typeof field>;
    expect(sampleUvs.length).toBe(uvs.length);
    for (let index = 0; index < uvs.length; index += 1) {
      const lattice = uvs[index] ?? 0;
      expect(sampleUvs[index]).toBeCloseTo(0.5 + (lattice - 0.5) / 2, 4);
    }
  });

  // butterchurn 2.6.7's runPixelEquations, term for term: this is the reference
  // the gather has to equal, at any aspect and with every output written.
  function butterchurnSample(
    gridX: number,
    gridY: number,
    aspectX: number,
    aspectY: number,
    out: {
      zoom: number;
      zoomexp: number;
      rot: number;
      cx: number;
      cy: number;
      sx: number;
      sy: number;
      dx: number;
      dy: number;
    },
  ) {
    const rad = Math.hypot(gridX * aspectX, gridY * aspectY);
    const zoom = out.zoom ** (out.zoomexp ** (rad * 2 - 1));
    let u = (gridX * 0.5 * aspectX) / zoom + 0.5;
    let v = (-gridY * 0.5 * aspectY) / zoom + 0.5;
    u = (u - out.cx) / out.sx + out.cx;
    v = (v - out.cy) / out.sy + out.cy;
    const fromU = u - out.cx;
    const fromV = v - out.cy;
    const cos = Math.cos(out.rot);
    const sin = Math.sin(out.rot);
    u = fromU * cos - fromV * sin + out.cx - out.dx;
    v = fromU * sin + fromV * cos + out.cy - out.dy;
    return { u: (u - 0.5) / aspectX + 0.5, v: 1 - ((v - 0.5) / aspectY + 0.5) };
  }

  test.each([
    ['landscape', 16 / 9, 1, 9 / 16],
    ['square', 1, 1, 1],
    ['portrait', 390 / 844, 390 / 844, 1],
  ])(
    'equals butterchurn on a %s screen',
    (_label, aspect, aspectX, aspectY) => {
      const out = {
        zoom: 1.3,
        zoomexp: 1.4,
        rot: 0.35,
        cx: 0.62,
        cy: 0.41,
        sx: 1.1,
        sy: 0.9,
        dx: 0.03,
        dy: -0.02,
      };
      const frame = warpFieldFor(
        'warp = 0; zoom = 1.3; zoomexp = 1.4; rot = 0.35; cx = 0.62; cy = 0.41; sx = 1.1; sy = 0.9; dx = 0.03; dy = -0.02;',
        aspect,
      );
      const { uvs, sampleUvs } = frame.warpField as NonNullable<
        MilkdropFrameState['warpField']
      >;
      for (let index = 0; index < uvs.length; index += 2) {
        const expected = butterchurnSample(
          (uvs[index] ?? 0) * 2 - 1,
          (uvs[index + 1] ?? 0) * 2 - 1,
          aspectX,
          aspectY,
          out,
        );
        expect(sampleUvs[index]).toBeCloseTo(expected.u, 4);
        expect(sampleUvs[index + 1]).toBeCloseTo(expected.v, 4);
      }
    },
  );

  test('a centre far off screen leaves every vertex sampling something', () => {
    // krash-rovastar-cerebral-demons-stars sends its scatter vertices off
    // screen this way. Each gather vertex keeps its own place on the lattice.
    const frame = warpFieldFor('warp = 0; cx = 40; cy = -40; rot = 0.02;');
    const { uvs, sampleUvs } = frame.warpField as NonNullable<
      MilkdropFrameState['warpField']
    >;
    expect(new Set(uvs).size).toBeGreaterThan(1);
    for (const value of sampleUvs) expect(Number.isFinite(value)).toBe(true);
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
