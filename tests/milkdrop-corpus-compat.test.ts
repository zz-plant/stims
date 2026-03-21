import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';

const BUNDLED_WEBGPU_PARTIAL_PRESETS = [
  'aurora-feedback-core.milk',
  'kinetic-grid-pulse.milk',
  'low-motion-halo-drift.milk',
  'prism-drum-tunnel.milk',
] as const;

function loadPresetCorpus(dir: string, origin: 'bundled' | 'user' = 'bundled') {
  return readdirSync(dir)
    .filter((file) => file.endsWith('.milk'))
    .sort()
    .map((file) => {
      const raw = readFileSync(join(dir, file), 'utf8');
      return {
        file,
        compiled: compileMilkdropPresetSource(raw, {
          id: basename(file, '.milk'),
          title: file,
          origin,
        }),
      };
    });
}

function loadBundledPresetCorpus() {
  return loadPresetCorpus(join(process.cwd(), 'public', 'milkdrop-presets'));
}

function loadLegacyFixtureCorpus() {
  return loadPresetCorpus(
    join(process.cwd(), 'tests', 'fixtures', 'milkdrop', 'legacy'),
    'user',
  );
}

describe('milkdrop bundled preset corpus', () => {
  test('keeps the bundled preset corpus fully supported on both backends in compat mode', () => {
    const corpus = loadBundledPresetCorpus();

    expect(corpus.length).toBe(30);

    const unexpected = corpus.filter(({ file, compiled }) => {
      const expectedWebgpuStatus = BUNDLED_WEBGPU_PARTIAL_PRESETS.includes(
        file as (typeof BUNDLED_WEBGPU_PARTIAL_PRESETS)[number],
      )
        ? 'partial'
        : 'supported';

      return (
        compiled.ir.compatibility.backends.webgl.status !== 'supported' ||
        compiled.ir.compatibility.backends.webgpu.status !==
          expectedWebgpuStatus
      );
    });

    expect(unexpected).toEqual([]);

    BUNDLED_WEBGPU_PARTIAL_PRESETS.forEach((file) => {
      const entry = corpus.find((preset) => preset.file === file);

      expect(entry).toBeDefined();
      expect(entry?.compiled.ir.compatibility.backends.webgl.status).toBe(
        'supported',
      );
      expect(entry?.compiled.ir.compatibility.backends.webgpu.status).toBe(
        'partial',
      );
      expect(entry?.compiled.ir.compatibility.parity.backendDivergence).toEqual(
        expect.arrayContaining([
          'status:webgl=supported,webgpu=partial',
          'webgpu:post-effects-gap:post-effects',
        ]),
      );
    });
  });
});

describe('milkdrop legacy fixture corpus', () => {
  test('stays available as a sanity-tier fixture corpus', () => {
    const corpus = loadLegacyFixtureCorpus();

    expect(corpus.length).toBe(5);

    corpus.forEach(({ compiled }) => {
      expect(compiled.title.length).toBeGreaterThan(0);
      expect(
        compiled.diagnostics.some((entry) => entry.severity === 'error'),
      ).toBe(false);
    });
  });
});
