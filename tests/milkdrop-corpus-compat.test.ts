import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';

const BUNDLED_PRESET_EXPECTATIONS = {
  'aurora-feedback-core.milk': { webgl: 'supported', webgpu: 'partial' },
  'eos-glowsticks-v2-03-music.milk': { webgl: 'partial', webgpu: 'partial' },
  'eos-phat-cubetrace-v2.milk': { webgl: 'partial', webgpu: 'partial' },
  'kinetic-grid-pulse.milk': { webgl: 'supported', webgpu: 'partial' },
  'krash-rovastar-cerebral-demons-stars.milk': {
    webgl: 'partial',
    webgpu: 'partial',
  },
  'low-motion-halo-drift.milk': { webgl: 'supported', webgpu: 'partial' },
  'prism-drum-tunnel.milk': { webgl: 'supported', webgpu: 'partial' },
  'rovastar-parallel-universe.milk': { webgl: 'partial', webgpu: 'partial' },
} as const;

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

    expect(corpus.length).toBe(8);

    const unexpected = corpus.filter(({ file, compiled }) => {
      const expectation =
        BUNDLED_PRESET_EXPECTATIONS[
          file as keyof typeof BUNDLED_PRESET_EXPECTATIONS
        ];

      return (
        !expectation ||
        compiled.ir.compatibility.backends.webgl.status !== expectation.webgl ||
        compiled.ir.compatibility.backends.webgpu.status !== expectation.webgpu
      );
    });

    expect(unexpected).toEqual([]);

    Object.entries(BUNDLED_PRESET_EXPECTATIONS).forEach(
      ([file, expectation]) => {
        const entry = corpus.find((preset) => preset.file === file);

        expect(entry).toBeDefined();
        expect(entry?.compiled.ir.compatibility.backends.webgl.status).toBe(
          expectation.webgl,
        );
        expect(entry?.compiled.ir.compatibility.backends.webgpu.status).toBe(
          expectation.webgpu,
        );
      },
    );
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
