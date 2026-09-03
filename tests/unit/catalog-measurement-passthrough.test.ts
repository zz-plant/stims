import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapRuntimeCatalogEntry } from '../../src/js/frontend/workspace-helpers.ts';
import type { MilkdropCatalogEntry } from '../../src/js/milkdrop/catalog-types.ts';

/**
 * Catalog-projection contract: every measured field on a catalog entry must
 * survive the four hand-listed projections between catalog.json and a rendered
 * row: the fetch-boundary mapper in catalog-bundled-pipeline, the two entry
 * builders in catalog-store-projection, and mapRuntimeCatalogEntry here.
 *
 * Each layer constructs a fresh object instead of spreading, so a field
 * missing from any single layer vanishes with no type error and no test
 * failure — which is exactly how the reactivity band shipped reading a field
 * that never reached it.
 *
 * If a new measurement or compatibility field is added to the catalog, add a
 * survival assertion here, or it will silently never arrive at the browse row.
 */

const PRESETS_DIR = join(
  import.meta.dir,
  '..',
  '..',
  'public',
  'milkdrop-presets',
);

function readJson(name: string) {
  return JSON.parse(readFileSync(join(PRESETS_DIR, name), 'utf8')) as {
    presets: Array<Record<string, unknown>>;
  };
}

const FULL_FIXTURE: MilkdropCatalogEntry = {
  id: 'test-preset',
  title: 'Test Preset',
  author: 'Test Author',
  authorUrl: 'https://example.com',
  derivedFrom: [{ id: 'original', title: 'Original' }],
  origin: 'bundled',
  tags: ['test', 'fixture'],
  curatedRank: 42,
  similarity: { clusterId: 'cluster-1', duplicateOf: 'other-preset' },
  isFavorite: true,
  rating: 4,
  lastOpenedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  historyIndex: 3,
  featuresUsed: ['motion-vectors'],
  warnings: [],
  supports: {
    webgl: {
      status: 'supported',
      reasons: [],
      evidence: [],
      requiredFeatures: [],
      unsupportedFeatures: [],
    },
    webgpu: {
      status: 'supported',
      reasons: [],
      evidence: [],
      requiredFeatures: [],
      unsupportedFeatures: [],
    },
  },
  fidelityClass: 'exact',
  fidelityTier: 'measured-visual',
  visualEvidenceTier: 'measured',
  semanticSupport: {
    fidelityClass: 'exact',
    evidence: { compile: 'confirmed', runtime: 'confirmed' },
  },
  visualCertification: {
    fidelityClass: 'exact',
    visualEvidenceTier: 'measured',
    measured: true,
  },
  evidence: {
    compile: 'confirmed',
    runtime: 'confirmed',
    source: 'test',
  },
  certification: 'certified',
  corpusTier: 'bundled',
  parity: {
    semanticSupport: {
      fidelityClass: 'exact',
      evidence: { compile: 'confirmed', runtime: 'confirmed' },
    },
    visualCertification: {
      fidelityClass: 'exact',
      visualEvidenceTier: 'measured',
      measured: true,
    },
    evidence: { compile: 'confirmed', runtime: 'confirmed', source: 'test' },
  },
  quality: {
    score: 0.75,
    components: {
      fidelity: 0.9,
      evidence: 0.8,
      measuredReactivity: 0.87,
    },
  },
  sensoryProfile: {
    flashRiskLevel: 'high',
    maxTransitionsPerSecondEstimate: 5,
    meanLuminance: 0.4,
    maxLuminanceDelta: 0.2,
    measuredAt: '2026-08-19T00:00:00.000Z',
  },
  preview: false,
} as unknown as MilkdropCatalogEntry;

describe('mapRuntimeCatalogEntry field-survival contract', () => {
  test('quality scores survive the projection', () => {
    const mapped = mapRuntimeCatalogEntry(FULL_FIXTURE);
    expect(mapped.quality?.score).toBe(0.75);
    expect(mapped.quality?.components?.measuredReactivity).toBe(0.87);
  });

  test('the sensory profile (reactivity band + flash warning) survives', () => {
    const mapped = mapRuntimeCatalogEntry(FULL_FIXTURE);
    expect(mapped.sensoryProfile?.flashRiskLevel).toBe('high');
    expect(mapped.sensoryProfile?.maxTransitionsPerSecondEstimate).toBe(5);
    expect(mapped.sensoryProfile?.meanLuminance).toBe(0.4);
  });

  test('visual certification survives', () => {
    const mapped = mapRuntimeCatalogEntry(FULL_FIXTURE);
    expect(mapped.visualCertification?.fidelityClass).toBe('exact');
    expect(mapped.visualCertification?.measured).toBe(true);
  });

  test('similarity (dedup cluster) survives', () => {
    const mapped = mapRuntimeCatalogEntry(FULL_FIXTURE);
    expect(mapped.similarity?.clusterId).toBe('cluster-1');
    expect(mapped.similarity?.duplicateOf).toBe('other-preset');
  });

  test('fidelity tier survives', () => {
    const mapped = mapRuntimeCatalogEntry(FULL_FIXTURE);
    expect(mapped.fidelityTier).toBe('measured-visual');
  });

  test('expected fidelity class (legacy shell alias for fidelityClass) survives', () => {
    const mapped = mapRuntimeCatalogEntry(FULL_FIXTURE);
    expect(mapped.expectedFidelityClass).toBe('exact');
  });

  test('supports (boolean-derived from status-object) is carried', () => {
    const mapped = mapRuntimeCatalogEntry(FULL_FIXTURE);
    expect(mapped.supports?.webgl).toBe(true);
    expect(mapped.supports?.webgpu).toBe(true);
  });

  test('all identity and metadata fields survive', () => {
    const mapped = mapRuntimeCatalogEntry(FULL_FIXTURE);
    expect(mapped.id).toBe('test-preset');
    expect(mapped.title).toBe('Test Preset');
    expect(mapped.author).toBe('Test Author');
    expect(mapped.authorUrl).toBe('https://example.com');
    expect(mapped.tags).toEqual(['test', 'fixture']);
    expect(mapped.isFavorite).toBe(true);
    expect(mapped.rating).toBe(4);
    expect(mapped.historyIndex).toBe(3);
    expect(mapped.lastOpenedAt).toBe(1_700_000_000_000);
  });
});

describe('the shipped catalogs actually carry the fields', () => {
  test('starter-catalog.json carries reactivity for every preset', () => {
    const starter = readJson('starter-catalog.json');
    const measured = starter.presets.filter((p) => {
      const q = p.quality as
        | { components?: { measuredReactivity?: number | null } }
        | undefined;
      return typeof q?.components?.measuredReactivity === 'number';
    });
    expect(starter.presets.length).toBeGreaterThan(0);
    expect(measured.length).toBe(starter.presets.length);
  });

  test('catalog.json exposes the measurement path at all', () => {
    const catalog = readJson('catalog.json');
    const withQuality = catalog.presets.filter((p) => p.quality);
    expect(withQuality.length).toBeGreaterThan(0);
  });
});
