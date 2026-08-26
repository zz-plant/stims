/**
 * Fails when a test reads a production source file as text.
 *
 * The audit of all 303 test files found one shape repeated ~70 times:
 *
 *   const source = readFileSync('src/js/frontend/X.tsx', 'utf8');
 *   expect(source).toContain('<a literal copied out of X.tsx>');
 *
 * That assertion cannot fail when behaviour changes and cannot pass when the
 * behaviour is right but the spelling moved. Renaming a local, extracting a
 * component, or reformatting a CSS selector reddens the suite while the app is
 * identical; putting the same literal in a comment turns it green while the
 * feature is gone. Tests like this also keep dead code alive, because deleting
 * the code correctly is what breaks them.
 *
 *   bun run check:test-source-greps
 *
 * The rule: assert through the module's exported behaviour instead. If the
 * property really is about a file's text — an HTML artifact we ship, a config
 * file, a generated header — allowlist it below with a reason. That is a
 * one-line edit with a justification, which is the cost this guard is trying
 * to impose.
 */
import fs from 'node:fs';
import path from 'node:path';

/** `path: reason`. A file listed here may read production source as text. */
const ALLOWED: Record<string, string> = {
  // The shipped artifact IS the text. jsdom computes no layout or stacking
  // contexts, so there is no behavioural observation point in this suite.
  'tests/unit/theme-boot-parity.test.ts':
    'Extracts and EXECUTES the pre-paint theme IIFE from index.html against the real resolveTheme — the script runs before any module loads, so reading the shipped HTML is the only way to test it.',
  'tests/unit/seo-canonical-intent.test.ts':
    'index.html and milkdrop/index.html are the crawlable artifacts; the meta tags are the contract a crawler sees.',
  'tests/unit/site-build.test.ts':
    'Asserts the built output and _headers, which are files we ship rather than modules we can import.',
  'tests/unit/milkdrop-overlay-stacking.test.ts':
    'src/css/tokens.css z-index scale — the cascade is the behaviour and jsdom does not compute stacking contexts.',

  // Known debt, enumerated so it cannot grow silently. Each of these asserts
  // component or CSS source text and should become a behavioural test or move
  // to tests/e2e/chrome-visual-contract.test.ts. See the 2026-08-25 audit.
  'tests/unit/app-shell-first-run-recovery.test.ts':
    'DEBT: greps App.tsx and workspace-*.ts for the first-run recovery path.',
  'tests/unit/app-shell-minimal-surfaces.test.ts':
    'DEBT: greps panel components and app-shell.css for copy and selectors.',
  'tests/unit/app-shell-passive-guidance.test.ts':
    'DEBT (reduced): the audio-match toast is rendered with fake timers now; the remaining greps are App.tsx wiring and toast/hint copy, pending a harness mount of those surfaces.',
  'tests/unit/app-shell-performance-hardware.test.ts':
    'DEBT: greps for hardware-tier branching.',
  'tests/unit/app-shell-performance-regression.test.ts':
    'DEBT: greps for import specifiers and memo/cache spellings.',
  'tests/unit/app-shell-route-sync.test.ts':
    'The route-sync test renders the real hook now; the remaining source read is the toast attribute/media-query pair, a cross-artifact presentational contract with no layout engine in this suite.',
  'tests/unit/app-shell-skip-flow.test.tsx':
    'Renders the real StimsStageFrame for the focus-target and data-mode halves; the remaining reads are the App.tsx anchor (the shell does not mount in this suite) and the CSS rules (no style engine).',
  'tests/unit/app-shell-stage-tools.test.ts':
    'DEBT: greps App.tsx/workspace-ui.tsx for stage tool classes.',
  'tests/unit/app-shell-ui-simplification.test.ts':
    'DEBT: greps eight components for copy.',
  'tests/unit/arrival-url.test.ts': 'DEBT: greps for arrival URL handling.',
  'tests/unit/assisted-edit-gate.test.ts':
    'One remaining routing check on editor-panel source (all AI actions go through the proposal path); the exact-count brittleness is gone and the rest of the file is behavioural.',
  'tests/unit/keyboard-shortcut-matching.test.ts':
    'Generates its rows from the live registry; the source read is a dangling-reference check, not a copy assertion.',
  'tests/unit/mobile-viewport-matrix.test.ts':
    'DEBT: greps app-shell.css for viewport rules.',
  'tests/unit/primitive-rasterization-fidelity.test.ts':
    'DEBT: greps renderer source for rasterisation constants.',
  'tests/unit/scripts-list-routing.test.ts':
    'Reads scripts/ to check `bun run help --for` does not route at a deleted script — a dangling-reference check over live data.',
  'tests/unit/workspace-first-fold-actions.test.tsx':
    'Renders the real NewHomePage/AudioSourcePanel through the harness; the one remaining read checks app-shell.css styles the classes the RENDERED page produces (no style engine here).',
};

const READS_SOURCE =
  /(?:readFileSync|readFile|Bun\.file)\s*\([^)]*?['"`][^'"`]*?(?:^|\/|\.\.\/)(?:src|scripts)\//;

function walk(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const offenders: string[] = [];
for (const file of walk('tests')) {
  const rel = file.split(path.sep).join('/');
  if (rel in ALLOWED) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (READS_SOURCE.test(source)) offenders.push(rel);
}

if (offenders.length > 0) {
  console.error(
    `✖ ${offenders.length} test file(s) read production source as text:\n` +
      offenders.map((f) => `  ${f}`).join('\n') +
      '\n\nA test that greps src/ or scripts/ cannot fail when behaviour changes,' +
      '\nand cannot pass when the behaviour is right but the spelling moved.' +
      '\nAssert through the module instead, or add an allowlist entry with a' +
      '\nreason in scripts/check-test-source-greps.ts.',
  );
  process.exit(1);
}

const debt = Object.values(ALLOWED).filter((r) => r.startsWith('DEBT:')).length;
console.log(
  `✔ no new source-text tests (${debt} allowlisted as known debt, ${Object.keys(ALLOWED).length - debt} as shipped-artifact reads)`,
);
