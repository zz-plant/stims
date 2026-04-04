import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell mobile layout regression', () => {
  test('keeps the stage ahead of the launch setup and compresses supporting cards on phones', () => {
    const css = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__workspace\s*\{\s*order:\s*1;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__launch\s*\{\s*order:\s*2;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__launch-actions > :first-child\s*\{\s*grid-column:\s*1 \/ -1;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__readiness-chips\s*\{\s*flex-wrap:\s*nowrap;[\s\S]*?overflow-x:\s*auto;/u,
    );
  });
});
