import { describe, expect, mock, test } from 'bun:test';
import { createManifestClient } from '../assets/js/utils/manifest-client.ts';

describe('manifest client', () => {
  const moduleEntry = 'assets/js/toys/example.ts';

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
});
