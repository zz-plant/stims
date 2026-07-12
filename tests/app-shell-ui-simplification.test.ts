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
      'Choose a quality preset, then adjust performance and motion options.',
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
    expect(browseSource).toContain('const BROWSE_RESULT_BATCH_SIZE = 24;');
    expect(browseSource).toContain('visibleBrowseEntries.map');
    expect(browseSource).toContain('Show more presets');
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

  test('opens browse in the full bottom sheet so filtered results are visible', () => {
    const appSource = readFileSync(
      join(import.meta.dir, '..', 'assets', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );

    expect(appSource).toContain(
      "defaultSnapPoint={ui.routeState.panel === 'browse' ? 'full' : 'compact'}",
    );
  });

  test('scrolls filtered browse results into view inside the sheet', () => {
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
    const shellCss = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(browseSource).toContain('resultsSectionRef');
    expect(browseSource).toContain('scrollIntoView');
    expect(browseSource).toContain('findScrollableAncestor');
    expect(browseSource).toContain('scrollTo');
    expect(browseSource).toContain('data-filter-active');
    expect(browseSource).toContain('hasActiveBrowseFilter');
    expect(shellCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__sheet-panel--browse\[data-filter-active="true"\]\s*\.stims-shell__browse-toolbar[\s\S]*?display:\s*none;/u,
    );
  });

  test('keeps live stage controls above the render canvas', () => {
    const shellCss = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(shellCss).toMatch(
      /\.stims-shell__stage-dock-wrap\s*\{[\s\S]*?z-index:\s*var\(--z-frame-chrome\);/u,
    );
    expect(shellCss).toMatch(
      /\.stims-shell__stage-dock\s*\{[\s\S]*?z-index:\s*var\(--z-frame-chrome\);/u,
    );
    expect(shellCss).toMatch(
      /\.stims-shell__stage-dock-wrap\[data-visible="false"\]\s*\{[\s\S]*?visibility:\s*hidden;/u,
    );
    expect(shellCss).toMatch(
      /\.stims-shell__stage-dock-wrap\[data-visible="true"\]\s*\{[\s\S]*?visibility:\s*visible;/u,
    );
    expect(shellCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__sheet-panel--browse \.stims-shell__sheet-surface--sticky\s*\{[\s\S]*?position:\s*static;/u,
    );
  });

  test('keeps live mode low chrome around the visualizer', () => {
    const shellCss = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'app-shell.css'),
      'utf8',
    );
    const bottomSheetCss = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'BottomSheet.module.css'),
      'utf8',
    );
    const mobileControlCss = readFileSync(
      join(
        import.meta.dir,
        '..',
        'assets',
        'css',
        'MobileControlBar.module.css',
      ),
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
    expect(shellCss).toMatch(
      /\.stims-shell__stage-frame\[data-mode="live"\] \.stims-shell__corner-brand\s*\{[\s\S]*?display:\s*none;/u,
    );
    expect(shellCss).toMatch(
      /\.stims-shell__stage-frame\[data-mode="live"\] \.stims-shell__stage-dock\s*\{[\s\S]*?background:\s*rgba\(5,\s*8,\s*14,\s*0\.2\);/u,
    );
    expect(shellCss).toMatch(
      /\.stims-shell__stage-frame\[data-mode="live"\]\s*\.stims-shell__stage-root,\s*\.stims-shell__stage-frame\[data-mode="live"\]\s*\.stims-shell__stage-root\s*>\s*canvas\s*\{[\s\S]*?pointer-events:\s*none;/u,
    );
    expect(bottomSheetCss).toMatch(
      /\.sheet\s*\{[\s\S]*?background:\s*color-mix\(\s*in srgb,\s*var\(--stims-panel-fill-strong\) 72%,\s*transparent\s*\);/u,
    );
    expect(bottomSheetCss).toMatch(
      /\.backdrop\s*\{[\s\S]*?background:\s*rgba\(0,\s*0,\s*0,\s*0\.22\);/u,
    );
    expect(mobileControlCss).toMatch(
      /\.bar\s*\{[\s\S]*?rgba\(5,\s*7,\s*13,\s*0\.64\)/u,
    );
    expect(mobileControlCss).toMatch(
      /\.actionLabel\s*\{[\s\S]*?display:\s*none;/u,
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
    expect(dockSource).toContain('pointerInsideDock');
    expect(dockSource).toContain('onPointerEnter');
    expect(dockSource).toContain('onPointerLeave');
  });
});
