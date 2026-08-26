import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the layering contract expressed by the --z-* tokens.
 *
 * This used to compare z-index literals inside `.milkdrop-overlay`,
 * `.active-toy-nav` and `.control-panel` blocks in base.css. Two of those
 * classes are no longer applied by anything — the overlay UI was folded into
 * the React shell (c1f46145, 97ebda7a) — so the test was asserting the stacking
 * order of surfaces that never render. The shell now layers through the token
 * scale, so that is what is worth pinning: relative order, not literal values.
 */
function readTokenScale() {
  const tokens = readFileSync(
    join(import.meta.dir, '..', '..', 'src', 'css', 'tokens.css'),
    'utf8',
  );
  const scale = new Map<string, number>();
  for (const match of tokens.matchAll(/(--z-[\w-]+):\s*(-?\d+)\s*;/g)) {
    scale.set(match[1] as string, Number.parseInt(match[2] as string, 10));
  }
  return scale;
}

function z(scale: Map<string, number>, name: string) {
  const value = scale.get(name);
  if (value === undefined) {
    throw new Error(`Missing z-index token ${name} in tokens.css`);
  }
  return value;
}

describe('shell stacking order', () => {
  const scale = readTokenScale();

  test('stacks stage below chrome, chrome below transient surfaces', () => {
    // The stage is the backdrop; everything interactive sits above it.
    expect(z(scale, '--z-stage-root')).toBeGreaterThan(z(scale, '--z-ambient'));
    expect(z(scale, '--z-stage-hero')).toBeGreaterThan(
      z(scale, '--z-stage-root'),
    );
    expect(z(scale, '--z-nav')).toBeGreaterThan(z(scale, '--z-frame-chrome'));
    expect(z(scale, '--z-dock')).toBeGreaterThan(z(scale, '--z-nav'));
  });

  test('keeps notifications and modals above the dock they interrupt', () => {
    expect(z(scale, '--z-toast')).toBeGreaterThan(z(scale, '--z-dock'));
    expect(z(scale, '--z-alert')).toBeGreaterThan(z(scale, '--z-toast'));
    expect(z(scale, '--z-modal')).toBeGreaterThan(
      z(scale, '--z-modal-backdrop'),
    );
    expect(z(scale, '--z-modal-backdrop')).toBeGreaterThan(
      z(scale, '--z-alert'),
    );
  });

  test('puts sheets above the panels and docks they cover', () => {
    expect(z(scale, '--z-sheet')).toBeGreaterThan(z(scale, '--z-panel'));
    expect(z(scale, '--z-sheet')).toBeGreaterThan(z(scale, '--z-dock'));
    expect(z(scale, '--z-sheet-active')).toBeGreaterThan(z(scale, '--z-sheet'));
  });

  test('reserves the top of the scale for the shortcuts overlay', () => {
    // The shortcuts overlay explains the UI, so nothing in the normal chrome
    // may cover it.
    for (const name of ['--z-dock', '--z-toast', '--z-alert', '--z-modal']) {
      expect(z(scale, '--z-shortcut-overlay')).toBeGreaterThan(z(scale, name));
    }
  });
});
