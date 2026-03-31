import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import {
  classifyArchitectureLayer,
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
      classifyArchitectureLayer(
        workspacePath('assets/js/bootstrap/home-page.ts'),
      ),
    ).toBe('bootstrap');
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
      classifyArchitectureLayer(workspacePath('assets/js/milkdrop/runtime.ts')),
    ).toBeNull();
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

  test('rejects utils depending on core', () => {
    expect(
      isArchitectureDependencyAllowed({
        sourceLayer: 'utils',
        targetLayer: 'core',
        targetPath: workspacePath('assets/js/core/render-preferences.ts'),
      }),
    ).toBe(false);
  });
});
