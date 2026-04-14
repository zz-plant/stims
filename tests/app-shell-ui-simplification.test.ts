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
      'Start with a few strong picks, then browse the full library.',
    );
    expect(helperSource).toContain(
      'Pick a look first, then fine-tune only if you want more control.',
    );
    expect(appSource).toContain(
      "'Start with demo audio now, then switch to your own music whenever you want the visuals to follow live sound.'",
    );
    expect(toastHookSource).toContain("'Using lighter visual mode.'");
    expect(appSource).toContain(": 'Loading';");
    expect(appSource).toContain(": 'Loading the visualizer.';");
    expect(appSource).toContain("? 'Demo is playing'");
    expect(appSource).toContain(
      ": 'Press play with demo audio, or open the preset library first.';",
    );
    expect(appSource).not.toContain('className="top-nav stims-shell__nav"');
    expect(uiSource).toContain('Try this look first');
    expect(uiSource).toMatch(/>\s*Shuffle\s*</u);
    expect(uiSource).toContain('Pick a look and press play.');
    expect(uiSource).toContain('Four easy ways to get started.');
    expect(uiSource).toContain('Full library');
    expect(uiSource).toContain('className="stims-shell__frame-chrome"');
    expect(uiSource).toContain('className="stims-shell__frame-header"');
    expect(uiSource).toContain('className="stims-shell__corner-link"');
    expect(uiSource).toContain('Presets</span>');
    expect(uiSource).toContain('Look</span>');
    expect(uiSource).toContain('Or pick a specific visual profile');
    expect(uiSource).toContain('Keep visuals steadier on tricky hardware');
    expect(uiSource).toContain('Use motion controls on supported devices');
    expect(uiSource).toContain('Advanced controls');
    expect(uiSource).toContain('Runs best on desktop and laptop.');
    expect(uiSource).toMatch(
      /Phones and older browsers may switch to lighter visuals\s+automatically\./u,
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
    expect(uiSource).toContain('Demo audio is running.');
    expect(uiSource).toMatch(
      /YouTube link when you want the visuals to\s+follow your own sound\./u,
    );
    expect(uiSource).toContain('Copy link');
    expect(uiSource).toContain('The editor opens on the stage.');
    expect(uiSource).toContain('The inspector opens on the stage.');
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
