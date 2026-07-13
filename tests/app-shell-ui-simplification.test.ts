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
    const stageControlsSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
        'js',
        'frontend',
        'StageControls.tsx',
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
      'Choose a quality preset, then adjust performance and motion options.',
    );
    expect(toastHookSource).toContain("'Using lighter visual mode.'");
    expect(appSource).toContain("? 'Now playing'");
    expect(appSource).not.toContain('className="top-nav stims-shell__nav"');
    expect(uiSource).not.toContain('Launch deck');
    expect(uiSource).not.toContain('Single-route workspace');
    expect(stageSource).toContain('className="stims-shell__stage-frame"');
    expect(stageControlsSource).toContain('className={styles.toolbar}');
    expect(stageControlsSource).toContain('title="Surprise me"');
    expect(homeSource).toContain('Explore presets');
    expect(audioSourcePanelSource).toContain('YouTube playback');
    expect(audioSourcePanelSource).toContain('Live mic input');
    expect(audioSourcePanelSource).toContain('Audio from this browser tab');
    expect(browseSource).toContain('const BATCH_SIZE = 30;');
    expect(browseSource).toContain('visible.map');
    expect(browseSource).toContain('Show more');
  });

  test('renders SidePanel when routeState.panel is not null', () => {
    const appSource = readFileSync(
      join(import.meta.dir, '..', 'assets', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );
    expect(appSource).toContain('<SidePanel');
    expect(appSource).toContain('open={ui.routeState.panel !== null');
  });

  test('keeps live stage controls above the render canvas', () => {
    const stageControlsCss = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'StageControls.module.css'),
      'utf8',
    );

    expect(stageControlsCss).toMatch(
      /\.wrap\s*\{[\s\S]*?z-index:\s*var\(--z-dock\);/u,
    );
  });

  test('keeps live mode low chrome around the visualizer', () => {
    const shellCss = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'app-shell.css'),
      'utf8',
    );
    const sidePanelCss = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'SidePanel.module.css'),
      'utf8',
    );

    expect(shellCss).toMatch(
      /\.stims-shell__stage-frame\[data-mode="live"\]\s*\{[\s\S]*?border:\s*0;/u,
    );
    expect(shellCss).toMatch(
      /\.stims-shell__stage-frame\[data-mode="live"\]\s*\{[\s\S]*?box-shadow:\s*none;/u,
    );
    expect(shellCss).toMatch(
      /\.stims-shell__stage-frame\[data-mode="live"\]::before,\s*\.stims-shell__stage-frame\[data-mode="live"\]::after\s*\{[\s\S]*?display:\s*none;/u,
    );
    expect(sidePanelCss).toMatch(
      /\.panel\s*\{[\s\S]*?background:\s*rgba\(10,\s*14,\s*22,\s*0\.97\);/u,
    );
    expect(sidePanelCss).toMatch(
      /\.backdrop\s*\{[\s\S]*?background:\s*rgba\(0,\s*0,\s*0,\s*0\.3\);/u,
    );
  });
});
