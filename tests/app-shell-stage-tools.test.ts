import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell stage tool interaction regression', () => {
  test('stage-anchored editor has no backdrop overlay', () => {
    const appSource = readFileSync(
      join(import.meta.dir, '..', 'assets', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );
    const uiSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
        'js',
        'frontend',
        'workspace-ui.tsx',
      ),
      'utf8',
    );

    expect(appSource).toMatch(
      /const stageAnchoredToolOpen =[\s\S]*?(?:ui|w)\.routeState\.panel === 'editor'/u,
    );
    expect(uiSource).not.toContain('stims-shell__sheet-backdrop');
  });
});
