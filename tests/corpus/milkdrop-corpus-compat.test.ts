import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { compileMilkdropPresetSource } from '../../assets/js/milkdrop/compiler.ts';
import type { MilkdropFidelityClass } from '../../assets/js/milkdrop/types.ts';

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
  'eos-glowsticks-v2-03-music.milk': {
    webgl: 'supported',
    webgpu: 'supported',
    forbiddenUnsupportedKeys: [
      'mv_dx',
      'mv_dy',
      'mv_l',
      'nmotionvectorsx',
      'nmotionvectorsy',
    ],
  },
  'eos-phat-cubetrace-v2.milk': {
    webgl: 'supported',
    webgpu: 'supported',
    forbiddenUnsupportedKeys: [
      'mv_dx',
      'mv_dy',
      'mv_l',
      'nmotionvectorsx',
      'nmotionvectorsy',
    ],
  },
  'krash-rovastar-cerebral-demons-stars.milk': {
    webgl: 'supported',
    webgpu: 'supported',
    forbiddenUnsupportedKeys: [
      'mv_dx',
      'mv_dy',
      'mv_l',
      'nmotionvectorsx',
      'nmotionvectorsy',
    ],
  },
  'rovastar-parallel-universe.milk': {
    webgl: 'supported',
    webgpu: 'supported',
    forbiddenUnsupportedKeys: [
      'mv_dx',
      'mv_dy',
      'mv_l',
      'nmotionvectorsx',
      'nmotionvectorsy',
    ],
  },
  'eos-heater-core-c.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'aderrasi-potion-of-spirits.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'geiss-casino.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'orb-radiation.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'eos-apocalypse.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },

  'dbleja-hovering-over-mars.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'dbleja-hovering-over-pluto.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'dbleja-inside-the-tree-blue-mix.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'eos-dark-side-of-the-moon-clean-mix.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'eos-ether-posession-phat-edit-v3.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'eos-ether.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'eos-matrix-cube-c.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'eos-phat-cat-scan-nirvana.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'eos-phat-dark-heart.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'eos-phat-linear-clouds-v2.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'eos-phat-magnetosphere-13-pulsar.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'eos-phat-vacuum-deification.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'eos-quasar.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'eos-starburst-05-phasing.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'evet-proteus-core-element-5.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'evet-responsive-acid-iris.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'geiss-bipolar-x.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'geiss-happy-drops.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'orb-acid-in-my-eyes.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'orb-cloud-scope.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'orbasonic.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'pieturp-sunflare.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'rovastar-and-idiot24-7-abstract-psychaos.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'rovastar-dark-ritual-star-of-destiny-denied-mix.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'rovastar-harlequins-liquid-dragon.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'rovastar-mosaics-of-ages.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'rovastar-oozing-resistance.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'shifter-curlique.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'shifter-glassworms-flare.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'shifter-snakeskin.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'shifter-spectro.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'shifter-swarm.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'phat-rovastar-eos-square-faces-v2.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
  'phat-zylot-eos-trippy-rotation.milk': {
    webgl: 'supported',
    webgpu: 'supported',
  },
};

const PARITY_CORPUS_EXPECTATIONS: Record<string, ShapeCorpusExpectation> = {
  'parity-per-pixel-03.milk': {
    diagnostics: [],
    webgl: 'supported',
    webgpu: 'supported',
    fidelityClass: 'exact',
    unsupportedKeys: [],
    warnings: [],
    blockedConstructs: [],
    missingAliasesOrFunctions: [],
    customShapeCount: 0,
  },
  'parity-motion-04.milk': {
    diagnostics: [],
    webgl: 'supported',
    webgpu: 'supported',
    fidelityClass: 'exact',
    unsupportedKeys: [],
    warnings: [],
    blockedConstructs: [],
    missingAliasesOrFunctions: [],
    customShapeCount: 0,
  },
  'parity-wave-02.milk': {
    diagnostics: [],
    webgl: 'supported',
    webgpu: 'supported',
    fidelityClass: 'exact',
    unsupportedKeys: [],
    warnings: [],
    blockedConstructs: [],
    missingAliasesOrFunctions: [],
    customShapeCount: 0,
  },
  'parity-shape-07.milk': {
    diagnostics: [],
    webgl: 'supported',
    webgpu: 'supported',
    fidelityClass: 'exact',
    unsupportedKeys: [],
    warnings: [],
    blockedConstructs: [],
    missingAliasesOrFunctions: [],
    customShapeCount: 0,
  },
  'parity-registers-05.milk': {
    diagnostics: [],
    webgl: 'supported',
    webgpu: 'supported',
    fidelityClass: 'exact',
    unsupportedKeys: [],
    warnings: [],
    blockedConstructs: [],
    missingAliasesOrFunctions: [],
    customShapeCount: 0,
  },
  'parity-hybrid-09.milk': {
    diagnostics: [],
    webgl: 'supported',
    webgpu: 'supported',
    fidelityClass: 'exact',
    unsupportedKeys: [],
    warnings: [],
    blockedConstructs: [],
    missingAliasesOrFunctions: [],
    customShapeCount: 0,
  },
  'parity-feedback-orientation-01.milk': {
    diagnostics: [],
    webgl: 'supported',
    webgpu: 'supported',
    fidelityClass: 'exact',
    unsupportedKeys: [],
    warnings: [],
    blockedConstructs: [],
    missingAliasesOrFunctions: [],
    customShapeCount: 0,
  },
  'parity-shader-08.milk': {
    diagnostics: [],
    webgl: 'supported',
    webgpu: 'supported',
    fidelityClass: 'exact',
    unsupportedKeys: [],
    warnings: [],
    blockedConstructs: [],
    missingAliasesOrFunctions: [],
    customShapeCount: 0,
  },
  'parity-legacy-wave-01.milk': {
    diagnostics: [],
    webgl: 'supported',
    webgpu: 'supported',
    fidelityClass: 'exact',
    unsupportedKeys: [],
    warnings: [],
    blockedConstructs: [],
    missingAliasesOrFunctions: [],
    customShapeCount: 0,
  },
  'parity-legacy-shape-01.milk': {
    diagnostics: [],
    webgl: 'supported',
    webgpu: 'supported',
    fidelityClass: 'exact',
    unsupportedKeys: [],
    warnings: [],
    blockedConstructs: [],
    missingAliasesOrFunctions: [],
    customShapeCount: 0,
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

function loadParityCorpus() {
  return loadPresetCorpus(
    join(process.cwd(), 'tests', 'fixtures', 'milkdrop', 'parity-corpus'),
    'user',
  );
}

function loadProjectmUpstreamCorpus() {
  return loadPresetCorpus(
    join(process.cwd(), 'tests', 'fixtures', 'milkdrop', 'projectm-upstream'),
    'user',
  );
}

describe('milkdrop bundled preset corpus', () => {
  test('keeps the bundled preset corpus fully supported on both backends in compat mode', () => {
    const corpus = loadBundledPresetCorpus();

    expect(corpus.length).toBe(43);

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
        expect(
          entry?.compiled.ir.compatibility.gpuDescriptorPlans.webgpu.routing,
        ).toBe(
          entry?.compiled.ir.compatibility.gpuDescriptorPlans.webgpu.feedback
            ?.fallbackToLegacyFeedback
            ? 'fallback-webgl'
            : 'descriptor-plan',
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
      expect(compiled.ir.compatibility.gpuDescriptorPlans.webgpu).toEqual(
        expect.objectContaining({
          routing: 'descriptor-plan',
          unsupported: [],
        }),
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

  describe('milkdrop parity corpus', () => {
    test('keeps parity-corpus fixtures on stable compatibility metadata', () => {
      const corpus = loadParityCorpus();

      const certified = corpus.filter(({ file }) =>
        Object.keys(PARITY_CORPUS_EXPECTATIONS).includes(file),
      );

      expect(certified.length).toBeGreaterThanOrEqual(10);

      certified.forEach(({ file, compiled }) => {
        const expected = PARITY_CORPUS_EXPECTATIONS[file];
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
      });

      const uncertified = corpus.filter(
        ({ file }) => !Object.keys(PARITY_CORPUS_EXPECTATIONS).includes(file),
      );

      uncertified.forEach(({ compiled }) => {
        expect(
          compiled.diagnostics.filter((d) => d.severity === 'error').length,
        ).toBe(0);
      });
    });
  });

  describe('milkdrop projectM upstream fixture corpus', () => {
    test('stays available as a sanity-tier fixture corpus', () => {
      const corpus = loadProjectmUpstreamCorpus();

      expect(corpus.length).toBeGreaterThanOrEqual(6);

      corpus.forEach(({ compiled }) => {
        expect(compiled.title.length).toBeGreaterThan(0);
        expect(
          compiled.diagnostics.some((entry) => entry.severity === 'error'),
        ).toBe(false);
      });
    });
  });
});
