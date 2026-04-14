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
    const toastHookSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
        'js',
        'frontend',
        'workspace-toast.ts',
      ),
      'utf8',
    );

    expect(helperSource).toContain(
      'Start with guided picks, then open the full library.',
    );
    expect(helperSource).toContain(
      'Pick a look first, then fine-tune only if needed.',
    );
    expect(appSource).toContain(
      "'Press play for demo audio now, then switch to your own music only when you want the visuals to follow live sound.'",
    );
    expect(toastHookSource).toContain("'Using lighter visual mode.'");
    expect(appSource).toContain(": 'Loading';");
    expect(appSource).toContain(": 'Warming up visuals.';");
    expect(appSource).toContain("? 'Demo is playing'");
    expect(appSource).toContain(
      ": 'Press play with demo audio, or open the preset library first.';",
    );
    expect(uiSource).toContain('Try this look first');
    expect(uiSource).toMatch(/>\s*Shuffle\s*</u);
    expect(uiSource).toContain('Pick a look and press play.');
    expect(uiSource).toContain('Four quick ways into the catalog.');
    expect(uiSource).toContain('Full library');
    expect(uiSource).toContain('Change the vibe, keep the momentum.');
    expect(uiSource).toContain('Or pick a specific visual profile');
    expect(uiSource).toContain('Keep visuals steadier on tricky hardware');
    expect(uiSource).toContain('Use motion controls on supported devices');
    expect(uiSource).toContain('Advanced tuning');
    expect(uiSource).toContain(
      'Demo starts instantly. Your own audio is optional.',
    );
    expect(uiSource).toContain('Runs best on desktop and laptop.');
    expect(uiSource).toMatch(
      /Phones and older browsers can fall back to lighter visuals\s+automatically\./u,
    );
    expect(uiSource).toContain('Use my music');
    expect(uiSource).toMatch(
      /Needs mic permission\.\s+React to the room, your speakers, or live\s+sound\./u,
    );
    expect(uiSource).toContain(
      'Share this tab when prompted to capture audio already playing here.',
    );
    expect(uiSource).toContain('Paste a YouTube link, then start capture');
    expect(uiSource).toContain('Switch to your music');
    expect(uiSource).toMatch(
      /Demo audio is running\.\s+Bring in your microphone, this tab, or a\s+YouTube link when you want the visuals to follow your own\s+sound\./u,
    );
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
    expect(uiSource).not.toContain('Start with Balanced.');
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
