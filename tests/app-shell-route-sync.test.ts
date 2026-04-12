import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell route sync regression', () => {
  test('commits interactive route updates synchronously so tool sheets can open immediately', () => {
    const hookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
        'js',
        'frontend',
        'workspace-hooks.ts',
      ),
      'utf8',
    );

    expect(hookSource).toMatch(
      /const commitRoute = \(nextState: SessionRouteState\) => \{\s*setRouteState\(nextState\);\s*\};/u,
    );
    expect(hookSource).toMatch(
      /const commitRoute = \(nextState: SessionRouteState\) => \{\s*setRouteState\(nextState\);\s*\};\s*\n\s*\n\s*return \{/u,
    );
  });

  test('marks the shell when a toast is visible so mobile layouts can reserve space', () => {
    const appSource = readFileSync(
      join(import.meta.dir, '..', 'assets', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );
    const cssSource = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(appSource).toContain(`data-has-toast={toast ? 'true' : undefined}`);
    expect(cssSource).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell\[data-has-toast="true"\]\s*\{\s*padding-bottom:\s*calc\(96px \+ env\(safe-area-inset-bottom\)\);/u,
    );
  });
});
