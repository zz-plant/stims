import { describe, expect, mock, test } from 'bun:test';
import {
  getBundledToyModuleImporter,
  loadToyModuleStarter,
} from '../assets/js/utils/toy-module-loader.ts';

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
      resolveModulePath: mock(async () => './__mocks__/fake-module.js'),
    };

    const result = await loadToyModuleStarter({
      moduleId: './__mocks__/fake-module.js',
      manifestClient: manifestClient as never,
    });

    expect(manifestClient.resolveModulePath).toHaveBeenCalledWith(
      './__mocks__/fake-module.js',
    );
    expect(result.ok).toBe(true);
  });
});
