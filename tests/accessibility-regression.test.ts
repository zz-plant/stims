import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readSource(...segments: string[]) {
  return readFileSync(
    join(import.meta.dir, '..', 'assets', 'js', ...segments),
    'utf8',
  );
}

describe('Accessibility regression guards', () => {
  test('panel toggle buttons expose expanded state, not pressed', () => {
    const dock = readSource('frontend', 'StimsControlDock.tsx');
    const mobile = readSource('frontend', 'MobileControlBar.tsx');

    for (const source of [dock, mobile]) {
      expect(source).toContain('aria-expanded={panel === ');
      expect(source).not.toContain('aria-pressed={panel === ');
    }
  });

  test('skip link uses class styles, not inline dimensions', () => {
    const app = readSource('frontend', 'App.tsx');

    expect(app).toMatch(/<a\s+href="#stims-main"\s+className="skip-link">/u);
    expect(app).not.toMatch(/skip-link"[\s\S]*?style=\{\{/u);
  });

  test('keyboard shortcuts dialog traps focus and auto-focuses', () => {
    const app = readSource('frontend', 'App.tsx');

    expect(app).toContain('shortcutsRef');
    expect(app).toContain("e.key === 'Tab'");
    expect(app).toContain('focusable[0]?.focus()');
  });

  test('milkdrop overlay controls have accessible names', () => {
    const overlay = readSource('milkdrop', 'overlay.ts');

    expect(overlay).toContain("'aria-label', 'Transition mode'");
    expect(overlay).toContain('Play previous preset');
    expect(overlay).toContain('Play next preset');
  });

  test('milkdrop preset rows expose current and load labels', () => {
    const presetRow = readSource('milkdrop', 'overlay', 'preset-row.ts');

    expect(presetRow).toContain('aria-label');
    expect(presetRow).toContain('Load preset');
    expect(presetRow).toContain("row.setAttribute('aria-current', 'true')");
  });

  test('audio setup surface announces loading state', () => {
    const home = readSource('frontend', 'NewHomePage.tsx');

    expect(home).toContain('aria-live="polite"');
    expect(home).toContain('Starting audio input…');
  });
});
