import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell UI simplification regression', () => {
  test('keeps the shell copy lean around launch, presets, and tuning', () => {
    const appSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );
    const uiSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
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
        '..',
        'src',
        'js',
        'frontend',
        'workspace-helpers.ts',
      ),
      'utf8',
    );
    const stageSource = readFileSync(
      join(
        import.meta.dir,
        '..',
        '..',
        'src',
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
        '..',
        'src',
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
        '..',
        'src',
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
        '..',
        'src',
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
        '..',
        'src',
        'js',
        'frontend',
        'NewHomePage.tsx',
      ),
      'utf8',
    );
    expect(helperSource).toContain(
      'Choose a quality preset, then adjust performance and motion options.',
    );
    // The boot-time "lighter graphics mode" toast this used to check for
    // lean copy was removed entirely in 6f8db66c ("drop boot backend
    // toast") — there's no copy left to assert here. Coverage for that
    // decision now lives in app-shell-toast-regression.test.ts.
    expect(stageSource).toContain('Now playing:');
    expect(appSource).not.toContain('className="top-nav stims-shell__nav"');
    expect(uiSource).not.toContain('Launch deck');
    expect(uiSource).not.toContain('Single-route workspace');
    expect(stageSource).toContain('className="stims-shell__stage-frame"');
    expect(stageControlsSource).toContain('className={styles.pill}');
    // The copy is unchanged; the tooltip now appends the current keyboard
    // shortcut through withHint(), so the literal is no longer adjacent to
    // the title= attribute.
    expect(stageControlsSource).toContain("withHint('Surprise me'");
    expect(uiSource).toContain('liveMode && !missingRequestedPreset ?');
    expect(homeSource).toContain('Browse presets');
    // The four source cards each keep one short line of copy saying what the
    // source is. The wording changed when the cards were rebuilt around a
    // leading icon (the uppercase kicker labels and the decorative shader
    // identicons went with it), so these assert the current lines.
    expect(audioSourcePanelSource).toContain('No permission needed');
    expect(audioSourcePanelSource).toContain('Whatever is playing in the room');
    expect(audioSourcePanelSource).toContain(
      'Audio playing in this browser tab',
    );
    // The section heading names the whole section, never one of its children.
    expect(audioSourcePanelSource).not.toContain(
      "canCaptureDisplayAudio ? 'YouTube playback' : 'Audio source'",
    );
    // Browse used to paginate in batches of 30 behind a "Show N more"
    // button; both views are virtualized now, so the batch constant, the
    // `visible` slice and that button are all gone. The contract that
    // replaced them is that the result set is windowed rather than paged —
    // asserted properly against rendered output in preset-grid.test.tsx,
    // and guarded here only against the paging UI creeping back.
    expect(browseSource).not.toContain('BATCH_SIZE');
    expect(browseSource).not.toContain('hiddenCount');
    expect(browseSource).toContain('useVirtualizer');
    expect(browseSource).toContain("import { UiIcon } from './UiIcon.tsx';");
    expect(browseSource).toContain('aria-label="Shuffle presets"');
  });

  test('renders SidePanel when routeState.panel is not null', () => {
    const appSource = readFileSync(
      join(import.meta.dir, '..', '..', 'src', 'js', 'frontend', 'App.tsx'),
      'utf8',
    );
    expect(appSource).toContain('<SidePanel');
    expect(appSource).toContain('open={ui.routeState.panel !== null');
  });
});
