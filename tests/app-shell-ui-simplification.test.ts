import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell UI simplification regression', () => {
  test('keeps the shell copy centered on the launch path and quick tuning', () => {
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
    const helperSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
        'js',
        'frontend',
        'workspace-helpers.ts',
      ),
      'utf8',
    );

    expect(helperSource).toContain(
      'Start with a featured preset or dive into the full preset library.',
    );
    expect(appSource).toContain(
      'Start demo fastest. Use mic for room-reactive visuals or capture tab audio when music is already playing.',
    );
    expect(uiSource).toContain(
      'Search the full library or shuffle a surprise.',
    );
    expect(uiSource).toContain('Shuffle a preset');
    expect(uiSource).toContain(
      'Stay on Balanced unless the picture feels rough.',
    );
    expect(uiSource).toContain(
      'Use these only when you want a sharper image or need to calm',
    );
    expect(appSource).toMatch(
      /const launchEyebrow = missingRequestedPreset\s*\? 'Recover your session'/u,
    );
    expect(uiSource).toMatch(/<p>\s*\{launchSummary\}\s*<\/p>/u);
    expect(uiSource).toMatch(
      /className="stims-shell__meta-copy stims-shell__stage-summary">\s*\{stageSummary\}\s*<\/p>/u,
    );
  });
});
