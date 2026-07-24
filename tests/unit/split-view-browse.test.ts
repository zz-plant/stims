import { describe, expect, test } from 'bun:test';

import type { PresetCatalogEntry } from '../../src/js/frontend/contracts.ts';
import {
  describePresetMood,
  getFeaturedCollectionTags,
  getPresetCardSupportLabel,
  matchesPreset,
  prettifyCollectionTag,
} from '../../src/js/frontend/workspace-helpers.ts';

function makePreset(
  overrides: Partial<PresetCatalogEntry> = {},
): PresetCatalogEntry {
  return {
    id: 'test-id',
    title: 'Test Preset',
    author: 'Test Author',
    tags: [],
    ...overrides,
  };
}

describe('describePresetMood', () => {
  test('returns "Bright pulse" for glow/sun/flare/star/light/bloom keywords', () => {
    expect(
      describePresetMood(
        makePreset({ id: '1', title: 'Sun Flare', tags: ['glow'] }),
      ),
    ).toBe('Bright pulse');
    expect(
      describePresetMood(makePreset({ id: '2', title: 'Star Bloom' })),
    ).toBe('Bright pulse');
  });

  test('returns "Sharp geometry" for cube/matrix/square/line/grid/trace', () => {
    expect(
      describePresetMood(makePreset({ id: '3', title: 'Grid Trace' })),
    ).toBe('Sharp geometry');
  });

  test('returns "Classic rush" for collection:classic-milkdrop tag', () => {
    expect(
      describePresetMood(
        makePreset({
          id: '4',
          title: 'Old School',
          tags: ['collection:classic-milkdrop'],
        }),
      ),
    ).toBe('Classic rush');
  });

  test('returns "Instant pick" when no keywords match', () => {
    expect(
      describePresetMood(makePreset({ id: '5', title: 'Generic Preset' })),
    ).toBe('Instant pick');
  });

  test('does not match keywords buried inside an author name', () => {
    // "star" lives inside the prolific author "Rovastar"; the mood should come
    // from the descriptive title ("Parallel" -> Space drift), not the author.
    expect(
      describePresetMood(
        makePreset({
          id: 'rovastar-parallel-universe',
          title: 'Rovastar - Parallel Universe',
          author: 'Rovastar',
        }),
      ),
    ).toBe('Space drift');
    // A real standalone "Star" word still classifies as Bright pulse.
    expect(
      describePresetMood(
        makePreset({
          id: 'rovastar-star-of-destiny',
          title: 'Rovastar - Star Of Destiny',
          author: 'Rovastar',
        }),
      ),
    ).toBe('Bright pulse');
  });
});

describe('getPresetCardSupportLabel', () => {
  test('returns null for "Smooth playback" (default label)', () => {
    expect(
      getPresetCardSupportLabel(makePreset({ id: '1', title: 'Basic Preset' })),
    ).toBeNull();
  });

  test('returns label string for non-default fidelity entries', () => {
    const entry = makePreset({
      id: '2',
      title: 'Certified Preset',
      fidelityTier: 'measured-visual',
      visualCertification: {
        status: 'certified',
        measured: true,
        source: 'reference-suite',
        fidelityClass: 'exact',
        visualEvidenceTier: 'visual',
        requiredBackend: null,
        actualBackend: null,
        reasons: [],
      },
      expectedFidelityClass: 'exact',
    });
    expect(getPresetCardSupportLabel(entry)).toBe('Measured parity');
  });

  test('returns "Parsed (not measured)" for semantic-only tier', () => {
    const entry = makePreset({
      id: '3',
      title: 'Semantic Only',
      fidelityTier: 'semantic-only',
    });
    expect(getPresetCardSupportLabel(entry)).toBe('Parsed (not measured)');
  });
});

describe('matchesPreset and collection tags', () => {
  const creamPreset = makePreset({
    id: 'eos-ether',
    title: 'Eo.S. - Ether',
    author: 'Eo.S.',
    tags: ['collection:cream-of-the-crop', 'liquid', 'reaction'],
  });

  test('matches cream of the crop search query with spaces or hyphens', () => {
    expect(matchesPreset(creamPreset, 'cream of the crop')).toBe(true);
    expect(matchesPreset(creamPreset, 'cream-of-the-crop')).toBe(true);
    expect(matchesPreset(creamPreset, 'cream')).toBe(true);
    expect(matchesPreset(creamPreset, 'ether')).toBe(true);
    expect(matchesPreset(creamPreset, 'eos')).toBe(true);
  });

  test('prettifies cream-of-the-crop collection tag properly', () => {
    expect(prettifyCollectionTag('collection:cream-of-the-crop')).toBe(
      'Cream of the Crop',
    );
  });

  test('includes collection:cream-of-the-crop in featured collection tags', () => {
    const tags = [
      'collection:classic-milkdrop',
      'collection:cream-of-the-crop',
      'collection:rovastar-and-collaborators',
    ];
    expect(getFeaturedCollectionTags(tags)).toContain(
      'collection:cream-of-the-crop',
    );
  });
});
