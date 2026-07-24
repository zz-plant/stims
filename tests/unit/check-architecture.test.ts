import { describe, expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  classifyArchitectureLayer,
  collectArchitectureViolations,
  isArchitectureDependencyAllowed,
} from '../../scripts/check-architecture.ts';

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
    ).toBeNull();
    expect(
      classifyArchitectureLayer(workspacePath('assets/js/core/web-toy.ts')),
    ).toBe('core');
    expect(
      classifyArchitectureLayer(workspacePath('assets/js/ui/icon-library.ts')),
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
        sourcePath: workspacePath('assets/js/core/web-toy.ts'),
        targetPath: workspacePath('assets/js/utils/device-detect.ts'),
      }),
    ).toBe(true);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'core',
        targetLayer: 'utils',
        sourcePath: workspacePath('assets/js/core/web-toy.ts'),
        targetPath: workspacePath('assets/js/utils/manifest-client.ts'),
      }),
    ).toBe(false);
  });

  test('treats data as a leaf layer', () => {
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'toy',
        targetLayer: 'data',
        sourcePath: workspacePath('assets/js/toys/milkdrop-toy.ts'),
        targetPath: workspacePath('assets/js/data/toy-manifest.ts'),
      }),
    ).toBe(true);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'data',
        targetLayer: 'core',
        sourcePath: workspacePath('assets/js/data/toy-manifest.ts'),
        targetPath: workspacePath('assets/js/core/render-preferences.ts'),
      }),
    ).toBe(false);
  });

  test('keeps the frontend seam narrow', () => {
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'frontend',
        targetLayer: 'milkdrop-public',
        sourcePath: workspacePath('assets/js/frontend/App.tsx'),
        targetPath: workspacePath(
          'assets/js/milkdrop/public/launch-intents.ts',
        ),
      }),
    ).toBe(true);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'milkdrop-public',
        targetLayer: 'milkdrop',
        sourcePath: workspacePath(
          'assets/js/milkdrop/public/launch-intents.ts',
        ),
        targetPath: workspacePath('assets/js/milkdrop/preset-selection.ts'),
      }),
    ).toBe(true);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'frontend',
        targetLayer: 'utils',
        sourcePath: workspacePath('assets/js/frontend/App.tsx'),
        targetPath: workspacePath('assets/js/utils/device-detect.ts'),
      }),
    ).toBe(true);
  });

  test('rejects frontend to critical milkdrop internals unless it is the engine adapter', () => {
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'frontend',
        targetLayer: 'milkdrop',
        sourcePath: workspacePath('assets/js/frontend/BrowseSheetPanel.tsx'),
        targetPath: workspacePath('assets/js/milkdrop/runtime.ts'),
      }),
    ).toBe(false);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'frontend',
        targetLayer: 'milkdrop',
        sourcePath: workspacePath(
          'assets/js/frontend/engine/milkdrop-engine-adapter.ts',
        ),
        targetPath: workspacePath('assets/js/milkdrop/runtime.ts'),
      }),
    ).toBe(true);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'frontend',
        targetLayer: 'milkdrop',
        sourcePath: workspacePath('assets/js/frontend/BrowseSheetPanel.tsx'),
        targetPath: workspacePath('assets/js/milkdrop/preset-id-resolution.ts'),
      }),
    ).toBe(true);
  });

  test('lets the app boot only through the shipped frontend entrypoints', () => {
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'app',
        targetLayer: 'frontend',
        sourcePath: workspacePath('assets/js/app.ts'),
        targetPath: workspacePath('assets/js/frontend/App.tsx'),
      }),
    ).toBe(true);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'app',
        targetLayer: 'milkdrop',
        sourcePath: workspacePath('assets/js/app.ts'),
        targetPath: workspacePath('assets/js/milkdrop/preset-selection.ts'),
      }),
    ).toBe(false);
  });

  test('rejects utils depending on core or toy runtime code', () => {
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'utils',
        targetLayer: 'core',
        sourcePath: workspacePath('assets/js/utils/device-detect.ts'),
        targetPath: workspacePath('assets/js/core/render-preferences.ts'),
      }),
    ).toBe(false);
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'utils',
        targetLayer: 'toy',
        sourcePath: workspacePath('assets/js/utils/device-detect.ts'),
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
            sourceLayer: 'utils',
            targetLayer: 'core',
            specifier: expect.stringContaining('render-preferences'),
          }),
        ]),
      );
    } finally {
      await fs.rm(fixturePath, { force: true });
    }
  });
});
