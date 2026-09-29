import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { applyRecipe, COOKBOOK } from '../../src/js/milkdrop/cookbook.ts';
import { checkPortability } from '../../src/js/milkdrop/portability.ts';
import type { MilkdropRuntimeSignals } from '../../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../../src/js/milkdrop/vm.ts';

/**
 * Every cookbook recipe must, added to a preset: compile, carry over to
 * MilkDrop 2, and change what is drawn. The old Insert tab pasted bare lines
 * that were base values — evaluated once with the audio silent — so each one
 * compiled cleanly and did nothing.
 */
function signals(frame: number, loud = true): MilkdropRuntimeSignals {
  const bass = loud ? 1 + 0.8 * Math.sin(frame / 4) : 1;
  const treb = 1 + 0.5 * Math.sin(frame / 3);
  return {
    time: frame / 60,
    deltaMs: 16.7,
    frame,
    fps: 60,
    aspect: 16 / 9,
    bass,
    mid: 1,
    mids: 1,
    treb,
    treble: treb,
    bassAtt: bass,
    midAtt: 1,
    midsAtt: 1,
    trebleAtt: treb,
    bass_att: bass,
    mid_att: 1,
    mids_att: 1,
    treb_att: treb,
    treble_att: treb,
    rms: 0.5,
    vol: 0.5,
    music: 0.5,
    beat: 0,
    beatPulse: 0,
    beat_pulse: 0,
    transient: 0,
    spectralFlux: 0,
    bandFlux: 0,
    frequencyData: new Uint8Array(64).fill(128),
    waveformData: new Float32Array(512),
  } as unknown as MilkdropRuntimeSignals;
}

/** What reaches the renderer over 40 frames, in a comparable form. */
function render(source: string, loud = true) {
  const vm = createMilkdropVM(
    compileMilkdropPresetSource(source, { id: source }),
  );
  const frames: string[] = [];
  for (let frame = 1; frame <= 40; frame += 1) {
    const state = vm.step(signals(frame, loud));
    frames.push(
      JSON.stringify({
        variables: state.variables,
        mesh: Array.from(state.mesh?.positions ?? []),
        warp: state.warpField
          ? Array.from(Object.values(state.warpField))
          : null,
      }),
    );
  }
  return frames.join('\n');
}

const BASE = 'title=Base\nzoom=1\nwarp=0\n';

describe('technique cookbook', () => {
  test('recipes have unique ids and something to add', () => {
    expect(new Set(COOKBOOK.map((r) => r.id)).size).toBe(COOKBOOK.length);
    for (const recipe of COOKBOOK) {
      expect(Object.values(recipe.code).flat().length).toBeGreaterThan(0);
    }
  });

  const baseline = render(BASE);
  for (const recipe of COOKBOOK) {
    test(`${recipe.id}: compiles, stays portable, and changes the picture`, () => {
      const { source } = applyRecipe(BASE, recipe);
      const compiled = compileMilkdropPresetSource(source, { id: recipe.id });
      expect(
        compiled.diagnostics.filter((d) => d.severity === 'error'),
      ).toEqual([]);
      expect(checkPortability(compiled, source)).toEqual([]);
      expect(render(source) === baseline).toBe(false);
    });
  }

  test('the same code pasted as a bare line never hears the audio (why recipes name a block)', () => {
    const line = 'zoom = zoom + 0.06*(bass_att - 1)';
    // A base value: evaluated once, with the audio silent.
    const bare = `${BASE}${line}\n`;
    expect(render(bare, true) === render(bare, false)).toBe(true);
    // The recipe puts it in per_frame, where it runs every frame.
    const recipe = applyRecipe(BASE, COOKBOOK[0] as (typeof COOKBOOK)[number]);
    expect(recipe.source).toContain(`per_frame_1=${line};`);
    expect(render(recipe.source, true) === render(recipe.source, false)).toBe(
      false,
    );
  });
});

describe('applyRecipe', () => {
  const recipe = (code: Parameters<typeof applyRecipe>[1]['code']) => ({
    id: 't',
    title: 't',
    summary: '',
    how: '',
    code,
  });

  test('continues each block after its last line, with the next number', () => {
    const source = [
      'title=T',
      'per_frame_init_1=q1 = 0;',
      'per_frame_1=zoom = 1.01;',
      'per_frame_2=rot = 0.01;',
      'per_pixel_1=warp = 0;',
      '',
    ].join('\n');
    const { source: out, firstLine } = applyRecipe(
      source,
      recipe({
        init: ['q9 = 1;'],
        perFrame: ['cx = 0.5;'],
        perPixel: ['sx = 1;'],
      }),
    );
    expect(out.split('\n')).toEqual([
      'title=T',
      'per_frame_init_1=q1 = 0;',
      'per_frame_init_2=q9 = 1;',
      'per_frame_1=zoom = 1.01;',
      'per_frame_2=rot = 0.01;',
      'per_frame_3=cx = 0.5;',
      'per_pixel_1=warp = 0;',
      'per_pixel_2=sx = 1;',
      '',
    ]);
    expect(firstLine).toBe(3);
  });

  test('a new block goes before the shader sections, not inside them', () => {
    const source = 'title=T\n[comp_shader]\nshader_body { ret = 0; }\n';
    const { source: out } = applyRecipe(
      source,
      recipe({ perFrame: ['zoom = 1.02;'] }),
    );
    expect(out.split('\n').slice(0, 3)).toEqual([
      'title=T',
      'per_frame_1=zoom = 1.02;',
      '[comp_shader]',
    ]);
    const compiled = compileMilkdropPresetSource(out, { id: 'before-shader' });
    expect(compiled.ir.programs.perFrame.sourceLines).toEqual(['zoom = 1.02']);
  });

  test('numbers after gaps and the older init_N spelling', () => {
    const { source: out } = applyRecipe(
      'title=T\ninit_4=q1 = 0;\nper_frame_7=zoom = 1;\n',
      recipe({ init: ['q2 = 0;'], perFrame: ['rot = 0;'] }),
    );
    expect(out).toContain('per_frame_init_5=q2 = 0;');
    expect(out).toContain('per_frame_8=rot = 0;');
  });
});
