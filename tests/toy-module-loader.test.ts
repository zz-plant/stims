import { describe, expect, mock, test } from 'bun:test';
import {
  getBundledToyModuleImporter,
  loadToyModuleStarter,
} from '../assets/js/loader/toy-module-loader.ts';

const fixtureModulePath = '../../tests/fixtures/toy-modules/fake-module.js';

describe('toy module loader', () => {
  test('finds bundled toy modules without manifest indirection', async () => {
    const importer = getBundledToyModuleImporter(
      'assets/js/toys/milkdrop-toy.ts',
    );

    expect(importer).not.toBeNull();
  });

  test('loads bundled toy modules even when manifest resolution fails', async () => {
    const manifestClient = {
      resolveModulePath: mock(async () => {
        throw new Error('manifest unavailable');
      }),
    };

    const result = await loadToyModuleStarter({
      moduleId: 'assets/js/toys/milkdrop-toy.ts',
      manifestClient: manifestClient as never,
    });

    expect(result.ok).toBe(true);
    expect(manifestClient.resolveModulePath).not.toHaveBeenCalled();
    if (result.ok) {
      expect(typeof result.starter).toBe('function');
      expect(result.moduleUrl).toBe('assets/js/toys/milkdrop-toy.ts');
    }
  });

  test('uses manifest resolution for non-bundled module ids', async () => {
    const manifestClient = {
      resolveModulePath: mock(async () => fixtureModulePath),
    };

    const result = await loadToyModuleStarter({
      moduleId: fixtureModulePath,
      manifestClient: manifestClient as never,
    });

    expect(manifestClient.resolveModulePath).toHaveBeenCalledWith(
      fixtureModulePath,
    );
    expect(result.ok).toBe(true);
  });
});
