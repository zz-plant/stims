import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('workspace first-fold launch hierarchy', () => {
  test('keeps exactly one dominant primary CTA with no alternate launch modes in the first fold', () => {
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

    const launchStackBlock =
      uiSource.match(
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
    expect(launchStackBlock).not.toContain('Explore modes');
    expect(launchStackBlock).not.toContain('Microphone');
  });
});
