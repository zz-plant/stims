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
 *
 * The scan is recursive. It previously read only the top level of
 * `public/milkdrop-presets`, covering 45 of 1,859 presets and leaving the
 * whole bundled butterchurn corpus unchecked — which is how an unresolved
 * `sampler_fw_main` stayed hidden in 107 of them.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';
import { normalizeMilkdropShaderSamplerName } from '../../src/js/milkdrop/shader-samplers.ts';

const PRESET_DIR = join(process.cwd(), 'public/milkdrop-presets');

/**
 * Tokens that unambiguously name a sampler. A bare `noise\w*` pattern is
 * deliberately excluded: preset shaders declare locals like `noise_1` and
 * `noise3_2`, which are not sampler references and would make this assertion
 * fail on legitimate code. The prefixed forms of those samplers
 * (`sampler_noise_lq`, `fw_noise_hq`) are still covered here.
 */
const SAMPLER_TOKEN_PATTERN = /\b(?:sampler_\w+|fw_\w+|blur[123])\b/gi;

type CompiledPreset = {
  id: string;
  raw: string;
  compiled: ReturnType<typeof compileMilkdropPresetSource>;
};

function listPresetFiles() {
  return readdirSync(PRESET_DIR, { recursive: true })
    .map(String)
    .filter((entry) => entry.toLowerCase().endsWith('.milk'))
    .map((entry) => ({
      id: entry.replace(/\.milk$/i, ''),
      path: join(PRESET_DIR, entry),
    }));
}

// Compiling the full catalog takes a few seconds, so it happens once in
// `beforeAll` and every assertion reads the same results. Doing it inside the
// first test instead would push that test past Bun's default 5s timeout.
const CATALOG_COMPILE_TIMEOUT_MS = 60_000;

let cachedPresets: CompiledPreset[] = [];
function compileCatalog(): CompiledPreset[] {
  return cachedPresets;
}

beforeAll(() => {
  cachedPresets = listPresetFiles().map(({ id, path }) => {
    const raw = readFileSync(path, 'utf8');
    return {
      id,
      raw,
      compiled: compileMilkdropPresetSource(raw, { id, origin: 'bundled' }),
    };
  });
}, CATALOG_COMPILE_TIMEOUT_MS);

function errorsOf(entry: CompiledPreset) {
  return entry.compiled.diagnostics.filter((d) => d.severity === 'error');
}

describe('catalog compiler smoke', () => {
  test('covers the whole bundled catalog, not just the top-level directory', () => {
    // Guards the scan itself: a non-recursive readdir still returns ~45 files
    // and every other assertion here would keep passing while covering 2% of
    // the catalog.
    expect(compileCatalog().length).toBeGreaterThan(1500);
  });

  test('every bundled preset compiles without errors', () => {
    const failures = compileCatalog()
      .filter((entry) => errorsOf(entry).length > 0)
      .map((entry) => {
        const errors = errorsOf(entry);
        return `${entry.id}: ${errors.length} error(s) — ${errors[0]?.message ?? 'unknown'}`;
      });
    expect(failures).toEqual([]);
  });

  test('every shader sampler in the catalog normalizes to a known sampler', () => {
    const unknown = new Set<string>();
    for (const { id, raw } of compileCatalog()) {
      for (const token of raw.match(SAMPLER_TOKEN_PATTERN) ?? []) {
        // The canonical-set predicate is the wrong check here: it only accepts
        // already-canonical names, so every `sampler_`-prefixed and aliased
        // form would read as unknown. Resolution is what actually matters —
        // it is what the WebGPU binding path calls.
        if (normalizeMilkdropShaderSamplerName(token) === null) {
          unknown.add(`${id}: unrecognised sampler "${token}"`);
        }
      }
    }
    expect([...unknown]).toEqual([]);
  });

  test('presets with custom wave per-point programs compile their statements', () => {
    const withPerPoint = compileCatalog().filter((entry) =>
      /wave_\d+_per_point/i.test(entry.raw),
    );
    const failures = withPerPoint
      .filter((entry) => errorsOf(entry).length > 0)
      .map((entry) => `${entry.id}: ${errorsOf(entry)[0]?.message}`);

    expect(withPerPoint.length).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });
});
