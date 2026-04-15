import { describe, expect, test } from 'bun:test';
import type { PresetCatalogEntry } from '../assets/js/frontend/contracts.ts';
import {
  formatPresetSupportLabel,
  formatPresetSupportNote,
  mapRuntimeCatalogEntry,
  mergeCatalogActivity,
  pickFavoritePresets,
  pickRecentPresets,
} from '../assets/js/frontend/workspace-helpers.ts';
import type { MilkdropCatalogEntry } from '../assets/js/milkdrop/types.ts';

function createEntry(
  id: string,
  title: string,
  overrides: Partial<PresetCatalogEntry> = {},
): PresetCatalogEntry {
  return {
    id,
    title,
    author: 'Stims',
    tags: [],
    ...overrides,
  };
}

describe('workspace activity helpers', () => {
  test('merges favorite and recent metadata onto the base catalog', () => {
    const merged = mergeCatalogActivity(
      [
        createEntry('signal-bloom', 'Signal Bloom'),
        createEntry('night-drive', 'Night Drive'),
      ],
      [
        createEntry('signal-bloom', 'Signal Bloom', {
          isFavorite: true,
          historyIndex: 0,
          lastOpenedAt: 30,
        }),
        createEntry('custom-echo', 'Custom Echo', {
          isFavorite: true,
          lastOpenedAt: 10,
        }),
      ],
    );

    expect(merged).toEqual([
      expect.objectContaining({
        id: 'signal-bloom',
        isFavorite: true,
        historyIndex: 0,
        lastOpenedAt: 30,
      }),
      expect.objectContaining({
        id: 'night-drive',
      }),
      expect.objectContaining({
        id: 'custom-echo',
        isFavorite: true,
      }),
    ]);
  });

  test('sorts recent presets by history position first', () => {
    const recent = pickRecentPresets([
      createEntry('negative', 'Negative', {
        historyIndex: -1,
        lastOpenedAt: 99,
      }),
      createEntry('third', 'Third', { historyIndex: 2, lastOpenedAt: 20 }),
      createEntry('first', 'First', { historyIndex: 0, lastOpenedAt: 10 }),
      createEntry('second', 'Second', { historyIndex: 1, lastOpenedAt: 30 }),
      createEntry('ignored', 'Ignored'),
    ]);

    expect(recent.map((entry) => entry.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  test('sorts favorite presets by recency and fallback title order', () => {
    const favorites = pickFavoritePresets([
      createEntry('gamma', 'Gamma', { isFavorite: true, lastOpenedAt: 20 }),
      createEntry('beta', 'Beta', { isFavorite: true, lastOpenedAt: 20 }),
      createEntry('alpha', 'Alpha', { isFavorite: true, lastOpenedAt: 40 }),
      createEntry('plain', 'Plain'),
    ]);

    expect(favorites.map((entry) => entry.id)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  test('prefers measured and runtime-only WebGPU messaging over optimistic fidelity copy', () => {
    const runtimeOnly = createEntry('runtime-only', 'Runtime Only', {
      expectedFidelityClass: 'exact',
      supports: { webgpu: true },
      visualCertification: {
        status: 'uncertified',
        measured: false,
        source: 'inferred',
        fidelityClass: 'partial',
        visualEvidenceTier: 'runtime',
        requiredBackend: 'webgpu',
        actualBackend: null,
        reasons: ['No measured WebGPU reference capture is recorded yet.'],
      },
    });
    const measured = createEntry('measured', 'Measured', {
      expectedFidelityClass: 'near-exact',
      supports: { webgpu: true },
      visualCertification: {
        status: 'certified',
        measured: true,
        source: 'reference-suite',
        fidelityClass: 'near-exact',
        visualEvidenceTier: 'visual',
        requiredBackend: 'webgpu',
        actualBackend: 'webgpu',
        reasons: [],
      },
    });

    expect(formatPresetSupportLabel(runtimeOnly)).toBe('Runtime checked');
    expect(formatPresetSupportNote(runtimeOnly)).toBe(
      'Runs on WebGPU, but measured parity is still pending.',
    );
    expect(formatPresetSupportLabel(measured)).toBe('Measured parity');
    expect(formatPresetSupportNote(measured)).toBe(
      'Measured against the reference render on WebGPU.',
    );
  });

  test('keeps visual certification metadata when mapping runtime catalog entries', () => {
    const runtimeEntry = {
      id: 'noise-pass',
      title: 'Noise Pass',
      author: 'Stims',
      bundledFile: '/milkdrop-presets/noise-pass.milk',
      tags: ['feedback'],
      isFavorite: false,
      historyIndex: 0,
      lastOpenedAt: 12,
      fidelityClass: 'partial',
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
      visualCertification: {
        status: 'uncertified',
        measured: false,
        source: 'inferred',
        fidelityClass: 'partial',
        visualEvidenceTier: 'runtime',
        requiredBackend: 'webgpu',
        actualBackend: null,
        reasons: ['No measured WebGPU reference capture is recorded yet.'],
      },
    } as unknown as MilkdropCatalogEntry;

    expect(mapRuntimeCatalogEntry(runtimeEntry)).toEqual(
      expect.objectContaining({
        expectedFidelityClass: 'partial',
        visualCertification: runtimeEntry.visualCertification,
        supports: { webgl: true, webgpu: true },
      }),
    );
  });
});
