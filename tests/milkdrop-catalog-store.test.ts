import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMilkdropCatalogStore } from '../assets/js/milkdrop/catalog-store.ts';

describe('milkdrop catalog store', () => {
  const originalFetch = globalThis.fetch;
  const originalIndexedDb = globalThis.indexedDB;

  beforeEach(() => {
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = undefined;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = originalIndexedDb;
    mock.restore();
  });

  test('enriches mismatched catalog metadata after the preset is compiled on demand', async () => {
    let presetFetchCount = 0;

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/milkdrop-presets/catalog.json')) {
        return {
          ok: true,
          json: async () => ({
            presets: [
              {
                id: 'mismatch-pack',
                title: 'Mismatch Pack',
                author: 'Curated',
                file: '/milkdrop-presets/mismatch-pack.milk',
                tags: ['curated'],
                order: 1,
                expectedFidelityClass: 'fallback',
                visualEvidenceTier: 'compile',
                supports: { webgl: true, webgpu: false },
              },
            ],
          }),
        };
      }

      if (url.endsWith('/milkdrop-presets/mismatch-pack.milk')) {
        presetFetchCount += 1;
        return {
          ok: true,
          text: async () =>
            'title=Mismatch Pack\nvideo_echo=1\nwavecode_0_enabled=1\n',
        };
      }

      return { ok: false };
    }) as unknown as typeof fetch;

    const store = createMilkdropCatalogStore({
      dbName: 'milkdrop-catalog-store-support-mismatch-test',
      catalogUrl: '/milkdrop-presets/catalog.json',
    });

    const entries = await store.listPresets();
    const bundled = entries.find((entry) => entry.id === 'mismatch-pack');

    expect(bundled).toBeDefined();
    expect(presetFetchCount).toBe(0);
    expect(bundled?.supports.webgl.status).toBe('supported');
    expect(bundled?.supports.webgpu.status).toBe('unsupported');
    expect(bundled?.fidelityClass).toBe('fallback');
    expect(bundled?.visualEvidenceTier).toBe('compile');

    await store.getPresetSource('mismatch-pack');

    const enrichedEntries = await store.listPresets();
    const enriched = enrichedEntries.find(
      (entry) => entry.id === 'mismatch-pack',
    );

    expect(presetFetchCount).toBe(1);
    expect(enriched?.supports.webgl.status).toBe('supported');
    expect(enriched?.supports.webgpu.status).toBe('supported');
    expect(enriched?.fidelityClass).toBe('partial');
    expect(enriched?.visualEvidenceTier).toBe('runtime');
    expect(enriched?.evidence.visual).toBe('not-captured');
  });

  test('defers bundled analysis until the preset is loaded on demand', async () => {
    let presetFetchCount = 0;

    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/milkdrop-presets/catalog.json')) {
        return {
          ok: true,
          json: async () => ({
            presets: [
              {
                id: 'feedback-pack',
                title: 'Feedback Pack',
                author: 'Curated',
                file: '/milkdrop-presets/feedback-pack.milk',
                tags: ['feedback', 'curated'],
                order: 1,
              },
            ],
          }),
        };
      }

      if (url.endsWith('/milkdrop-presets/feedback-pack.milk')) {
        presetFetchCount += 1;
        return {
          ok: true,
          text: async () =>
            'title=Feedback Pack\nvideo_echo=1\nwavecode_0_enabled=1\n',
        };
      }

      return {
        ok: false,
      };
    }) as unknown as typeof fetch;

    const store = createMilkdropCatalogStore({
      dbName: 'milkdrop-catalog-store-test',
      catalogUrl: '/milkdrop-presets/catalog.json',
    });

    const bundledEntries = await store.listPresets();
    const bundled = bundledEntries.find(
      (entry) => entry.id === 'feedback-pack',
    );

    expect(presetFetchCount).toBe(0);
    expect(bundled?.supports.webgl.status).toBe('partial');
    expect(bundled?.supports.webgpu.status).toBe('partial');
    expect(bundled?.fidelityClass).toBe('partial');
    expect(bundled?.certification).toBe('bundled');
    expect(bundled?.visualEvidenceTier).toBe('none');
    expect(bundled?.evidence.visual).toBe('not-captured');
    expect(bundled?.featuresUsed).toEqual([]);
    expect(bundled?.warnings).toContain(
      'Detailed compatibility will be analyzed when this preset loads.',
    );

    await store.getPresetSource('feedback-pack');

    const enrichedBundledEntries = await store.listPresets();
    const enrichedBundled = enrichedBundledEntries.find(
      (entry) => entry.id === 'feedback-pack',
    );

    expect(presetFetchCount).toBe(1);
    expect(enrichedBundled?.supports.webgl.status).toBe('supported');
    expect(enrichedBundled?.supports.webgpu.status).toBe('supported');
    expect(enrichedBundled?.visualEvidenceTier).toBe('runtime');
    expect(enrichedBundled?.featuresUsed).toContain('video-echo');
    expect(enrichedBundled?.featuresUsed).toContain('custom-waves');

    await store.savePreset({
      id: 'local-shader',
      title: 'Local Shader',
      raw: 'title=Local Shader\nwarp_shader=unsupported\n',
      origin: 'user',
    });
    await store.setFavorite('local-shader', true);
    await store.setRating('local-shader', 5);
    await store.recordRecent('local-shader');
    await store.pushHistory('local-shader');

    const entries = await store.listPresets();
    const imported = entries.find((entry) => entry.id === 'local-shader');

    expect(imported?.isFavorite).toBe(true);
    expect(imported?.rating).toBe(5);
    expect(imported?.supports.webgl.status).toBe('partial');
    expect(imported?.supports.webgpu.status).toBe('unsupported');
    expect(imported?.fidelityClass).toBe('fallback');
    expect(imported?.certification).toBe('exploratory');
    expect(imported?.parity.approximatedShaderLines).toEqual(['unsupported']);
    expect(imported?.parity.blockedConstructs).toEqual(['shader:unsupported']);
    expect(imported?.parity.blockingConstructDetails).toEqual([
      {
        kind: 'shader',
        value: 'unsupported',
        system: 'shader-text',
        allowlisted: false,
      },
    ]);
    expect(imported?.featuresUsed).toContain('unsupported-shader-text');

    const history = await store.getHistory();
    expect(history[0]).toBe('local-shader');
  });

  test('falls back to memory storage when indexedDB is unavailable', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/milkdrop-presets/catalog.json')) {
        return {
          ok: true,
          json: async () => ({ presets: [] }),
        };
      }

      return { ok: false };
    }) as unknown as typeof fetch;

    const store = createMilkdropCatalogStore({
      dbName: 'milkdrop-catalog-store-memory-test',
      catalogUrl: '/milkdrop-presets/catalog.json',
    });

    await store.savePreset({
      id: 'memory-only',
      title: 'Memory Only',
      raw: 'title=Memory Only\n',
      origin: 'user',
    });

    const saved = await store.getPresetSource('memory-only');
    expect(saved?.id).toBe('memory-only');

    const entries = await store.listPresets();
    expect(entries.map((entry) => entry.id)).toContain('memory-only');
  });

  test('merges supplemental vendored library manifests into the runtime catalog', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/milkdrop-presets/catalog.json')) {
        return {
          ok: true,
          json: async () => ({
            presets: [
              {
                id: 'rovastar-parallel-universe',
                title: 'Rovastar - Parallel Universe',
                file: '/milkdrop-presets/rovastar-parallel-universe.milk',
                order: 1,
              },
            ],
          }),
        };
      }

      if (
        url.endsWith(
          '/milkdrop-presets/libraries/projectm-upstream/catalog.json',
        )
      ) {
        return {
          ok: true,
          json: async () => ({
            presets: [
              {
                id: '250-wavecode',
                title: '250 Wavecode',
                file: '/milkdrop-presets/libraries/projectm-upstream/250-wavecode.milk',
                order: 1000,
                tags: ['collection:vendored-projectm', 'vendored-library'],
                certification: 'exploratory',
                corpusTier: 'exploratory',
              },
            ],
          }),
        };
      }

      if (url.endsWith('/milkdrop-presets/rovastar-parallel-universe.milk')) {
        return {
          ok: true,
          text: async () =>
            'title=Rovastar - Parallel Universe\nvideo_echo=1\n',
        };
      }

      if (
        url.endsWith(
          '/milkdrop-presets/libraries/projectm-upstream/250-wavecode.milk',
        )
      ) {
        return {
          ok: true,
          text: async () =>
            'title=250 Wavecode\nwavecode_0_enabled=1\nwavecode_0_samples=512\n',
        };
      }

      return { ok: false };
    }) as unknown as typeof fetch;

    const store = createMilkdropCatalogStore({
      dbName: 'milkdrop-catalog-store-vendored-library-test',
      catalogUrl: '/milkdrop-presets/catalog.json',
    });

    const entries = await store.listPresets();
    const vendored = entries.find((entry) => entry.id === '250-wavecode');

    expect(entries.map((entry) => entry.id)).toContain('250-wavecode');
    expect(vendored?.certification).toBe('exploratory');
    expect(vendored?.corpusTier).toBe('exploratory');
    expect(vendored?.tags).toContain('collection:vendored-projectm');
    expect(vendored?.bundledFile).toBe(
      '/milkdrop-presets/libraries/projectm-upstream/250-wavecode.milk',
    );
  });

  test('falls back to memory storage when indexedDB open stalls', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/milkdrop-presets/catalog.json')) {
        return {
          ok: true,
          json: async () => ({ presets: [] }),
        };
      }

      return { ok: false };
    }) as unknown as typeof fetch;

    (globalThis as { indexedDB?: IDBFactory }).indexedDB = {
      open: () => ({}) as IDBOpenDBRequest,
    } as unknown as IDBFactory;

    const store = createMilkdropCatalogStore({
      dbName: 'milkdrop-catalog-store-timeout-test',
      catalogUrl: '/milkdrop-presets/catalog.json',
    });

    const startedAt = Date.now();
    const entries = await store.listPresets();

    expect(entries).toEqual([]);
    expect(Date.now() - startedAt).toBeLessThan(2000);

    await store.savePreset({
      id: 'memory-only-stalled',
      title: 'Memory Only Stalled',
      raw: 'title=Memory Only Stalled\n',
      origin: 'user',
    });

    const saved = await store.getPresetSource('memory-only-stalled');
    expect(saved?.id).toBe('memory-only-stalled');
  });

  test('returns an empty bundled catalog when the catalog fetch fails', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const store = createMilkdropCatalogStore({
      dbName: 'milkdrop-catalog-store-fetch-failure-test',
      catalogUrl: '/milkdrop-presets/catalog.json',
    });

    await expect(store.listPresets()).resolves.toEqual([]);
    await expect(store.getPresetSource('missing-bundled')).resolves.toBeNull();
  });
});
