import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell mobile layout regression', () => {
  test('keeps the launch setup ahead of playback on phones until the session is live', () => {
    const css = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__launch\s*\{\s*order:\s*1;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__workspace\s*\{\s*order:\s*2;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?:root\[data-focused-session="live"\][\s\S]*?\.stims-shell__workspace\s*\{\s*order:\s*1;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?:root\[data-focused-session="live"\][\s\S]*?\.stims-shell__launch\s*\{\s*order:\s*2;/u,
    );
  });

  test('sizes the mounted visualizer canvas to the stage frame instead of the viewport', () => {
    const css = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(css).toMatch(
      /\.stims-shell__stage-root > canvas\s*\{[\s\S]*?width:\s*100%\s*!important;[\s\S]*?height:\s*100%\s*!important;/u,
    );
  });

  test('keeps supporting cards compact and horizontally scannable on phones', () => {
    const css = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__launch-actions > :first-child\s*\{\s*grid-column:\s*1 \/ -1;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__readiness-chips\s*\{\s*flex-wrap:\s*nowrap;[\s\S]*?overflow-x:\s*auto;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__starter-grid\s*\{\s*grid-template-columns:\s*1fr;/u,
    );
  });
});
