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
    const stageSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
        'js',
        'frontend',
        'StimsStageFrame.tsx',
      ),
      'utf8',
    );
    const dockSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
        'js',
        'frontend',
        'StimsControlDock.tsx',
      ),
      'utf8',
    );
    const audioSourcePanelSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
        'js',
        'frontend',
        'AudioSourcePanel.tsx',
      ),
      'utf8',
    );
    const browseSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
        'js',
        'frontend',
        'BrowseSheetPanel.tsx',
      ),
      'utf8',
    );
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

    expect(helperSource).toContain(
      'Pick a feel first, then fine-tune only if you want more control.',
    );
    expect(homeSource).toContain(
      'Start instantly with demo audio, or connect your own sound when',
    );
    expect(toastHookSource).toContain("'Using lighter visual mode.'");
    expect(appSource).toContain("? 'Now playing'");
    expect(appSource).not.toContain("'Demo is playing'");
    expect(appSource).not.toContain('className="top-nav stims-shell__nav"');
    expect(uiSource).not.toContain('Launch deck');
    expect(uiSource).not.toContain('Single-route workspace');
    expect(stageSource).toContain('className="stims-shell__rail-actions"');
    expect(dockSource).toContain('className="stims-shell__stage-dock"');
    expect(homeSource).toContain('Recommended preset');
    expect(dockSource).toMatch(/>\s*Surprise me\s*</u);
    expect(homeSource).toContain('Start instantly with demo audio');
    expect(homeSource).not.toContain('See visuals now');
    expect(homeSource).not.toContain('Explore modes');
    expect(audioSourcePanelSource).toContain('Use my music');
    expect(audioSourcePanelSource).toContain('Live mic input');
    expect(audioSourcePanelSource).toContain('Audio from this browser tab');
    expect(audioSourcePanelSource).toContain('YouTube link');
    expect(audioSourcePanelSource).toContain('Start capture');
    expect(uiSource).toContain('Switch to your music \\u2192');
    expect(uiSource).not.toContain('Demo audio is running.');
    expect(uiSource).not.toContain('Easy on demo audio');
    expect(uiSource).not.toContain('Switch to live input later');
    expect(uiSource).not.toContain('Lighter render');
    expect(uiSource).not.toContain('Runtime checked');
    expect(uiSource).not.toContain('launch-badge-row');
    expect(uiSource).not.toContain('launch-recommendation-footer');
    expect(uiSource).not.toContain('stims-shell__session-meta');
    expect(uiSource).not.toContain('stims-shell__audio-bridge"');
    expect(browseSource).toContain('Copy share link');
    expect(uiSource).not.toContain('The editor opens on the stage.');
    expect(uiSource).not.toContain('The inspector opens on the stage.');
    expect(homeSource).toContain('className="stims-shell__launch-summary"');
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
    expect(homeSource).toContain('Saved pick not found');
    expect(homeSource).toContain('Explore presets');
  });
});
