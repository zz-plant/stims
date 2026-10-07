import { describe, expect, it } from 'bun:test';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { analyzePresetMath } from 'milkdrop-toolchain/src/preset-math-analyzer.ts';
import {
  buildScenarioInputs,
  runTrace,
} from '../../scripts/preset-lab-replay.ts';
import {
  appendProgramLines,
  blendPresetSources,
  mutatePresetStyle,
  PRESET_MUTATION_STYLES,
} from '../../src/js/milkdrop/preset-mutations.ts';

describe('preset math analyzer', () => {
  const samplePreset = `[preset00]
fRating=3.000000
fDecay=0.960000
fWaveAlpha=0.800000
fWaveScale=1.000000
fWaveSmoothing=0.750000
fWaveParam=0.000000
fModWaveAlphaByVolume=0
fModWaveAlphaByFreq=0
fWaveMode=0
fWaveR=0.900000
fWaveG=0.100000
fWaveB=0.800000
fWaveX=0.500000
fWaveY=0.500000
bAdditiveWaves=0
bWaveDots=0
bWaveThick=0
bModWaveAlphaByVolume=0
bMaximizeWaveColor=1
bTexWrap=1
bDarkenCenter=0
bRedBlueStereo=0
bBrighten=0
bDarken=0
bSolarize=0
bInvert=0
fWarpAnimSpeed=1.000000
fWarpScale=1.000000
fZoomExponent=1.000000
fShader=0.000000
zoom=1.030000
rot=0.020000
cx=0.500000
cy=0.500000
dx=0.000000
dy=0.000000
warp=0.120000
sx=1.000000
sy=1.000000
wave_r=0.900000
wave_g=0.100000
wave_b=0.800000
wave_x=0.500000
wave_y=0.500000
per_frame=zoom = 1.0 + 0.05 * sin(time * 0.8) + 0.03 * bass_att;
per_frame=rot = 0.02 * cos(time * 0.5);
per_pixel=rot = rot + 0.04 * sin(rad * 6.0 - time);
per_pixel=warp = warp + 0.05 * sin(ang * 4.0);
`;

  it('analyzes motion vectors and reactivity accurately', () => {
    const analysis = analyzePresetMath(samplePreset);
    expect(analysis.motion.hasZoom).toBe(true);
    expect(analysis.motion.hasRotation).toBe(true);
    expect(analysis.motion.hasWarp).toBe(true);
    expect(analysis.audioReactivity.reactsToBass).toBe(true);
    expect(analysis.colors.primaryHueHint).toBe('Magenta');
    expect(analysis.summary).toContain('Audio: reacts to bass.');
  });

  it('reads the numbered equation lines real .milk files use', () => {
    const analysis = analyzePresetMath(
      'per_frame_1=rot = 0.1 * treb;\nper_pixel_1=zoom = zoom + 0.01 * bass;',
    );
    expect(analysis.motion.hasRotation).toBe(true);
    expect(analysis.audioReactivity.reactsToBass).toBe(true);
    expect(analysis.audioReactivity.reactsToTreble).toBe(true);
  });
});

describe('preset mutations', () => {
  const base = `[preset00]
zoom=1.000000
rot=0.000000
warp=0.000000
decay=0.980000
wave_r=0.500000
wave_g=0.500000
wave_b=0.500000
`;

  it('mutates style to cyberpunk with neon palette and treble response', () => {
    const mutated = mutatePresetStyle(base, 'cyberpunk');
    expect(mutated).toContain('wave_r=0.95');
    expect(mutated).toContain('wave_b=0.85');
    expect(mutated).toContain('treb_att');
  });

  it('mutates style to hyperspace with vortex zoom and coordinate warp', () => {
    const mutated = mutatePresetStyle(base, 'hyperspace');
    expect(mutated).toContain('zoom=1.04');
    expect(mutated).toContain('rad * 6.0');
  });

  it('blends two presets with linear interpolation', () => {
    const other = `[preset00]
zoom=1.100000
rot=0.100000
warp=0.200000
decay=0.900000
wave_r=1.000000
wave_g=0.000000
wave_b=0.000000
`;
    const blended = blendPresetSources(base, other, 0.5);
    expect(blended).toContain('zoom=1.05');
    expect(blended).toContain('rot=0.05');
    expect(blended).toContain('decay=0.94');
  });
});

describe('preset restyles take effect', () => {
  // A realistic preset: MilkDrop 2 spellings and its own numbered equations.
  const preset = `[preset00]
fDecay=0.980000
zoom=1.000000
bTexWrap=0
per_frame_1=rot = 0.01;
per_frame_init_1=q1 = 0;
per_pixel_1=zoom = zoom + 0.001 * rad;
`;
  const compile = (source: string) =>
    compileMilkdropPresetSource(source, { id: 'restyle-test' });

  for (const { id } of PRESET_MUTATION_STYLES) {
    it(`${id}: every line it adds compiles into the preset`, () => {
      const before = compile(preset).ir.programs;
      const after = compile(mutatePresetStyle(preset, id));
      // Nothing the restyle wrote is dropped as an unknown field...
      expect(
        after.diagnostics.filter(
          (diagnostic) => diagnostic.code === 'preset_unknown_field',
        ),
      ).toEqual([]);
      // ...and its equations joined the programs, after the preset's own.
      const added =
        after.ir.programs.perFrame.statements.length +
        after.ir.programs.perPixel.statements.length -
        before.perFrame.statements.length -
        before.perPixel.statements.length;
      expect(added).toBeGreaterThan(0);
      expect(after.ir.programs.perFrame.statements[0]?.source).toBe(
        'rot = 0.01',
      );
    });
  }

  it('bass pulse makes zoom follow the bass', () => {
    const inputs = buildScenarioInputs('bass-pulse', 120);
    const zooms = runTrace(
      mutatePresetStyle(preset, 'bass-surge'),
      'restyle-test',
      inputs,
    ).map((frame) => frame.variables?.zoom ?? 0);
    expect(Math.max(...zooms) - Math.min(...zooms)).toBeGreaterThan(0.02);
  });

  it('texture wrap is set by the restyles that ask for it', () => {
    const wrapped = compile(mutatePresetStyle(preset, 'hyperspace'));
    expect(wrapped.ir.numericFields.texture_wrap).toBe(1);
  });

  it('applying a restyle twice adds its equations once', () => {
    const once = mutatePresetStyle(preset, 'bass-surge');
    const twice = mutatePresetStyle(once, 'bass-surge');
    expect(compile(twice).ir.programs.perFrame.statements.length).toBe(
      compile(once).ir.programs.perFrame.statements.length,
    );
  });
});

describe('appendProgramLines', () => {
  it('numbers new lines after the highest existing index', () => {
    const source =
      '[preset00]\nper_frame_1=a = 1;\nPER_FRAME_4=b = 2;\nper_frame_init_9=c = 3;\n';
    const out = appendProgramLines(source, 'per_frame', ['x = 1;', 'y = 2;']);
    const statements = compileMilkdropPresetSource(out, { id: 'append' }).ir
      .programs.perFrame.statements;
    expect(statements.map((statement) => statement.source)).toEqual([
      'a = 1',
      'b = 2',
      'x = 1',
      'y = 2',
    ]);
  });

  it('starts at 1 in a preset without that program', () => {
    const out = appendProgramLines('[preset00]\nzoom=1\n', 'per_pixel', [
      'rot = rot + 0.01 * rad;',
    ]);
    expect(
      compileMilkdropPresetSource(out, { id: 'append' }).ir.programs.perPixel
        .statements,
    ).toHaveLength(1);
  });
});
