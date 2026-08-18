import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell toast regression', () => {
  // The boot-time "lighter graphics mode" WebGL warning this test used to
  // assert was deliberately removed in 6f8db66c ("drop boot backend
  // toast") — it apologized to every mobile visitor over a stage that
  // hadn't painted yet. That's an intentional product decision, not a
  // regression, so this guards the decision instead of the deleted code:
  // no boot-time backend toast should come back, and the current
  // session-wide dedup mechanism (which generalized the old "only once"
  // guarantee to every runtime message, not just the WebGL warning) stays
  // in place.
  test('shows no boot-time backend warning toast', () => {
    const toastHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'workspace-toast.ts',
      ),
      'utf8',
    );

    expect(toastHookSource).not.toContain('webglWarningShownRef');
    expect(toastHookSource).not.toContain(
      'Using a lighter graphics mode so playback stays smooth.',
    );
    expect(toastHookSource).not.toMatch(/backend !== ['"]webgl['"]/u);
  });

  test('deduplicates a repeated status/warning toast within a session', () => {
    const toastHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'workspace-toast.ts',
      ),
      'utf8',
    );

    expect(toastHookSource).toContain(
      'const shownToastKeysRef = useRef(new Set<string>());',
    );
    expect(toastHookSource).toMatch(
      /const key = `\$\{resolvedTone\}:\$\{runtimeMessage\}`;\s*if \(shownToastKeysRef\.current\.has\(key\)\) \{\s*return;\s*\}/u,
    );
    expect(toastHookSource).toContain('shownToastKeysRef.current.add(key);');
  });

  test('clears any active toast timer when dismissing a toast', () => {
    const toastHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
        'js',
        'frontend',
        'workspace-toast.ts',
      ),
      'utf8',
    );

    expect(toastHookSource).toContain('const clearToastTimer = () => {');
    expect(toastHookSource).toMatch(
      /showToast = useEffectEvent\([\s\S]*?clearToastTimer\(\);[\s\S]*?window\.setTimeout/u,
    );
    expect(toastHookSource).toMatch(
      /dismissToast:\s*\(\)\s*=>\s*\{[\s\S]*?clearToastTimer\(\);[\s\S]*?setToast\(null\);[\s\S]*?\}/u,
    );
  });
});
