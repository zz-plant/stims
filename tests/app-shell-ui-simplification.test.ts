import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell UI simplification regression', () => {
  test('keeps the shell copy lean around launch, presets, and tuning', () => {
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
    const sessionHookSource = readFileSync(
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

    expect(helperSource).toContain(
      'Start with guided picks, then open the full library.',
    );
    expect(helperSource).toContain(
      'Pick a look first, then fine-tune only if needed.',
    );
    expect(appSource).toContain("'Start demo, use the mic, or capture a tab.'");
    expect(sessionHookSource).toContain("'Using lighter visual mode.'");
    expect(appSource).toContain(": 'Loading';");
    expect(appSource).toContain(": 'Warming up visuals.';");
    expect(appSource).toContain(": 'Open Presets or shuffle.';");
    expect(uiSource).toContain('Featured');
    expect(uiSource).toMatch(/>\s*Shuffle\s*</u);
    expect(uiSource).toContain('Start with a mood, not a filename.');
    expect(uiSource).toContain('Four quick ways into the catalog.');
    expect(uiSource).toContain('Full library');
    expect(uiSource).toContain('Start with Balanced.');
    expect(uiSource).toContain('Choose a visual profile');
    expect(uiSource).toContain('Keep visuals steadier on tricky hardware');
    expect(uiSource).toContain('Use motion controls on supported devices');
    expect(uiSource).toContain('Fine-tune the picture');
    expect(uiSource).toContain('Copy link');
    expect(uiSource).toContain('Editor stays on the stage.');
    expect(uiSource).toContain('Inspector stays on the stage.');
    expect(uiSource).toMatch(/<p>\s*\{launchSummary\}\s*<\/p>/u);
    expect(uiSource).toMatch(
      /className="stims-shell__meta-copy stims-shell__stage-summary">\s*\{stageSummary\}\s*<\/p>/u,
    );
    expect(uiSource).not.toContain(
      'Search the full library or shuffle a surprise.',
    );
    expect(uiSource).not.toContain(
      'Stay on Balanced unless the picture feels rough.',
    );
    expect(uiSource).not.toContain(
      'Use these only when you want a sharper image or need to calm',
    );
    expect(uiSource).not.toContain(
      'More ways to start when audio is already playing elsewhere.',
    );
    expect(uiSource).not.toContain('Recommended first run: start demo');
    expect(uiSource).not.toContain('Show current link');
  });
});
