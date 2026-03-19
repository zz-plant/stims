import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import type { MilkdropParityAllowlistEntry } from '../assets/js/milkdrop/types.ts';

type ParityCorpusManifest = {
  minimumPresetCount: number;
  presetCount: number;
  presets: Array<{
    id: string;
    title: string;
    file: string;
    strata: string[];
    allowlisted?: boolean;
  }>;
  canonicalVisualSuite: string[];
};

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

function loadParityManifest() {
  return JSON.parse(
    readFileSync(
      join(
        process.cwd(),
        'assets',
        'data',
        'milkdrop-parity',
        'corpus-manifest.json',
      ),
      'utf8',
    ),
  ) as ParityCorpusManifest;
}

function loadParityAllowlist() {
  return (
    (
      JSON.parse(
        readFileSync(
          join(
            process.cwd(),
            'assets',
            'data',
            'milkdrop-parity',
            'allowlist.json',
          ),
          'utf8',
        ),
      ) as { entries?: MilkdropParityAllowlistEntry[] }
    ).entries ?? []
  );
}

describe('milkdrop bundled preset corpus', () => {
  test('keeps the bundled preset corpus fully supported on both backends in compat mode', () => {
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
});

describe('milkdrop legacy fixture corpus', () => {
  test('stays available as a sanity tier rather than parity evidence', () => {
    const corpus = loadLegacyFixtureCorpus();

    expect(corpus.length).toBe(5);

    corpus.forEach(({ compiled }) => {
      expect(compiled.title.length).toBeGreaterThan(0);
      expect(
        compiled.diagnostics.some((entry) => entry.severity === 'error'),
      ).toBe(false);
    });
  });

  test('remains too small to count as parity evidence', () => {
    const corpus = loadLegacyFixtureCorpus();
    const manifest = loadParityManifest();

    expect(corpus.length).toBeLessThan(manifest.minimumPresetCount);
  });
});

describe('milkdrop parity corpus', () => {
  test('vendors at least 100 presets with the required stratification and a 20-preset visual suite manifest', () => {
    const manifest = loadParityManifest();
    const strata = new Set(manifest.presets.flatMap((entry) => entry.strata));

    expect(manifest.presetCount).toBe(manifest.presets.length);
    expect(manifest.presets.length).toBeGreaterThanOrEqual(
      manifest.minimumPresetCount,
    );
    expect(manifest.canonicalVisualSuite).toHaveLength(20);

    [
      'feedback',
      'per-pixel',
      'custom-wave',
      'custom-shape',
      'video-echo',
      'motion-vectors',
      'borders',
      'registers',
      'shader-supported',
    ].forEach((required) => {
      expect(strata.has(required)).toBe(true);
    });
  });

  test('compiles the vendored parity corpus with no unallowlisted blocked constructs in parity mode', () => {
    const manifest = loadParityManifest();
    const allowlist = loadParityAllowlist();
    const corpusDir = join(
      process.cwd(),
      'tests',
      'fixtures',
      'milkdrop',
      'parity-corpus',
    );

    const failures = manifest.presets.flatMap((entry) => {
      const raw = readFileSync(join(corpusDir, entry.file), 'utf8');
      const compiled = compileMilkdropPresetSource(
        raw,
        {
          id: entry.id,
          title: entry.title,
          origin: 'user',
        },
        {
          fidelityMode: 'parity',
          parityAllowlist: allowlist,
        },
      );
      const uncoveredConstructs =
        compiled.ir.compatibility.parity.blockedConstructs.filter(
          (blockedConstruct) => {
            return !compiled.ir.compatibility.parity.allowlistedBlockedConstructs.includes(
              blockedConstruct,
            );
          },
        );

      return uncoveredConstructs.length > 0
        ? [
            {
              id: entry.id,
              uncoveredConstructs,
            },
          ]
        : [];
    });

    expect(failures).toEqual([]);
  });
});
