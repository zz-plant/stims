/**
 * Structural guards for the mobile shell layout.
 *
 * These used to pin exact declarations — `padding: 112px 10px 18px`,
 * `clamp(3rem, 7vw, 5rem)`, `repeat(2, minmax(0, 1fr))` — which broke on any
 * restyle while never verifying that the layout actually worked. The cosmetic
 * values are gone; what remains asserts the structural decisions that carry
 * meaning (a breakpoint exists, a rail collapses, a fallback is present).
 *
 * The behaviour itself — no sideways overflow, the stage filling the viewport,
 * the panel docking as a bottom sheet — is verified against a real browser in
 * tests/e2e/chrome-visual-contract.test.ts, which catches the layout being
 * broken rather than merely being written differently.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readAppShellCss() {
  return readFileSync(
    join(import.meta.dir, '..', '..', 'src', 'css', 'app-shell.css'),
    'utf8',
  );
}

/** Does `declaration` appear inside a block for `selector` under `query`? */
function hasRuleInQuery(
  css: string,
  query: string,
  selector: string,
  declaration: string,
) {
  const quote = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `${quote(query)}[\\s\\S]*?${quote(selector)}[^{]*\\{[^}]*?${quote(declaration)}`,
    'u',
  );
  return re.test(css);
}

describe('Workspace shell mobile layout regression', () => {
  test('lets the home page scroll instead of trapping it at viewport height', () => {
    const css = readAppShellCss();

    // The workspace document must be allowed to grow; a fixed-height body is
    // what clipped the home content on phones.
    expect(css).toMatch(
      /body\[data-page="workspace"\]\s*\{[\s\S]*?height:\s*auto;/u,
    );
    expect(
      hasRuleInQuery(
        css,
        '@media (max-width: 720px)',
        '.stims-shell__stage-frame[data-mode="home"]',
        'overflow: visible',
      ),
    ).toBe(true);
  });

  test('sizes the mounted visualizer canvas to the stage frame, not the viewport', () => {
    const css = readAppShellCss();

    expect(css).toMatch(
      /\.stims-shell__stage-root\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/u,
    );
    expect(css).toMatch(
      /\.stims-shell__stage-root > canvas\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/u,
    );
  });

  test('collapses the launch layout to a single column on narrow viewports', () => {
    const css = readAppShellCss();

    expect(
      hasRuleInQuery(
        css,
        '@media (max-width: 1120px)',
        '.stims-shell__launch-layout',
        'flex-direction: column',
      ),
    ).toBe(true);
    // The rail dissolves into the parent flow rather than becoming a column.
    expect(
      hasRuleInQuery(
        css,
        '@media (max-width: 1120px)',
        '.stims-shell__launch-rail',
        'display: contents',
      ),
    ).toBe(true);
    expect(
      hasRuleInQuery(
        css,
        '@media (max-width: 1120px)',
        '.stims-shell__launch-hero',
        'grid-template-columns: 1fr',
      ),
    ).toBe(true);
    // The recommendation card is optional chrome; it goes on the smallest screens.
    expect(
      hasRuleInQuery(
        css,
        '@media (max-width: 480px)',
        '.stims-shell__launch-recommendation',
        'display: none',
      ),
    ).toBe(true);
  });

  test('keeps the stage usable on short landscape viewports', () => {
    const css = readAppShellCss();

    // Height-based breakpoints exist so landscape phones do not get a stage
    // taller than the screen with no way to scroll the hero.
    expect(css).toMatch(/@media \(max-height: 720px\)/u);
    expect(
      hasRuleInQuery(
        css,
        '@media (max-height: 720px)',
        '.stims-shell__stage-hero',
        'overflow-y: auto',
      ),
    ).toBe(true);
  });

  test('keeps a fallback for browsers without color-mix', () => {
    const css = readAppShellCss();

    expect(css).toMatch(
      /@supports not \(color: color-mix\(in srgb, white, black\)\) \{[\s\S]*?\.stims-shell \.cta-button\.primary/u,
    );
  });
});
