import { describe, expect, it } from 'bun:test';
import { mapRuntimeCatalogEntry } from '../../src/js/frontend/workspace-helpers.ts';
import type { MilkdropCatalogEntry } from '../../src/js/milkdrop/catalog-types.ts';

describe('catalog-projection-contract', () => {
  it('preserves all measured metadata, quality scores, and sensory profiles across projection', () => {
    const fixtureEntry = {
      id: 'test-preset-alpha',
      title: 'Test Preset Alpha',
      author: 'Test Author',
      authorUrl: 'https://example.com/author',
      origin: 'bundled',
      tags: ['audio-reactive', 'hypnotic'],
      isFavorite: true,
      rating: 5,
      historyIndex: 0,
      lastOpenedAt: 1700000000000,
      featuresUsed: ['per-frame-equations'],
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
      visualEvidenceTier: 'visual',
      fidelityTier: 'measured-visual',
      semanticSupport: {
        fidelityClass: 'exact',
        evidence: {
          compile: 'verified',
          runtime: 'smoke-tested',
          visual: 'reference-suite',
        },
        visualEvidenceTier: 'visual',
      },
      visualCertification: {
        status: 'certified',
        measured: true,
        source: 'reference-suite',
        fidelityClass: 'exact',
        visualEvidenceTier: 'visual',
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
        reasons: [],
      },
      evidence: {
        compile: 'verified',
        runtime: 'smoke-tested',
        visual: 'reference-suite',
      },
      certification: 'certified',
      corpusTier: 'certified',
      bundledFile: 'test-preset-alpha.milk',
      preview: true,
      similarity: {
        clusterId: 'cluster-42',
        duplicateOf: 'test-preset-prime',
      },
      quality: {
        score: 92,
        components: {
          fidelity: 1.0,
          measuredReactivity: 0.88,
          motion: 0.92,
        },
      },
      sensoryProfile: {
        flashRiskLevel: 'low',
        maxTransitionsPerSecondEstimate: 0,
        meanLuminance: 0.4,
        maxLuminanceDelta: 0.05,
        measuredAt: '2026-09-01T00:00:00.000Z',
      },
    } as unknown as MilkdropCatalogEntry;

    const row = mapRuntimeCatalogEntry(fixtureEntry);

    // Primary assertions: measured fields must survive
    expect(row.id).toBe(fixtureEntry.id);
    expect(row.title).toBe(fixtureEntry.title);
    expect(row.author).toBe(fixtureEntry.author);
    expect(row.file).toBe(fixtureEntry.bundledFile);
    expect(row.expectedFidelityClass).toBe(fixtureEntry.fidelityClass);

    // Quality metrics survival (the field that previously vanished)
    expect(row.quality).toBeDefined();
    expect(row.quality?.score).toBe(92);
    expect(row.quality?.components?.measuredReactivity).toBe(0.88);

    // Sensory profile survival (the photosensitivity warning field that previously vanished)
    expect(row.sensoryProfile).toBeDefined();
    expect(row.sensoryProfile?.flashRiskLevel).toBe('low');
    expect(row.sensoryProfile?.maxTransitionsPerSecondEstimate).toBe(0);

    // Certification & fidelity metadata survival
    expect(row.similarity?.clusterId).toBe('cluster-42');
    expect(row.visualCertification?.status).toBe('certified');
    expect(row.fidelityTier).toBe('measured-visual');

    // Backend support normalization
    expect(row.supports?.webgl).toBe(true);
    expect(row.supports?.webgpu).toBe(true);
  });
});
