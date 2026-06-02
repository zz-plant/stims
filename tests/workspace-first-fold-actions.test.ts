import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('workspace first-fold launch hierarchy', () => {
  test('shows alternative audio sources, no primary CTA (demo auto-plays)', () => {
    const homeSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
        'js',
        'frontend',
        'NewHomePage.tsx',
      ),
      'utf8',
    );

    const launchStackBlock =
      homeSource.match(
        /<div className="stims-shell__launch-stack">([\s\S]*?)<\/div>/u,
      )?.[1] ?? '';

    expect(launchStackBlock).not.toContain('See visuals now');
    expect(launchStackBlock).not.toContain('cta-button primary');
    expect(launchStackBlock).toContain('Use microphone');
    expect(launchStackBlock).toContain('Capture tab audio');
  });
});
