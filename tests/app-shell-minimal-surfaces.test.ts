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

    expect(controls).toContain('className={styles.toolbar}');
    expect(controls).toContain('className={styles.btn}');
    expect(css).toMatch(
      /\.stims-shell__starter-card\s*\{[\s\S]*?padding:\s*10px;[\s\S]*?box-shadow:\s*none;/u,
    );
    expect(css).toMatch(
      /\.stims-shell__preset-card\s*\{[\s\S]*?padding:\s*10px;[\s\S]*?box-shadow:\s*none;/u,
    );
  });
});
