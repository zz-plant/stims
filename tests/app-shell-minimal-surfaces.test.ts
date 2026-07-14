import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function frontendSource(file: string) {
  return readFileSync(
    join(import.meta.dir, '..', 'assets', 'js', 'frontend', file),
    'utf8',
  );
}

function cssSource(file: string) {
  return readFileSync(
    join(import.meta.dir, '..', 'assets', 'css', file),
    'utf8',
  );
}

describe('minimal workspace surfaces', () => {
  test('keeps browse copy and controls terse', () => {
    const browse = frontendSource('BrowseSheetPanel.tsx');

    expect(browse).toContain('<strong>Browse presets</strong>');
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

    expect(settings).toContain('Quality profile');
    expect(settings).toContain('<strong>Stability mode</strong>');
    expect(settings).toContain('<strong>Motion control</strong>');
    expect(settings).not.toContain('Choose a specific quality profile');
    expect(settings).not.toContain(
      'Stability mode for older or unstable devices',
    );
    expect(settings).not.toContain(
      'Let phone or tablet movement affect visuals',
    );
    expect(settings).not.toContain('Force WebGPU enables WebGPU');
  });

  test('keeps live controls and preset cards low chrome', () => {
    const controls = frontendSource('StageControls.tsx');
    const css = cssSource('app-shell.css');
    const artwork = frontendSource('PresetArtwork.tsx');

    expect(controls).toContain('className={styles.toolbar}');
    expect(controls).toContain('className={styles.btn}');
    expect(artwork).not.toContain('stims-shell__preset-art-caption');
    expect(artwork).not.toContain('stims-shell__preset-art-status');
    expect(artwork).not.toContain('stims-shell__preset-art-grid');
    expect(artwork).not.toContain('stims-shell__preset-art-orbit');
    expect(artwork).not.toContain('stims-shell__preset-art-core');
    expect(css).toMatch(
      /\.stims-shell__starter-card\s*\{[\s\S]*?padding:\s*10px;[\s\S]*?box-shadow:\s*none;/u,
    );
    expect(css).toMatch(
      /\.stims-shell__preset-card\s*\{[\s\S]*?padding:\s*10px;[\s\S]*?box-shadow:\s*none;/u,
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
    expect(cssSource('app-shell.css')).toMatch(
      /\.stims-shell__sheet-panel--browse\s+\.stims-shell__preset-card\s+\.stims-shell__preset-art\s*\{[\s\S]*?min-height:\s*150px;/u,
    );
  });
});
