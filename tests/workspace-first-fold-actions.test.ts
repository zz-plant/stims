import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('workspace first-fold launch hierarchy', () => {
  test('keeps one dominant primary CTA with secondary audio starts in the first fold', () => {
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

    expect(
      (
        launchStackBlock.match(
          /cta-button primary stims-shell__action-button/gu,
        ) ?? []
      ).length,
    ).toBe(1);
    expect(launchStackBlock).toContain('See visuals now');
    expect(launchStackBlock).toContain('Use microphone');
    expect(launchStackBlock).toContain('Capture tab audio');
    expect(launchStackBlock).not.toContain('Explore modes');
  });
});
