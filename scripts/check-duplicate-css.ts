/**
 * Detect duplicate CSS keyframes and rule blocks — the "merge duplicate
 * CSS, remove duplicate keyframes" pattern recurred multiple times in the
 * last 400 commits (`0cc04211`, `6b39eb2f`, `1d2fa2af`). Duplicates bloat
 * the bundle and cause maintenance drift where one copy is updated and
 * the other is forgotten.
 *
 * Catches:
 *  1. Duplicate `@keyframes` names across global CSS files.
 *  2. Duplicate `@font-face` faces (same family + weight + style).
 *
 * `.module.css` files are excluded from cross-file checks — CSS modules
 * scope keyframes locally, so a `fade-in` in a module is not a duplicate
 * of the global `fade-in`. Duplicates *within* a single file are still
 * caught (two `@keyframes spin` in the same file is always a mistake).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const CSS_ROOTS = ['src/css'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(full, out);
    else if (extname(full) === '.css') out.push(full);
  }
  return out;
}

const cssFiles = CSS_ROOTS.flatMap((r) => walk(r));
const offenders: string[] = [];

/* 1: duplicate @keyframes names — cross-file for global CSS, always within-file */
const keyframeNames = new Map<string, string[]>();
for (const file of cssFiles) {
  const text = readFileSync(file, 'utf8');
  const isModule = file.endsWith('.module.css');
  const localCounts = new Map<string, number>();
  for (const m of text.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) {
    const name = m[1];
    localCounts.set(name, (localCounts.get(name) ?? 0) + 1);
  }
  // Within-file duplicates are always a mistake, even in modules.
  for (const [name, count] of localCounts) {
    if (count > 1) {
      offenders.push(
        `Duplicate @keyframes "${name}" ×${count} within ${file.replace('src/css/', '')}`,
      );
    }
    // Cross-file duplicates only matter for global (non-module) CSS.
    if (!isModule) {
      keyframeNames.set(name, [...(keyframeNames.get(name) ?? []), file]);
    }
  }
}
for (const [name, files] of keyframeNames) {
  if (files.length > 1) {
    offenders.push(
      `Duplicate @keyframes "${name}" in: ${files.map((f) => f.replace('src/css/', '')).join(', ')}`,
    );
  }
}

/* 2: duplicate @font-face faces — cross-file for global CSS.
   Keyed on family + weight + style, not family alone. A family is normally
   several faces (regular and bold are different files and therefore
   different @font-face blocks by necessity), so matching on the name alone
   reported any correctly self-hosted family as a duplicate of itself. The
   real mistake this catches is the same *face* declared twice. */
const fontFaces = new Map<string, string[]>();
for (const file of cssFiles) {
  if (file.endsWith('.module.css')) continue;
  const text = readFileSync(file, 'utf8');
  let idx = 0;
  while (true) {
    const start = text.indexOf('@font-face', idx);
    if (start === -1) break;
    const blockEnd = text.indexOf('}', start);
    if (blockEnd === -1) break;
    const block = text.slice(start, blockEnd);
    const fam = block.match(/font-family:\s*['"]?([^'";]+)['"]?\s*;/);
    if (fam) {
      const name = fam[1].trim();
      // Defaults match the CSS initial values for an omitted descriptor.
      const weight =
        block.match(/font-weight:\s*([^;]+);/)?.[1].trim() ?? '400';
      const style =
        block.match(/font-style:\s*([^;]+);/)?.[1].trim() ?? 'normal';
      const key = `${name} / ${weight} / ${style}`;
      fontFaces.set(key, [...(fontFaces.get(key) ?? []), file]);
    }
    idx = blockEnd + 1;
  }
}
for (const [key, files] of fontFaces) {
  if (files.length > 1) {
    offenders.push(
      `Duplicate @font-face "${key}" in: ${files.map((f) => f.replace('src/css/', '')).join(', ')}`,
    );
  }
}

if (offenders.length > 0) {
  console.error(`✖ Found ${offenders.length} duplicate CSS declaration(s):\n`);
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}

console.log(
  `✔ No duplicate @keyframes or @font-face across ${cssFiles.length} CSS files`,
);
