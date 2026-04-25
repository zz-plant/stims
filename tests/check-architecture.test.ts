import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  classifyArchitectureLayer,
  collectArchitectureViolations,
  isArchitectureDependencyAllowed,
} from '../scripts/check-architecture.ts';

describe('architecture boundary rules', () => {
  const workspacePath = (...segments: string[]) =>
    path.join(process.cwd(), ...segments);

  test('classifies the documented runtime layers', () => {
    expect(classifyArchitectureLayer(workspacePath('assets/js/app.ts'))).toBe(
      'app',
    );
    expect(
      classifyArchitectureLayer(workspacePath('assets/js/frontend/App.tsx')),
    ).toBe('frontend');
    expect(
      classifyArchitectureLayer(
        workspacePath('assets/js/data/toy-manifest.ts'),
      ),
    ).toBe('data');
    expect(
      classifyArchitectureLayer(
        workspacePath('assets/js/bootstrap/home-page.ts'),
      ),
    ).toBe('legacy');
    expect(
      classifyArchitectureLayer(workspacePath('assets/js/library-view.js')),
    ).toBe('legacy');
    expect(
      classifyArchitectureLayer(workspacePath('assets/js/core/web-toy.ts')),
    ).toBe('core');
    expect(
      classifyArchitectureLayer(workspacePath('assets/js/ui/nav.ts')),
    ).toBe('ui');
    expect(
      classifyArchitectureLayer(
        workspacePath('assets/js/utils/device-detect.ts'),
      ),
    ).toBe('utils');
    expect(
      classifyArchitectureLayer(
        workspacePath('assets/js/toys/milkdrop-toy.ts'),
      ),
    ).toBe('toy');
    expect(
      classifyArchitectureLayer(
        workspacePath('assets/js/milkdrop/public/launch-intents.ts'),
      ),
    ).toBe('milkdrop-public');
    expect(
      classifyArchitectureLayer(
        workspacePath('assets/js/milkdrop/preset-selection.ts'),
      ),
    ).toBe('milkdrop');
    expect(
      classifyArchitectureLayer(workspacePath('assets/js/milkdrop/runtime.ts')),
    ).toBe('milkdrop');
  });

  test('allows only the documented core to utils exception set', () => {
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'core',
        targetLayer: 'utils',
        targetPath: workspacePath('assets/js/utils/device-detect.ts'),
      }),
    ).toBe(true);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'core',
        targetLayer: 'utils',
        targetPath: workspacePath('assets/js/utils/manifest-client.ts'),
      }),
    ).toBe(false);
  });

  test('treats data as a leaf layer', () => {
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'legacy',
        targetLayer: 'data',
        targetPath: workspacePath('assets/js/data/toy-manifest.ts'),
      }),
    ).toBe(true);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'data',
        targetLayer: 'core',
        targetPath: workspacePath('assets/js/core/render-preferences.ts'),
      }),
    ).toBe(false);
  });

  test('keeps the milkdrop seam narrow', () => {
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'legacy',
        targetLayer: 'milkdrop-public',
        targetPath: workspacePath(
          'assets/js/milkdrop/public/launch-intents.ts',
        ),
      }),
    ).toBe(true);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'legacy',
        targetLayer: 'milkdrop',
        targetPath: workspacePath('assets/js/milkdrop/preset-selection.ts'),
      }),
    ).toBe(false);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'milkdrop-public',
        targetLayer: 'milkdrop',
        targetPath: workspacePath('assets/js/milkdrop/preset-selection.ts'),
      }),
    ).toBe(true);
  });

  test('lets the app boot only through the shipped frontend entrypoints', () => {
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'app',
        targetLayer: 'frontend',
        targetPath: workspacePath('assets/js/frontend/App.tsx'),
      }),
    ).toBe(true);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'app',
        targetLayer: 'legacy',
        targetPath: workspacePath('assets/js/loader.ts'),
      }),
    ).toBe(false);
  });

  test('rejects utils depending on core or toy runtime code', () => {
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'utils',
        targetLayer: 'core',
        targetPath: workspacePath('assets/js/core/render-preferences.ts'),
      }),
    ).toBe(false);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'utils',
        targetLayer: 'toy',
        targetPath: workspacePath('assets/js/toys/milkdrop-toy.ts'),
      }),
    ).toBe(false);
  });

  test('scans tsx files when collecting architecture violations', async () => {
    const fixturePath = workspacePath(
      'assets/js/utils/__tmp-architecture-violation-fixture.tsx',
    );

    await fs.writeFile(
      fixturePath,
      "import '../core/render-preferences.ts';\nexport function TmpArchitectureViolationFixture() { return null; }\n",
      'utf8',
    );

    try {
      const violations = await collectArchitectureViolations();

      expect(violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source:
              'assets/js/utils/__tmp-architecture-violation-fixture.tsx',
            sourceLayer: 'utils',
            target: 'assets/js/core/render-preferences.ts',
            targetLayer: 'core',
            specifier: '../core/render-preferences.ts',
          }),
        ]),
      );
    } finally {
      await fs.rm(fixturePath, { force: true });
    }
  });
});
