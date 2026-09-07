/**
 * Behavioural coverage for the z-index layer guard.
 *
 * The defect that prompted the guard is the one the first test pins: a
 * floating lab panel declared `z-index: 40`, which is exactly
 * --z-modal-backdrop, so a dialog's scrim and a tool panel shared one layer
 * and paint order fell to whichever came last in the DOM. A guard that only
 * read `.css` would have missed the other half of it — the promote transition
 * builds its overlay in TypeScript with `'z-index:80'` inside an inline style
 * string — so both forms are covered here.
 *
 * These run the actual script against fixtures rather than re-implementing
 * its matching, so the test cannot drift from the guard the gate runs.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function runGuard(files: Record<string, string>): {
  code: number;
  output: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'z-layers-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content);
    }
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'scripts/check-z-layers.ts', dir],
      cwd: process.cwd(),
    });
    return {
      code: result.exitCode ?? 1,
      output:
        new TextDecoder().decode(result.stdout) +
        new TextDecoder().decode(result.stderr),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('check:z-layers', () => {
  test('rejects a raw value that silently occupies a named layer', () => {
    // 40 is --z-modal-backdrop. Declared raw, it reads as an independent
    // choice while actually tying with the scrim.
    const { code, output } = runGuard({
      'fixture.css': '.panel {\n  position: absolute;\n  z-index: 40;\n}\n',
    });
    expect(code).toBe(1);
    expect(output).toContain('z-index: 40');
  });

  test('rejects a raw value inside an inline style built in TypeScript', () => {
    const { code, output } = runGuard({
      'overlay.ts':
        "const overlay = document.createElement('div');\n" +
        "overlay.style.cssText = ['position:fixed', 'z-index:80'].join(';');\n",
    });
    expect(code).toBe(1);
    expect(output).toContain('z-index:80');
  });

  // Codex caught this on review: the first version matched only the
  // hyphenated `z-index:` spelling, so the normal ways to set a layer from a
  // component went straight through a guard that advertised scanning .tsx.
  test('rejects a raw value in a JSX style prop', () => {
    const { code, output } = runGuard({
      'Comp.tsx':
        'export function Comp() {\n' +
        "  return <div style={{ position: 'fixed', zIndex: 40 }} />;\n" +
        '}\n',
    });
    expect(code).toBe(1);
    expect(output).toContain('zIndex: 40');
  });

  test('rejects a raw value assigned to element.style.zIndex', () => {
    const { code, output } = runGuard({
      'imperative.ts':
        "const el = document.createElement('div');\nel.style.zIndex = '80';\n",
    });
    expect(code).toBe(1);
    expect(output).toContain('zIndex');
  });

  test('accepts a token in camel-case form too', () => {
    const { code } = runGuard({
      'Comp.tsx':
        "const style = { zIndex: 'var(--z-lab-panel)' };\nexport default style;\n",
    });
    expect(code).toBe(0);
  });

  test('a zIndex type annotation is not a declaration', () => {
    const { code } = runGuard({
      'types.ts': 'export type Props = {\n  zIndex?: number;\n};\n',
    });
    expect(code).toBe(0);
  });

  // Also Codex, on the follow-up: parseInt(_, 10) misreads JavaScript numeric
  // literals rather than rejecting them, so `1e3` came back 1 and `0x28` came
  // back 0 — both sailing under a floor they are well above.
  test('resolves exponential and hexadecimal literals before the floor', () => {
    const { code, output } = runGuard({
      'x.ts':
        'export const a = { zIndex: 1e3 };\nexport const b = { zIndex: 0x28 };\n',
    });
    expect(code).toBe(1);
    expect(output).toContain('1e3');
    expect(output).toContain('0x28');
  });

  test('still reads a value carrying a trailing qualifier', () => {
    // The reason resolveLayer falls back to parseInt: Number('40 !important')
    // is NaN, and dropping to Number alone would have lost this.
    const { code, output } = runGuard({
      'y.css': '.a {\n  z-index: 40 !important;\n}\n',
    });
    expect(code).toBe(1);
    expect(output).toContain('40 !important');
  });

  test('accepts a token', () => {
    const { code } = runGuard({
      'fixture.css': '.panel {\n  z-index: var(--z-lab-panel);\n}\n',
    });
    expect(code).toBe(0);
  });

  test('accepts a token arithmetic offset', () => {
    // Dragging lifts the panel one step without leaving the scale.
    const { code } = runGuard({
      'fixture.css':
        '.panel[data-dragging="true"] {\n  z-index: calc(var(--z-lab-panel) + 1);\n}\n',
    });
    expect(code).toBe(0);
  });

  test('allows low literals, which order siblings rather than layers', () => {
    // The point of the floor: `z-index: 1` lifting an image over its own tile
    // makes no claim about the app. Forcing a global token here is what
    // produced the misleading var(--z-stage-root) inside a browse panel.
    const { code } = runGuard({
      'fixture.css':
        '.image {\n  z-index: 1;\n}\n.hint {\n  z-index: 2;\n}\n.under {\n  z-index: -1;\n}\n',
    });
    expect(code).toBe(0);
  });

  test('ignores z-index mentioned in prose', () => {
    const { code } = runGuard({
      'fixture.css':
        '/* This used to be z-index: 40 before the token existed. */\n.panel {\n  color: red;\n}\n',
    });
    expect(code).toBe(0);
  });

  test('the repository itself passes', () => {
    const result = Bun.spawnSync({
      cmd: ['bun', 'run', 'scripts/check-z-layers.ts'],
      cwd: process.cwd(),
    });
    expect(result.exitCode).toBe(0);
  });
});
