import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readAppShellCss() {
  return readFileSync(
    join(import.meta.dir, '..', 'assets', 'css', 'app-shell.css'),
    'utf8',
  );
}

describe('Workspace shell mobile layout regression', () => {
  test('turns the home state into a stage-first hero on phones', () => {
    const css = readAppShellCss();

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
    const css = readAppShellCss();

    expect(css).toMatch(
      /\.stims-shell__stage-root\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/u,
    );
    expect(css).toMatch(
      /\.stims-shell__stage-root > canvas\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/u,
    );
  });

  test('keeps supporting cards compact and horizontally scannable on phones', () => {
    const css = readAppShellCss();

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

  test('keeps the launch panel usable on short desktop and landscape viewports', () => {
    const css = readAppShellCss();

    expect(css).toMatch(
      /@media \(max-height: 720px\)[\s\S]*?\.stims-shell__stage-frame,\s*\.stims-shell__stage-frame\[data-mode="home"\]\s*\{[\s\S]*?min-height:\s*calc\(100vh - 28px\);/u,
    );
    expect(css).toMatch(
      /@media \(max-height: 720px\)[\s\S]*?\.stims-shell__stage-hero\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?overscroll-behavior:\s*contain;/u,
    );
    expect(css).toMatch(
      /@media \(max-height: 480px\)[\s\S]*?\.stims-shell__stage-frame,\s*\.stims-shell__stage-frame\[data-mode="home"\]\s*\{[\s\S]*?min-height:\s*calc\(100vh - 20px\);/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 1120px\)[\s\S]*?\.stims-shell__launch-hero,[\s\S]*?\.stims-shell__source-grid,[\s\S]*?\.stims-shell__launch-recommendation\s*\{[\s\S]*?grid-template-columns:\s*1fr;/u,
    );
  });

  test('adds compatibility fallbacks for older mobile browser CSS support', () => {
    const css = readAppShellCss();

    expect(css).toContain('-webkit-backdrop-filter: blur(24px);');
    expect(css).toContain('-webkit-mask-image: radial-gradient(');
    expect(css).toMatch(
      /@supports not \(color: color-mix\(in srgb, white, black\)\) \{[\s\S]*?\.stims-shell \.cta-button\.primary/u,
    );
  });
});
