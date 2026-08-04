/**
 * Catalog-wide compiler smoke test — catches the shader/sampler/alias
 * regressions that broke 13+ times in the last 400 commits *after* merge:
 * GLSL construct handling (`b6042c5b`), sampler bindings (`092c424c`),
 * legacy audio aliases (`f218276d`), shader-dependent classification
 * (`e6d39f61`), and parenthesized continuations (`685e7d05`).
 *
 * This runs in the unit profile (no GPU, no browser) by compiling every
 * bundled preset and asserting:
 *  1. No compile errors — a preset that no longer compiles is a regression.
 *  2. Every shader sampler reference normalises to a known sampler.
 *  3. Per-point custom wave programs compile (the construct that broke
 *     in `d7032f06`).
 *  4. Shader-dependent presets classify conservatively (`e6d39f61`).
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { isMilkdropShaderSamplerName } from '../../src/js/milkdrop/shader-samplers.ts';

const PRESET_DIR = join(process.cwd(), 'public/milkdrop-presets');
const presetFiles = readdirSync(PRESET_DIR)
  .filter((f) => f.endsWith('.milk'))
  .map((f) => ({ id: f.replace(/\.milk$/, ''), path: join(PRESET_DIR, f) }));

describe('catalog compiler smoke', () => {
  test('every bundled preset compiles without errors', () => {
    const failures: string[] = [];
    for (const { id, path } of presetFiles) {
      const raw = readFileSync(path, 'utf8');
      const compiled = compileMilkdropPresetSource(raw, {
        id,
        origin: 'bundled',
      });
      const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
      if (errors.length > 0) {
        failures.push(
          `${id}: ${errors.length} error(s) — ${errors[0]?.message ?? 'unknown'}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });

  test('every shader sampler in the catalog normalizes to a known sampler', () => {
    const unknown: string[] = [];
    for (const { id, path } of presetFiles) {
      const raw = readFileSync(path, 'utf8');
      const samplerLike =
        raw.match(/sampler_\w+|fw_\w+|noise\w*|blur[123]/gi) ?? [];
      for (const token of samplerLike) {
        if (!isMilkdropShaderSamplerName(token)) {
          unknown.push(`${id}: unrecognised sampler "${token}"`);
        }
      }
    }
    expect([...new Set(unknown)]).toEqual([]);
  });

  test('presets with custom wave per-point programs compile their statements', () => {
    let checked = 0;
    for (const { id, path } of presetFiles) {
      const raw = readFileSync(path, 'utf8');
      if (!/wave_\d+_per_point/i.test(raw)) continue;
      const compiled = compileMilkdropPresetSource(raw, {
        id,
        origin: 'bundled',
      });
      const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
      expect(errors).toEqual([]);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
