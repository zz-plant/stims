import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';

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
  test('keeps the bundled preset corpus fully supported on both backends', () => {
    const corpus = loadBundledPresetCorpus();

    expect(corpus.length).toBe(30);

    const unsupported = corpus.filter(({ compiled }) => {
      return (
        compiled.ir.compatibility.backends.webgl.status !== 'supported' ||
        compiled.ir.compatibility.backends.webgpu.status !== 'supported'
      );
    });

    expect(unsupported).toEqual([]);
  });

  test('keeps the feedback-heavy curated presets in the supported bucket', () => {
    const corpus = loadBundledPresetCorpus();
    const targets = [
      'aurora-feedback-core.milk',
      'kinetic-grid-pulse.milk',
      'low-motion-halo-drift.milk',
      'prism-drum-tunnel.milk',
    ];

    const selected = corpus.filter(({ file }) => targets.includes(file));
    expect(selected).toHaveLength(targets.length);

    selected.forEach(({ compiled }) => {
      expect(compiled.ir.compatibility.backends.webgl.status).toBe('supported');
      expect(compiled.ir.compatibility.backends.webgpu.status).toBe(
        'supported',
      );
      expect(compiled.ir.compatibility.unsupportedKeys).toEqual([]);
      expect(compiled.ir.compatibility.blockingReasons).toEqual([]);
    });
  });
});

describe('milkdrop legacy fixture corpus', () => {
  test('tracks the harder legacy fixture tier by support class', () => {
    const corpus = loadLegacyFixtureCorpus();

    expect(corpus.length).toBe(5);

    const expected = {
      'legacy-partial-extra-custom-shape.milk': {
        webgl: 'partial',
        webgpu: 'partial',
      },
      'legacy-partial-extra-custom-wave.milk': {
        webgl: 'partial',
        webgpu: 'partial',
      },
      'legacy-supported-feedback-subset.milk': {
        webgl: 'supported',
        webgpu: 'supported',
      },
      'legacy-supported-transform-color-subset.milk': {
        webgl: 'supported',
        webgpu: 'supported',
      },
      'legacy-unsupported-full-shader-code.milk': {
        webgl: 'supported',
        webgpu: 'supported',
      },
    } as const;

    corpus.forEach(({ file, compiled }) => {
      const expectedSupport = expected[file as keyof typeof expected];
      expect(expectedSupport).toBeDefined();
      expect(compiled.ir.compatibility.backends.webgl.status).toBe(
        expectedSupport.webgl,
      );
      expect(compiled.ir.compatibility.backends.webgpu.status).toBe(
        expectedSupport.webgpu,
      );
    });
  });

  test('keeps the harder legacy fixture tier split across supported and partial', () => {
    const corpus = loadLegacyFixtureCorpus();
    const stats = {
      supported: 0,
      partial: 0,
      unsupported: 0,
    };

    corpus.forEach(({ compiled }) => {
      stats[compiled.ir.compatibility.backends.webgl.status] += 1;
    });

    expect(stats).toEqual({
      supported: 3,
      partial: 2,
      unsupported: 0,
    });
  });
});
