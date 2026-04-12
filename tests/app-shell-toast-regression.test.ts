import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell toast regression', () => {
  test('shows the lighter-mode warning only once per session', () => {
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

    expect(hookSource).toContain('const webglWarningShownRef = useRef(false);');
    expect(hookSource).toMatch(
      /useEffect\(\(\) => \{[\s\S]*?engineSnapshot\.backend !== 'webgl'[\s\S]*?webglWarningShownRef\.current = true;[\s\S]*?setToast\(\{ message: 'Using lighter visual mode\.', tone: 'warn' \}\);[\s\S]*?window\.setTimeout\([\s\S]*?4200\);\s*\}, \[\s*engineSnapshot\?\.backend,\s*engineSnapshot\?\.runtimeReady,\s*routeState\.invalidExperienceSlug,\s*\]\);/u,
    );
  });

  test('clears any active toast timer when dismissing a toast', () => {
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

    expect(hookSource).toContain('const clearToastTimer = () => {');
    expect(hookSource).toMatch(
      /showToast = useEffectEvent\([\s\S]*?clearToastTimer\(\);[\s\S]*?window\.setTimeout/u,
    );
    expect(hookSource).toMatch(
      /dismissToast:\s*\(\)\s*=>\s*\{[\s\S]*?clearToastTimer\(\);[\s\S]*?setToast\(null\);[\s\S]*?\}/u,
    );
  });
});
