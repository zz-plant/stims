import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createManifestClient } from '../assets/js/utils/manifest-client.ts';

describe('manifest client', () => {
  const moduleEntry = 'assets/js/toys/example.ts';

  beforeEach(() => {
    window.location.href = 'http://example.com/';
  });

  afterEach(() => {
    mock.restore();
  });

  test('uses manifest entry with provided base URL', async () => {
    const manifest = {
      [moduleEntry]: { file: 'assets/js/toys/example.123.js' },
    };

    const fetchImpl = mock(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) })
    );

    const client = createManifestClient({ fetchImpl, baseUrl: 'http://example.com/app/' });
    const modulePath = await client.resolveModulePath(moduleEntry);

    expect(fetchImpl).toHaveBeenCalledWith('/app/.vite/manifest.json');
    expect(modulePath).toBe('/app/assets/js/toys/example.123.js');
  });

  test('falls back when manifest is missing', async () => {
    const fetchImpl = mock(() => Promise.resolve({ ok: false }));

    const client = createManifestClient({ fetchImpl, baseUrl: 'http://example.com/' });
    const modulePath = await client.resolveModulePath(moduleEntry);

    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/.vite/manifest.json');
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/manifest.json');
    expect(modulePath).toBe('/assets/js/toys/example.ts');
  });

  test('caches manifest retrieval across resolutions', async () => {
    const manifest = {
      [moduleEntry]: { file: 'assets/js/toys/example.123.js' },
    };

    const fetchImpl = mock(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) })
    );

    const client = createManifestClient({ fetchImpl });

    await client.resolveModulePath(moduleEntry);
    await client.resolveModulePath(moduleEntry);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('fetches manifest and modules from remote base origin', async () => {
    window.location.href = 'http://localhost/';

    const manifest = {
      [moduleEntry]: { file: 'assets/js/toys/example.123.js' },
    };

    const fetchImpl = mock(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) })
    );

    const client = createManifestClient({
      fetchImpl,
      baseUrl: 'https://cdn.example.com/app/',
    });

    const modulePath = await client.resolveModulePath(moduleEntry);

    expect(fetchImpl).toHaveBeenCalledWith('https://cdn.example.com/app/.vite/manifest.json');
    expect(modulePath).toBe('https://cdn.example.com/app/assets/js/toys/example.123.js');
  });

  test('falls back to remote base for missing manifest entry', async () => {
    window.location.href = 'http://localhost/';

    const fetchImpl = mock(() => Promise.resolve({ ok: false }));

    const client = createManifestClient({
      fetchImpl,
      baseUrl: 'https://cdn.example.com/app/',
    });

    const modulePath = await client.resolveModulePath(moduleEntry);

    expect(modulePath).toBe('https://cdn.example.com/app/assets/js/toys/example.ts');
  });
});
