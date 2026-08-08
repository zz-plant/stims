import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSource(...segments: string[]) {
  return readFileSync(
    join(import.meta.dir, '..', '..', 'src', 'js', ...segments),
    'utf8',
  );
}

describe('Accessibility regression guards', () => {
  test('panel toggle buttons expose expanded state, not pressed', () => {
    const controls = readSource('frontend', 'StageControls.tsx');

    expect(controls).toContain('aria-expanded={');
    expect(controls).not.toContain('aria-pressed={');
  });

  test('skip link uses class styles, not inline dimensions', () => {
    const app = readSource('frontend', 'App.tsx');

    expect(app).toMatch(
      /<a\s+href="#stims-visualizer"\s+className="skip-link">/u,
    );
    expect(app).not.toMatch(/skip-link"[\s\S]*?style=\{\{/u);
  });

  test('keyboard shortcuts dialog traps focus and auto-focuses', () => {
    const app = readSource('frontend', 'App.tsx');
    const shortcuts = readSource('frontend', 'ShortcutsDialog.tsx');

    expect(app).toContain('shortcutsRef');
    expect(shortcuts).toContain('useFocusTrap');
  });

  test('browse sheet controls have accessible names', () => {
    const browse = readSource('frontend', 'BrowseSheetPanel.tsx');

    expect(browse).toContain('aria-label="Search presets"');
    expect(browse).toContain('aria-label="Sort presets"');
    expect(browse).toContain('aria-label="Preset collections"');
  });

  test('milkdrop preset rows expose current and load labels', () => {
    const presetRow = readSource('milkdrop', 'overlay', 'preset-row.ts');

    expect(presetRow).toContain('aria-label');
    expect(presetRow).toContain('Load preset');
    expect(presetRow).toContain("row.setAttribute('aria-current', 'true')");
  });

  test('audio setup surface keeps source changes in a polite live region', () => {
    const audio = readSource('frontend', 'AudioSourcePanel.tsx');

    expect(audio).toContain('aria-live="polite"');
    expect(audio).toContain('YouTube playback');
  });
});
