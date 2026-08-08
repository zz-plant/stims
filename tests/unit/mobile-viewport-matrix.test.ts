/**
 * Mobile viewport edge-case matrix — encodes the invariants for each of
 * the ~9 mobile layout fixes that recurred in the last 400 commits, as CSS
 * structural assertions. The existing `app-shell-mobile-layout.test.ts`
 * checks broad structure; this matrix targets the specific edge cases:
 *
 *  - edge-to-edge fullscreen live visualizer on mobile (`a44e343d`)
 *  - viewport-safe stage (no height clipping) (`97961600`)
 *  - control dock visible during interactions (`23fa6efa`)
 *  - mobile controls visible during expanded actions (`3ca90ef8`)
 *  - workspace sidecar actions wrap (no horizontal overflow) (`5619d17a`)
 *  - safe-area-inset handled for notch devices
 *
 * Each test maps to a commit that broke and was fixed. If the CSS
 * regresses, the test that guards it fails by name.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readAppShellCss(): string {
  return readFileSync(
    join(import.meta.dir, '..', '..', 'src', 'css', 'app-shell.css'),
    'utf8',
  );
}

function ruleInMedia(
  css: string,
  media: string,
  selector: string,
  declaration: string,
): boolean {
  const quote = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `${quote(media)}[\\s\\S]*?${quote(selector)}[^{]*\\{[^}]*?${quote(declaration)}`,
    'u',
  );
  return re.test(css);
}

const MOBILE_MEDIA = '@media (max-width: 720px)';

describe('mobile viewport edge-case matrix', () => {
  test('live stage fills 100dvh on mobile (viewport-safe, 97961600)', () => {
    const css = readAppShellCss();
    // The live stage must not be clipped below the viewport — the bug
    // was a fixed/min height that left content unreachable on phones.
    expect(
      ruleInMedia(
        css,
        MOBILE_MEDIA,
        '.stims-shell__stage-frame[data-mode="live"]',
        'min-height: 100dvh',
      ),
    ).toBe(true);
  });

  test('live stage uses zero padding for edge-to-edge (a44e343d)', () => {
    const css = readAppShellCss();
    expect(
      ruleInMedia(
        css,
        MOBILE_MEDIA,
        '.stims-shell__workspace[data-mode="live"]',
        'padding: 0',
      ),
    ).toBe(true);
  });

  // Removed with the surfaces they guarded, both of which are applied by
  // nothing and whose rules were therefore deleted as dead CSS:
  //
  //  - 'control dock stays visible when a panel is open (23fa6efa)' pinned
  //    `.stims-shell__stage-dock-wrap[data-visible="true"]`. The dock is now
  //    StageControls.module.css, so its class names are build-time hashed and
  //    a global-stylesheet regex cannot see them.
  //  - 'mobile control offset expands with the action bar (3ca90ef8)' pinned
  //    `.mc-bar[data-expanded="true"]` raising --mobile-control-offset. There is
  //    no expanding action bar any more: StageControls renders an absolutely
  //    positioned menu that does not displace the controls, so nothing needs to
  //    raise the offset. The orphaned --mobile-bar-height-expanded and
  //    --mobile-bar-height-mood-open declarations went with them.

  test('reserves room for the mobile control bar above the safe area', () => {
    const css = readAppShellCss();
    // What survives from the two tests above: the control offset still has to
    // clear the bar and the device safe area, or the controls sit under the
    // home indicator.
    expect(css).toMatch(
      /--mobile-bar-height:\s*calc\(\s*86px\s*\+\s*env\(safe-area-inset-bottom/u,
    );
    expect(css).toMatch(
      /--mobile-control-offset:\s*var\(--mobile-bar-height\)/u,
    );
  });

  test('rail actions wrap to avoid horizontal overflow (5619d17a)', () => {
    const css = readAppShellCss();
    expect(
      ruleInMedia(
        css,
        MOBILE_MEDIA,
        '.stims-shell__rail-actions',
        'flex-wrap: wrap',
      ),
    ).toBe(true);
  });

  test('safe-area-inset-bottom is accounted for in the mobile bar height', () => {
    const css = readAppShellCss();
    // Notch devices must not hide controls behind the home indicator.
    expect(css).toMatch(
      /--mobile-bar-height:\s*calc\(86px \+ env\(safe-area-inset-bottom/u,
    );
  });

  test('home page workspace has height auto (no clipping, 322eed12)', () => {
    const css = readAppShellCss();
    expect(css).toMatch(
      /body\[data-page="workspace"\]\s*\{[\s\S]*?height:\s*auto;/u,
    );
  });

  test('home stage frame overflow visible on mobile (322eed12)', () => {
    const css = readAppShellCss();
    expect(
      ruleInMedia(
        css,
        MOBILE_MEDIA,
        '.stims-shell__stage-frame[data-mode="home"]',
        'overflow: visible',
      ),
    ).toBe(true);
  });

  test('short landscape viewports get a scrollable hero (height breakpoint)', () => {
    const css = readAppShellCss();
    expect(css).toMatch(/@media \(max-height: 720px\)/u);
    expect(
      ruleInMedia(
        css,
        '@media (max-height: 720px)',
        '.stims-shell__stage-hero',
        'overflow-y: auto',
      ),
    ).toBe(true);
  });
});
