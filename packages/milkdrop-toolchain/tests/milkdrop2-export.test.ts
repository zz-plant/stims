import { describe, expect, test } from 'bun:test';
import { compileMilkdropPresetSource } from '../src/compiler.ts';
import { exportMilkdrop2Preset } from '../src/milkdrop2-export.ts';

/**
 * Export is the file other engines open. MilkDrop 2 reads `[preset00]` with
 * its own key names and backtick shader lines; the editor's dialect gave it a
 * file whose base values were all ignored and whose shaders were missing.
 */
const exportSource = (source: string) =>
  exportMilkdrop2Preset(
    compileMilkdropPresetSource(source, { id: `ex-${source.length}` }),
  );

const lines = (text: string) => text.split('\n');
const value = (text: string, key: string) =>
  lines(text)
    .find((line) => line.startsWith(`${key}=`))
    ?.slice(key.length + 1);

const PRESET = [
  'title="Glow Test"',
  'author=Someone',
  'gammaadj=1.5',
  'wave_mode=3',
  'wave_a=0.4',
  'video_echo_zoom=1.2',
  'blur1_min=0.1',
  'mv_a=0.5',
  'mesh_density=48',
  'b1ed=0.25',
  'wavecode_0_enabled=1',
  'wavecode_0_bSpectrum=1',
  'shapecode_0_enabled=1',
  'shapecode_0_thickOutline=1',
  'per_frame_init_1=q1 = 0.4;',
  'per_frame_1=zoom = zoom + q1*0.01; // pulse',
  '',
  '[comp_shader]',
  'ret = tex2D(sampler_main, uv).xyz;',
  '',
].join('\n');

describe('MilkDrop 2 export', () => {
  test('writes the version header before [preset00]', () => {
    const out = lines(exportSource(PRESET));
    expect(out.slice(0, 5)).toEqual([
      'MILKDROP_PRESET_VERSION=201',
      'PSVERSION=2',
      'PSVERSION_WARP=0',
      'PSVERSION_COMP=2',
      '[preset00]',
    ]);
  });

  test('uses the key names MilkDrop 2 reads', () => {
    const out = exportSource(PRESET);
    expect(value(out, 'fGammaAdj')).toBe('1.5');
    expect(value(out, 'nWaveMode')).toBe('3');
    expect(value(out, 'fWaveAlpha')).toBe('0.4');
    expect(value(out, 'fVideoEchoZoom')).toBe('1.2');
    expect(value(out, 'b1n')).toBe('0.1');
    expect(value(out, 'mv_a')).toBe('0.5');
    expect(value(out, 'wavecode_0_bSpectrum')).toBe('1');
    expect(value(out, 'shapecode_0_thickOutline')).toBe('1');
    for (const stimsName of ['gammaadj', 'wave_mode', 'blur1_min']) {
      expect(value(out, stimsName)).toBeUndefined();
    }
  });

  test('writes every base value, so another engine draws what Stims draws', () => {
    const out = exportSource('title=T\nzoom=1.01\n');
    // Not in the source, so these are the values Stims renders with.
    expect(value(out, 'fDecay')).toBeDefined();
    expect(value(out, 'ib_r')).toBe('0.25');
  });

  test('shaders become backtick lines with a shader_body MilkDrop can splice', () => {
    const out = lines(exportSource(PRESET)).filter((line) =>
      line.startsWith('comp_'),
    );
    expect(out).toEqual([
      'comp_1=`shader_body',
      'comp_2=`{',
      'comp_3=`  ret = tex2D(sampler_main, uv).xyz;',
      'comp_4=`}',
    ]);
    expect(exportSource(PRESET)).not.toContain('[comp_shader]');
  });

  test('keeps equations terminated and their comments', () => {
    const out = exportSource(PRESET);
    expect(value(out, 'per_frame_init_1')).toBe('q1 = 0.4;');
    expect(value(out, 'per_frame_1')).toBe('zoom = zoom + q1*0.01; // pulse');
  });

  test('Stims-only fields are written only when they change something', () => {
    const out = exportSource(PRESET);
    expect(value(out, 'mesh_density')).toBe('48');
    expect(value(out, 'beat_sensitivity')).toBeUndefined();
  });

  test('keeps title, author and fields Stims ignores; skips the placeholder title', () => {
    const out = exportSource(PRESET);
    expect(value(out, 'title')).toBe('"Glow Test"');
    expect(value(out, 'author')).toBe('Someone');
    expect(value(out, 'b1ed')).toBe('0.25');
    expect(value(exportSource('zoom=1.01\n'), 'title')).toBeUndefined();
  });
});
