import { describe, expect, test } from 'bun:test';
import {
  resolvePresetCatalogEntry,
  resolvePresetId,
} from '../../src/js/milkdrop/preset-id-resolution.ts';

const catalog = [
  {
    id: 'rovastar-parallel-universe',
    title: 'Rovastar - Parallel Universe',
    file: '/milkdrop-presets/rovastar-parallel-universe.milk',
  },
  {
    id: 'eos-glowsticks-v2-03-music',
    title: 'Eo.S. - Glowsticks v2 03 Music',
    file: '/milkdrop-presets/eos-glowsticks-v2-03-music.milk',
  },
] as const;

describe('preset id resolution', () => {
  test('matches preset ids case-insensitively', () => {
    expect(resolvePresetId(catalog, 'ROVASTAR-PARALLEL-UNIVERSE')).toBe(
      'rovastar-parallel-universe',
    );
  });

  test('matches human-readable preset titles via a safe slug alias', () => {
    expect(resolvePresetId(catalog, 'Rovastar / Parallel Universe')).toBe(
      'rovastar-parallel-universe',
    );
  });

  test('matches bundled preset file aliases and paths', () => {
    expect(
      resolvePresetCatalogEntry(
        catalog,
        '/milkdrop-presets/eos-glowsticks-v2-03-music.milk',
      )?.id,
    ).toBe('eos-glowsticks-v2-03-music');
    expect(resolvePresetId(catalog, 'eos-glowsticks-v2-03-music.milk')).toBe(
      'eos-glowsticks-v2-03-music',
    );
  });

  test('maps legacy public preset aliases onto shipped presets', () => {
    expect(resolvePresetId(catalog, 'signal-bloom')).toBe(
      'eos-glowsticks-v2-03-music',
    );
  });

  test('returns null when a slug alias is ambiguous', () => {
    const ambiguousCatalog = [
      ...catalog,
      {
        id: 'rovastar-parallel_universe',
        title: 'Rovastar Parallel Universe',
      },
    ];

    expect(
      resolvePresetCatalogEntry(
        ambiguousCatalog,
        'Rovastar / Parallel Universe',
      ),
    ).toBeNull();
  });

  // Why use-preset-route-sync falls back to the engine's own activePresetId
  // instead of treating a null here as "do not publish": the runtime catalog
  // hydrates lazily, so a session that never opens Browse resolves every id
  // against an empty array. Gating the engine -> URL sync on this made the
  // address bar silently stop tracking the engine in exactly those sessions.
  test('cannot resolve anything against an empty catalog', () => {
    expect(resolvePresetId([], 'geiss-casino')).toBeNull();
    expect(resolvePresetCatalogEntry([], 'geiss-casino')).toBeNull();
  });
});
