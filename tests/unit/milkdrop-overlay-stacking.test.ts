import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function extractZIndex(css: string, selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockPattern = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'm');
  const blockMatch = css.match(blockPattern);
  expect(blockMatch).not.toBeNull();

  const zIndexMatch = blockMatch?.[1].match(/z-index:\s*([^;]+)\s*;/);
  expect(zIndexMatch).not.toBeNull();

  const rawValue = zIndexMatch?.[1].trim() ?? '0';
  const tokenMatch = rawValue.match(/^var\((--[-\w]+)\)$/);
  if (tokenMatch) {
    const tokenPattern = new RegExp(`${tokenMatch[1]}:\\s*(\\d+)\\s*;`);
    const tokenValueMatch = css.match(tokenPattern);
    expect(tokenValueMatch).not.toBeNull();
    return Number.parseInt(tokenValueMatch?.[1] ?? '0', 10);
  }

  return Number.parseInt(rawValue, 10);
}

describe('MilkDrop overlay stacking', () => {
  test('keeps the preset overlay above the toy nav and floating control panels', () => {
    const css = [
      readFileSync(
        join(import.meta.dir, '..', '..', 'assets', 'css', 'tokens.css'),
        'utf8',
      ),
      readFileSync(
        join(import.meta.dir, '..', '..', 'assets', 'css', 'base.css'),
        'utf8',
      ),
    ].join('\n');

    const overlayZIndex = extractZIndex(css, '.milkdrop-overlay');
    const toyNavZIndex = extractZIndex(css, '.active-toy-nav');
    const controlPanelZIndex = extractZIndex(css, '.control-panel');

    expect(overlayZIndex).toBeGreaterThan(toyNavZIndex);
    expect(overlayZIndex).toBeGreaterThan(controlPanelZIndex);
  });
});
