import { describe, expect, mock, test } from 'bun:test';

import { createManifestClient } from '../assets/js/core/manifest.ts';

describe('manifest client', () => {
  test('prefers manifest entries using provided fetch and base URL', async () => {
    const manifest = {
      'assets/js/toys/example.ts': { file: 'assets/js/toys/example.123.js' },
    };
    const fetchImpl = mock(async () => ({
      ok: true,
      json: () => Promise.resolve(manifest),
    }));

    const client = createManifestClient({
      fetchImpl,
      baseUrl: 'http://example.com/site/',
    });

    const modulePath = await client.resolveModulePath('assets/js/toys/example.ts');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(modulePath).toBe('/site/assets/js/toys/example.123.js');
  });

  test('falls back when manifest is missing and caches requests', async () => {
    const fetchImpl = mock(async () => ({ ok: false }));
    const client = createManifestClient({
      fetchImpl,
      baseUrl: 'http://example.com',
    });

    const modulePath = await client.resolveModulePath('assets/js/toys/example.ts');
    const cachedManifest = await client.fetchManifest();

    expect(modulePath).toBe('/assets/js/toys/example.ts');
    expect(cachedManifest).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
