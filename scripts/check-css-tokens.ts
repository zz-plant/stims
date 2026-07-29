/**
 * Fail on `var(--token)` references that resolve to nothing.
 *
 * CSS treats an undefined custom property as invalid at computed-value time:
 * the declaration is dropped and the property falls back to its inherited or
 * initial value, silently. `body, html { font-family: var(--display-font) }`
 * referenced a property that was never defined, so the entire app rendered in
 * the UA serif — in production, past CI, past 1200 tests, unnoticed.
 *
 * A usage is considered safe when the property is defined anywhere in the CSS,
 * set from JS via setProperty, or the `var()` supplies a fallback.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const CSS_ROOTS = ['src/css'];
const JS_ROOTS = ['src/js'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, exts, out);
    else if (exts.includes(extname(full))) out.push(full);
  }
  return out;
}

const cssFiles = CSS_ROOTS.flatMap((r) => walk(r, ['.css']));
const jsFiles = JS_ROOTS.flatMap((r) => walk(r, ['.ts', '.tsx', '.js']));

/** Properties declared in CSS: `--name:` */
const defined = new Set<string>();
for (const file of cssFiles) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) {
    defined.add(m[1]);
  }
}

/** Properties written from JS: setProperty('--name', …) */
for (const file of jsFiles) {
  const text = readFileSync(file, 'utf8');
  if (!text.includes('setProperty')) continue;
  for (const m of text.matchAll(
    /setProperty\(\s*['"`](--[A-Za-z0-9_-]+)['"`]/g,
  )) {
    defined.add(m[1]);
  }
}

type Offence = { file: string; line: number; token: string; text: string };
const offences: Offence[] = [];

/** Blank out comments while preserving line numbers. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

for (const file of cssFiles) {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
  lines.forEach((line, i) => {
    // Capture the token and whatever follows, to detect a fallback argument.
    for (const m of line.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*([,)])/g)) {
      const token = m[1];
      const hasFallback = m[2] === ',';
      if (hasFallback || defined.has(token)) continue;
      offences.push({
        file,
        line: i + 1,
        token,
        text: line.trim().slice(0, 120),
      });
    }
  });
}

if (offences.length > 0) {
  console.error(
    `Found ${offences.length} var() reference(s) to undefined custom properties.\n` +
      `An undefined var() with no fallback drops the whole declaration silently.\n` +
      `Define the token, or give the var() a fallback value.\n`,
  );
  for (const o of offences) {
    console.error(`  ${o.file}:${o.line}  ${o.token}\n      ${o.text}`);
  }
  process.exit(1);
}

console.log(
  `✔ all var() references resolve (${defined.size} tokens defined, ${cssFiles.length} stylesheets)`,
);
