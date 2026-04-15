import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Workspace shell mobile layout regression', () => {
  test('turns the home state into a stage-first hero on phones', () => {
    const css = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(css).toMatch(
      /\.stims-shell__workspace\[data-mode="home"\]\s*\{[\s\S]*?padding:\s*0;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__stage-frame\[data-mode="home"\]\s*\{[\s\S]*?min-height:\s*88svh;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__stage-hero\s*\{[\s\S]*?inset:\s*352px 10px 18px;[\s\S]*?align-content:\s*start;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__frame-chrome\s*\{[\s\S]*?flex-direction:\s*column;[\s\S]*?align-items:\s*stretch;/u,
    );
  });

  test('sizes the mounted visualizer canvas to the stage frame instead of the viewport', () => {
    const css = readFileSync(
      join(import.meta.dir, '..', 'assets', 'css', 'app-shell.css'),
      'utf8',
    );

    expect(css).toMatch(
      /\.stims-shell__stage-root\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/u,
    );
    expect(css).toMatch(
      /\.stims-shell__stage-root > canvas\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/u,
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
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__launch-panel\s*\{[\s\S]*?width:\s*min\(100%, calc\(100vw - 20px\)\);/u,
    );
  });
});
