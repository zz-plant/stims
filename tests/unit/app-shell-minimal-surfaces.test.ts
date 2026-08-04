import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function frontendSource(file: string) {
  return readFileSync(
    join(import.meta.dir, '..', '..', 'src', 'js', 'frontend', file),
    'utf8',
  );
}

function cssSource(file: string) {
  return readFileSync(
    join(import.meta.dir, '..', '..', 'src', 'css', file),
    'utf8',
  );
}

describe('minimal workspace surfaces', () => {
  test('keeps browse copy and controls terse', () => {
    const browse = frontendSource('BrowseSheetPanel.tsx');

    expect(browse).toContain('aria-label="Search presets"');
    expect(browse).not.toContain('Tap any card to load it on the stage.');
    expect(browse).not.toContain('Find similar to current look');
    expect(browse).not.toContain('Long-press cards to build');
    expect(browse).not.toContain('formatPresetSupportNote');
    expect(browse).not.toContain('stims-shell__preset-tech-badges');
  });

  test('keeps audio source setup compact', () => {
    const audio = frontendSource('AudioSourcePanel.tsx');

    expect(audio).toContain('Audio help');
    expect(audio).toContain("'Load'");
    expect(audio).not.toContain('Browser permission required');
    expect(audio).not.toContain('Pick “This tab”');
    expect(audio).not.toContain('Chrome-based browsers work best');
  });

  test('keeps settings labels utilitarian', () => {
    const settings = frontendSource('SettingsSheetPanel.tsx');

    // Every quality preset is offered once, described in its own words rather
    // than by the render numbers, which sit alongside as a secondary readout.
    expect(settings).toContain('getSettingsPresetOptions()');
    expect(settings).not.toContain('.slice(0, 3)');
    expect(settings).toContain('{preset.description}');
    expect(settings).toContain('ctl-readout');

    // Booleans are switches; the renderer is one select, not a select plus a
    // duplicate "stability mode" toggle writing the same state.
    expect(settings).toContain('label="Motion control"');
    expect(settings).toContain('ctl-switch');
    expect(settings).not.toContain('Stability mode');

    expect(settings).not.toContain('Choose a specific quality profile');
    expect(settings).not.toContain(
      'Stability mode for older or unstable devices',
    );
    expect(settings).not.toContain(
      'Let phone or tablet movement affect visuals',
    );
    expect(settings).not.toContain('Force WebGPU enables WebGPU');
  });

  test('sizes checkboxes as glyphs, not stretched bars', () => {
    const css = cssSource('app-shell.css');

    // A blanket min-height on `input` stretches checkboxes to 18x44; the touch
    // target belongs to the label that wraps them.
    expect(css).toMatch(
      /input:not\(\[type="checkbox"\], \[type="radio"\]\),\s*\n\s*select \{\s*\n\s*min-height:/u,
    );
    expect(css).not.toMatch(
      /\n\s{2}button,\n\s{2}a,\n\s{2}input,\n\s{2}select \{/u,
    );
  });

  test('keeps live controls and preset cards low chrome', () => {
    const controls = frontendSource('StageControls.tsx');
    const css = cssSource('app-shell.css');
    const artwork = frontendSource('PresetArtwork.tsx');

    expect(controls).toContain('className={styles.pill}');
    expect(controls).toContain('className={styles.navBtn}');
    expect(artwork).not.toContain('stims-shell__preset-art-caption');
    expect(artwork).not.toContain('stims-shell__preset-art-status');
    expect(artwork).not.toContain('stims-shell__preset-art-grid');
    expect(artwork).not.toContain('stims-shell__preset-art-orbit');
    expect(artwork).not.toContain('stims-shell__preset-art-core');
    expect(css).toMatch(
      /\.stims-shell__starter-card\s*\{[\s\S]*?padding:\s*10px;[\s\S]*?box-shadow:\s*none;/u,
    );
    expect(cssSource('chrome.css')).toMatch(
      /\.ctl-preset \{[\s\S]*?border-radius: var\(--ctl-radius\);/u,
    );
    expect(css).toMatch(
      /\.stims-shell__launch-source-dock\s*\{[\s\S]*?padding:\s*0;[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?box-shadow:\s*none;/u,
    );
    expect(css).toMatch(
      /\.stims-shell__launch-source-dock\s+\.stims-shell__source-card\s+\+\s+\.stims-shell__source-card\s*\{[\s\S]*?border-left:/u,
    );
    expect(css).toMatch(
      /\.stims-shell__launch-recommendation\s+\.stims-shell__preset-art\s*\{[\s\S]*?width:\s*104px;[\s\S]*?min-height:\s*64px;[\s\S]*?aspect-ratio:\s*16\s*\/\s*9;/u,
    );
  });

  test('gives the preset browser room to behave like a visual catalog', () => {
    const browse = frontendSource('BrowseSheetPanel.tsx');
    const sidePanel = cssSource('SidePanel.module.css');

    expect(browse).toContain('{hasFilter ? (');
    expect(sidePanel).toMatch(
      /@media \(min-width: 768px\)[\s\S]*?\.panel\s*\{[\s\S]*?width:\s*min\(560px, calc\(100vw - 32px\)\);/u,
    );

    const chrome = cssSource('chrome.css');
    // Rows are scannable: fixed-ratio thumbnail, one line of title, one of
    // meta — so a 560px panel lists presets instead of paging through cards.
    expect(chrome).toMatch(
      /\.ctl-preset__art \{[\s\S]*?width: 56px;[\s\S]*?height: 36px;/u,
    );
    expect(chrome).toMatch(
      /\.ctl-preset__title \{[\s\S]*?white-space: nowrap;/u,
    );
    // Filters stay reachable while the list scrolls.
    expect(chrome).toMatch(/\.ctl-browse-filters \{[\s\S]*?position: sticky;/u);
  });

  test('keeps light theme shell text and surfaces contrast-safe', () => {
    const tokens = cssSource('tokens.css');
    const css = cssSource('shell-theme.css');
    const sidePanel = cssSource('SidePanel.module.css');
    const sidePanelSource = frontendSource('SidePanel.tsx');

    expect(tokens).toContain('--stims-muted: #42525c;');
    expect(tokens).toContain('--stims-cool: #0d6381;');
    expect(tokens).toContain('--stims-accent: #a44723;');
    expect(css).toContain(
      'html.light .stims-shell__stage-frame[data-mode="home"]',
    );
    expect(css).toContain('html.light [data-shell-dialog="true"]');
    expect(css).toContain('@media (forced-colors: active)');
    expect(sidePanelSource).toContain('data-shell-dialog="true"');
    // The panel follows the theme now, but still resolves to the same opaque
    // dark fill when the chrome tokens are unavailable.
    expect(sidePanel).toContain(
      'background: var(--ctl-panel-bg, rgba(10, 14, 22, 0.97));',
    );
    expect(cssSource('chrome.css')).toMatch(
      /html\.light \.stims-shell \{[\s\S]*?--ctl-panel-bg:/u,
    );
  });

  test('loads late theme and launch layers after core shell styles', () => {
    const app = frontendSource('App.tsx');
    const core = app.indexOf("import '../../css/app-shell.css';");
    const theme = app.indexOf("import '../../css/shell-theme.css';");
    const launch = app.indexOf("import '../../css/shell-launch.css';");

    expect(core).toBeGreaterThanOrEqual(0);
    expect(theme).toBeGreaterThan(core);
    expect(launch).toBeGreaterThan(theme);
    expect(cssSource('shell-launch.css')).toContain('@scope (.stims-shell)');
  });
});
