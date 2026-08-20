import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapRuntimeCatalogEntry } from '../../src/js/frontend/workspace-helpers.ts';
import type { MilkdropCatalogEntry } from '../../src/js/milkdrop/catalog-types.ts';

/**
 * Lab measurements have to survive four hand-listed projections between
 * catalog.json and a rendered row: the fetch-boundary mapper in
 * catalog-bundled-pipeline, the two entry builders in
 * catalog-store-projection, and mapRuntimeCatalogEntry here.
 *
 * Every one of them constructs a fresh object instead of spreading, so a
 * field missing from any single layer vanishes with no type error and no test
 * failure — which is exactly how the reactivity band shipped reading a field
 * that never reached it. TypeScript cannot catch this: dropping a field from
 * an object literal is legal.
 *
 * These are the cheap end-to-end guards. If a new measurement is added to the
 * catalog, add it here too, or it will silently never arrive.
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

describe('mapRuntimeCatalogEntry carries measurements to the UI', () => {
  const runtimeEntry = {
    id: 'x',
    title: 'X',
    tags: [],
    supports: {
      webgl: { status: 'supported' },
      webgpu: { status: 'supported' },
    },
    quality: { score: 0.5, components: { measuredReactivity: 0.87 } },
    sensoryProfile: {
      flashRiskLevel: 'high',
      maxTransitionsPerSecondEstimate: 5,
      meanLuminance: 0.4,
      maxLuminanceDelta: 0.2,
      measuredAt: '2026-08-19T00:00:00.000Z',
    },
  } as unknown as MilkdropCatalogEntry;

  test('reactivity survives the runtime-to-frontend hop', () => {
    const mapped = mapRuntimeCatalogEntry(runtimeEntry);
    expect(mapped.quality?.components?.measuredReactivity).toBe(0.87);
  });

  test('the sensory profile survives the runtime-to-frontend hop', () => {
    const mapped = mapRuntimeCatalogEntry(runtimeEntry);
    expect(mapped.sensoryProfile?.flashRiskLevel).toBe('high');
  });
});

describe('the shipped catalogs actually carry the fields', () => {
  test('starter-catalog.json carries reactivity for its presets', () => {
    // The starter set is what browse shows first, and it is also — not
    // coincidentally — almost exactly the set with measured reactivity. It
    // previously omitted the field entirely, so the chip rendered for nobody.
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
