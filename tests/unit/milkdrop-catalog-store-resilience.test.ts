import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createMilkdropCatalogStore } from '../../src/js/milkdrop/catalog-store.ts';
import { compileMilkdropPresetSource } from '../../src/js/milkdrop/compiler.ts';

// Regression coverage for a corrupt/unparseable stored preset permanently
// wedging the whole catalog. `listPresets()` used to run an unguarded
// `.map()` over stored presets that called `analysis.getCompiled(entry)` —
// if that threw for *any single* preset, the whole call rejected and no
// presets (not even the healthy ones) were returned. See
// `src/js/milkdrop/catalog-store.ts`.
//
// The compile failure is injected through the store's `compilePresetImpl`
// seam rather than `mock.module` — mocking the compiler module and
// re-importing the store graph with a cache-busting query re-transpiles the
// whole compiler under bun test and could deadlock the process at 100% CPU.
describe('milkdrop catalog store resilience to a single corrupt preset', () => {
  const originalFetch = globalThis.fetch;
  const originalIndexedDb = globalThis.indexedDB;
  const originalWarn = console.warn;

  beforeEach(() => {
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = undefined;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    (globalThis as { indexedDB?: IDBFactory }).indexedDB = originalIndexedDb;
    console.warn = originalWarn;
  });

  test('skips a stored preset that fails to compile instead of failing listPresets() entirely', async () => {
    const warnMock = mock((..._args: unknown[]) => {});
    console.warn = warnMock as unknown as typeof console.warn;

    globalThis.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ presets: [] }),
    })) as unknown as typeof fetch;

    const store = createMilkdropCatalogStore({
      dbName: 'milkdrop-catalog-store-resilience-test',
      catalogUrl: '/milkdrop-presets/catalog.json',
      compilePresetImpl: (raw, source = {}, options) => {
        if ((source as { id?: string }).id === 'corrupt-preset') {
          throw new Error('Simulated corrupt preset compile failure');
        }
        return compileMilkdropPresetSource(raw, source, options as never);
      },
    });

    await store.savePreset({
      id: 'good-preset',
      title: 'Good Preset',
      raw: 'title=Good Preset\n',
      origin: 'user',
    });
    await store.savePreset({
      id: 'corrupt-preset',
      title: 'Corrupt Preset',
      raw: 'title=Corrupt Preset\n',
      origin: 'user',
    });

    // Must not throw — the corrupt preset should be skipped, not wedge the
    // whole catalog.
    const entries = await store.listPresets();
    const ids = entries.map((entry) => entry.id);

    expect(ids).toContain('good-preset');
    expect(ids).not.toContain('corrupt-preset');
    expect(warnMock).toHaveBeenCalled();
    const warnedAboutCorruptPreset = warnMock.mock.calls.some((call) =>
      call.some(
        (arg) => typeof arg === 'string' && arg.includes('corrupt-preset'),
      ),
    );
    expect(warnedAboutCorruptPreset).toBe(true);

    // A second call must keep working — the corrupt preset stays in
    // storage, so this proves the catalog isn't permanently stuck.
    const secondEntries = await store.listPresets();
    expect(secondEntries.map((entry) => entry.id)).toContain('good-preset');
  });
});
