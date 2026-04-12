import { describe, expect, test } from 'bun:test';
import {
  resolvePresetCatalogEntry,
  resolvePresetId,
} from '../assets/js/milkdrop/preset-id-resolution.ts';

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
});
