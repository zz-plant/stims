import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function extractZIndex(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockPattern = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'm');
  const blockMatch = css.match(blockPattern);
  expect(blockMatch).not.toBeNull();

  const zIndexMatch = blockMatch?.[1].match(/z-index:\s*(\d+)\s*;/);
  expect(zIndexMatch).not.toBeNull();

  return Number.parseInt(zIndexMatch?.[1] ?? '0', 10);
}

describe('MilkDrop overlay stacking', () => {
  test('keeps the preset overlay above the toy nav and floating control panels', () => {
    const css = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'base.css'),
      'utf8',
    );

    const overlayZIndex = extractZIndex(css, '.milkdrop-overlay');
    const toyNavZIndex = extractZIndex(css, '.active-toy-nav');
    const controlPanelZIndex = extractZIndex(css, '.control-panel');

    expect(overlayZIndex).toBeGreaterThan(toyNavZIndex);
    expect(overlayZIndex).toBeGreaterThan(controlPanelZIndex);
  });
});
