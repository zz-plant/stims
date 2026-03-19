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

  test('derives backend support, favorites, ratings, and history from preset analysis', async () => {
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

    expect(bundled?.supports.webgl.status).toBe('supported');
    expect(bundled?.supports.webgpu.status).toBe('supported');
    expect(bundled?.fidelityClass).toBe('exact');
    expect(bundled?.certification).toBe('bundled');
    expect(bundled?.visualEvidenceTier).toBe('visual');
    expect(bundled?.featuresUsed).toContain('video-echo');
    expect(bundled?.featuresUsed).toContain('custom-waves');

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
    expect(imported?.supports.webgpu.status).toBe('partial');
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
      id: 'memory-only',
      title: 'Memory Only',
      raw: 'title=Memory Only\n',
      origin: 'user',
    });

    const saved = await store.getPresetSource('memory-only');
    expect(saved?.id).toBe('memory-only');
  });
});
