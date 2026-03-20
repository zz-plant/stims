import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Preflight mobile visibility regression', () => {
  test('does not hide the preflight dialog when preflight-open rules hide floating chrome', () => {
    const css = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'base.css'),
      'utf8',
    );

    expect(css).toMatch(
      /:root\[data-preflight-open="true"\]\s+\.control-panel--floating:not\(\.preflight-panel\),/,
    );
    expect(css).toMatch(
      /\.preflight-panel\.control-panel--floating\s*\{\s*left:\s*50%;/,
    );
  });
});
