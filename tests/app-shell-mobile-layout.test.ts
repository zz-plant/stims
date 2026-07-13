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
      /html:has\(body\[data-page="workspace"\]\),\s*body\[data-page="workspace"\]\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow-y:\s*auto;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__stage-frame\[data-mode="home"\]\s*\{[\s\S]*?min-height:\s*auto;[\s\S]*?overflow:\s*visible;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__stage-frame\[data-mode="home"\] \.stims-shell__stage-hero\s*\{[\s\S]*?position:\s*relative;[\s\S]*?inset:\s*auto;[\s\S]*?padding:\s*112px 10px 18px;/u,
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

  test('keeps supporting cards compact and secondary actions side-by-side on phones', () => {
    const css = readAppShellCss();

    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.stims-shell__launch-actions\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/u,
    );
    expect(css).not.toContain('.stims-shell__launch-actions > :first-child');
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
      /@media \(max-width: 1120px\)[\s\S]*?\.stims-shell__launch-hero\s*\{[\s\S]*?grid-template-columns:\s*1fr;/u,
    );
    expect(css).toMatch(
      /@media \(max-width: 1120px\)[\s\S]*?\.stims-shell__launch-recommendation\s*\{[\s\S]*?min-height:\s*0;/u,
    );
  });

  test('adds compatibility fallbacks for older mobile browser CSS support', () => {
    const css = readAppShellCss();

    expect(css).toMatch(
      /@supports not \(color: color-mix\(in srgb, white, black\)\) \{[\s\S]*?\.stims-shell \.cta-button\.primary/u,
    );
  });
});
