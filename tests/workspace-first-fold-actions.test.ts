import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('workspace first-fold launch hierarchy', () => {
  test('keeps exactly one dominant primary CTA and demotes alternate launch modes', () => {
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

    const launchActionsBlock =
      uiSource.match(
        /<div className="stims-shell__launch-actions">([\s\S]*?)<\/div>/u,
      )?.[1] ?? '';

    expect(
      (
        launchActionsBlock.match(
          /cta-button primary stims-shell__action-button/gu,
        ) ?? []
      ).length,
    ).toBe(1);
    expect(launchActionsBlock).toContain('See visuals now');
    expect(launchActionsBlock).not.toContain('Use my music');
    expect(launchActionsBlock).toContain('Explore modes');
    expect(uiSource).toContain('data-launch-secondary="true"');
    expect(uiSource).toContain('Microphone, tab audio, or YouTube');
  });
});
