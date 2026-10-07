import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import { exportMilkdrop2Preset } from 'milkdrop-toolchain/src/milkdrop2-export.ts';
import { roundTripDiff } from '../../scripts/preset-lab-format-roundtrip.ts';

/**
 * Export is the file other engines open. MilkDrop 2 reads `[preset00]` with
 * its own key names and backtick shader lines; the editor's dialect gave it a
 * file whose base values were all ignored and whose shaders were missing.
 */
const _exportSource = (source: string) =>
  exportMilkdrop2Preset(
    compileMilkdropPresetSource(source, { id: `ex-${source.length}` }),
  );

const lines = (text: string) => text.split('\n');
const _value = (text: string, key: string) =>
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

describe('an exported preset comes back into Stims unchanged', () => {
  const dirs = ['public/milkdrop-presets', 'docs/authoring/examples'];
  const files = dirs.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.milk'))
      .map((name) => join(dir, name)),
  );

  test('corpus is not empty', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    test(file, () => {
      expect(roundTripDiff(readFileSync(file, 'utf8'), 'export')).toEqual([]);
    });
  }

  test('the sample preset round-trips, comments and ignored fields included', () => {
    expect(roundTripDiff(PRESET, 'export')).toEqual([]);
  });
});
