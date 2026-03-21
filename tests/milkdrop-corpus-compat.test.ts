import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compileMilkdropPresetSource } from '../assets/js/milkdrop/compiler.ts';
import type { MilkdropFidelityClass } from '../assets/js/milkdrop/types.ts';

type CompatibilityStatus = 'supported' | 'partial' | 'unsupported';

type BundledPresetExpectation = {
  webgl: CompatibilityStatus;
  webgpu: CompatibilityStatus;
  forbiddenUnsupportedKeys?: readonly string[];
};

type ShapeCorpusExpectation = {
  diagnostics: readonly string[];
  webgl: CompatibilityStatus;
  webgpu: CompatibilityStatus;
  fidelityClass: MilkdropFidelityClass;
  unsupportedKeys: readonly string[];
  warnings: readonly string[];
  blockedConstructs: readonly string[];
  missingAliasesOrFunctions: readonly string[];
  customShapeCount: number;
};

const LOCAL_SHAPE_CORPUS_EXPECTATIONS: Record<string, ShapeCorpusExpectation> =
  {
    'shape-legacy-max-slot-orbit.milk': {
      diagnostics: [],
      webgl: 'supported',
      webgpu: 'supported',
      fidelityClass: 'exact',
      unsupportedKeys: [],
      warnings: [],
      blockedConstructs: [],
      missingAliasesOrFunctions: [],
      customShapeCount: 1,
    },
    'shape-projectm-dual-lattice.milk': {
      diagnostics: [],
      webgl: 'supported',
      webgpu: 'supported',
      fidelityClass: 'exact',
      unsupportedKeys: [],
      warnings: [],
      blockedConstructs: [],
      missingAliasesOrFunctions: [],
      customShapeCount: 2,
    },
  };

const BUNDLED_PRESET_EXPECTATIONS: Record<string, BundledPresetExpectation> = {
  'aurora-feedback-core.milk': { webgl: 'supported', webgpu: 'partial' },
  'eos-glowsticks-v2-03-music.milk': {
    webgl: 'partial',
    webgpu: 'partial',
    forbiddenUnsupportedKeys: [
      'mv_dx',
      'mv_dy',
      'mv_l',
      'nmotionvectorsx',
      'nmotionvectorsy',
    ],
  },
  'eos-phat-cubetrace-v2.milk': {
    webgl: 'partial',
    webgpu: 'partial',
    forbiddenUnsupportedKeys: [
      'mv_dx',
      'mv_dy',
      'mv_l',
      'nmotionvectorsx',
      'nmotionvectorsy',
    ],
  },
  'kinetic-grid-pulse.milk': { webgl: 'supported', webgpu: 'partial' },
  'krash-rovastar-cerebral-demons-stars.milk': {
    webgl: 'partial',
    webgpu: 'partial',
    forbiddenUnsupportedKeys: [
      'mv_dx',
      'mv_dy',
      'mv_l',
      'nmotionvectorsx',
      'nmotionvectorsy',
    ],
  },
  'low-motion-halo-drift.milk': { webgl: 'supported', webgpu: 'partial' },
  'prism-drum-tunnel.milk': { webgl: 'supported', webgpu: 'partial' },
  'rovastar-parallel-universe.milk': {
    webgl: 'partial',
    webgpu: 'partial',
    forbiddenUnsupportedKeys: [
      'mv_dx',
      'mv_dy',
      'mv_l',
      'nmotionvectorsx',
      'nmotionvectorsy',
    ],
  },
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

function loadLocalShapeFixtureCorpus() {
  return loadPresetCorpus(
    join(process.cwd(), 'tests', 'fixtures', 'milkdrop', 'local-shape-corpus'),
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
        expectation.forbiddenUnsupportedKeys?.forEach((key) => {
          expect(
            entry?.compiled.ir.compatibility.unsupportedKeys,
          ).not.toContain(key);
        });
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

describe('milkdrop local shape fixture corpus', () => {
  test('keeps dedicated custom-shape fixtures on stable compatibility metadata', () => {
    const corpus = loadLocalShapeFixtureCorpus();

    expect(corpus.length).toBe(2);
    expect(corpus.map(({ file }) => file)).toEqual(
      Object.keys(LOCAL_SHAPE_CORPUS_EXPECTATIONS),
    );

    corpus.forEach(({ file, compiled }) => {
      const expected = LOCAL_SHAPE_CORPUS_EXPECTATIONS[file];
      const actualDiagnosticCodes = compiled.diagnostics.map(
        (entry) => entry.code,
      );

      expect(expected).toBeDefined();
      expect(actualDiagnosticCodes).toEqual([...expected.diagnostics]);
      expect(compiled.ir.compatibility.backends.webgl.status).toBe(
        expected.webgl,
      );
      expect(compiled.ir.compatibility.backends.webgpu.status).toBe(
        expected.webgpu,
      );
      expect(compiled.ir.compatibility.parity.fidelityClass).toBe(
        expected.fidelityClass,
      );
      expect(compiled.ir.compatibility.unsupportedKeys).toEqual([
        ...expected.unsupportedKeys,
      ]);
      expect(compiled.ir.compatibility.warnings).toEqual([
        ...expected.warnings,
      ]);
      expect(compiled.ir.compatibility.parity.blockedConstructs).toEqual([
        ...expected.blockedConstructs,
      ]);
      expect(
        compiled.ir.compatibility.parity.missingAliasesOrFunctions,
      ).toEqual([...expected.missingAliasesOrFunctions]);
      expect(compiled.ir.customShapes).toHaveLength(expected.customShapeCount);
      compiled.ir.customShapes.forEach((shape) => {
        expect(shape.programs.init.sourceLines.length).toBeGreaterThan(0);
        expect(shape.programs.perFrame.sourceLines.length).toBeGreaterThan(0);
      });
    });
  });
});
