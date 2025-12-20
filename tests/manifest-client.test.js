import { afterEach, describe, expect, mock, test } from 'bun:test';
import { createManifestClient } from '../assets/js/utils/manifest-client.ts';

describe('manifest client', () => {
  const moduleEntry = 'assets/js/toys/example.ts';

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

    expect(fetchImpl).toHaveBeenCalledWith('/app/manifest.json');
    expect(modulePath).toBe('/app/assets/js/toys/example.123.js');
  });

  test('falls back when manifest is missing', async () => {
    const fetchImpl = mock(() => Promise.resolve({ ok: false }));

    const client = createManifestClient({ fetchImpl, baseUrl: 'http://example.com/' });
    const modulePath = await client.resolveModulePath(moduleEntry);

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

  test('retries after failed manifest fetch and uses new manifest', async () => {
    const manifest = {
      [moduleEntry]: { file: 'assets/js/toys/example.123.js' },
    };

    let callCount = 0;
    const fetchImpl = mock(() => {
      callCount += 1;

      if (callCount <= 2) {
        return Promise.resolve({ ok: false });
      }

      return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) });
    });

    const client = createManifestClient({ fetchImpl, baseUrl: 'http://example.com/' });

    const fallbackPath = await client.resolveModulePath(moduleEntry);
    expect(fallbackPath).toBe('/assets/js/toys/example.ts');

    const resolvedPath = await client.resolveModulePath(moduleEntry);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(resolvedPath).toBe('/assets/js/toys/example.123.js');
  });
});
