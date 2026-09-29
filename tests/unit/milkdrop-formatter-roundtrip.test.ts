import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  fingerprintPreset,
  roundTripDiff,
} from '../../scripts/preset-lab-format-roundtrip.ts';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { formatMilkdropPreset } from '../../src/js/milkdrop/formatter.ts';

/**
 * The Format button rewrites an author's buffer from the compiled IR. If that
 * rewrite drops or alters anything the compiler understood, "tidy up" silently
 * changes the preset. This runs every bundled preset and authoring example
 * through compile → format → compile and requires the second IR to match the
 * first on everything that affects rendering.
 */
const dirs = ['public/milkdrop-presets', 'docs/authoring/examples'];
const files = dirs.flatMap((dir) =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.milk'))
    .map((name) => join(dir, name)),
);

const fingerprint = fingerprintPreset;

describe('formatter round-trip', () => {
  test('corpus is not empty', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    test(`${file} survives format → recompile`, () => {
      const source = readFileSync(file, 'utf8');
      const before = fingerprint(source);
      const formatted = formatMilkdropPreset(
        compileMilkdropPresetSource(source, { id: 'roundtrip' }),
      );
      expect(fingerprint(formatted)).toEqual(before);
    });
  }

  test('detects a dropped equation (mutation check)', () => {
    const source = 'title=T\nper_frame_1=zoom=1.1;\nper_frame_2=rot=0.2;\n';
    const formatted = formatMilkdropPreset(
      compileMilkdropPresetSource(source, { id: 'roundtrip' }),
    ).replace(/^per_frame_2=.*\n/mu, '');
    expect(fingerprint(formatted)).not.toEqual(fingerprint(source));
  });

  test('keeps a shader that opens with a preprocessor directive', () => {
    // `#` is a comment in the key=value body but a directive in a shader
    // section; Format writes shader text as bare lines, so a leading #define
    // used to make the parser drop the whole section on the next load.
    const source = [
      'title=T',
      'comp_1=`shader_body',
      'comp_2=`{',
      'comp_3=`  ret = tex2D(sampler_main, uv).xyz;',
      'comp_4=`}',
      '',
    ]
      .join('\n')
      .replace(
        'comp_1=`shader_body',
        'comp_1=`#define sat saturate\ncomp_1=`shader_body',
      );
    expect(fingerprint(source)['shader:comp']).toBeTruthy();
    expect(roundTripDiff(source)).toEqual([]);
  });
});
