/**
 * Bundle-size budget for the built app.
 *
 * The quality gate has 60+ checks but until now nothing guarded bundle
 * bytes, so a stray eager import (meyda, stats-gl, a CSS file for a lazy
 * panel) could silently grow the startup payload. This asserts budgets
 * against `dist/` output:
 *
 *   - per-chunk ceiling for the largest JS chunk,
 *   - total JS payload ceiling,
 *   - total CSS payload ceiling.
 *
 * Budgets are deliberately generous versus today's output — they exist to
 * catch step-change regressions, not to fight every kilobyte. Run with a
 * fresh `bun run build`. If dist/ is absent the check fails loudly rather
 * than passing vacuously; wire it after a build step, not into check:quick.
 *
 * Usage: bun run scripts/check-bundle-size.ts [--dist=dist]
 */

import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const DIST =
  process.argv.find((a) => a.startsWith('--dist='))?.slice('--dist='.length) ??
  'dist';

// Ceilings in bytes (uncompressed on-disk size).
const MAX_SINGLE_JS_CHUNK = 1_400_000;
const MAX_TOTAL_JS = 6_000_000;
const MAX_TOTAL_CSS = 500_000;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      // Skip preset payloads and worker bundles — the budget guards the
      // app's own code, not bundled content corpora.
      if (entry === 'milkdrop-presets' || entry === '_worker.js') continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function fmt(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

function main(): boolean {
  let files: string[];
  try {
    files = walk(DIST);
  } catch {
    console.error(
      `[ERROR] ${DIST}/ not found — run \`bun run build\` before the bundle-size check.`,
    );
    return false;
  }

  const js = files.filter((f) => f.endsWith('.js'));
  const css = files.filter((f) => f.endsWith('.css'));
  const sizeOf = (list: string[]) =>
    list.reduce((total, f) => total + statSync(f).size, 0);

  const totalJs = sizeOf(js);
  const totalCss = sizeOf(css);
  const largest = js
    .map((f) => ({ f, size: statSync(f).size }))
    .sort((a, b) => b.size - a.size)[0];

  console.log(
    `[INFO] dist JS ${fmt(totalJs)} across ${js.length} chunks ` +
      `(largest ${largest ? `${path.basename(largest.f)} ${fmt(largest.size)}` : 'n/a'}), ` +
      `CSS ${fmt(totalCss)} across ${css.length} files`,
  );

  let ok = true;
  if (largest && largest.size > MAX_SINGLE_JS_CHUNK) {
    console.error(
      `[ERROR] Largest JS chunk ${path.basename(largest.f)} is ${fmt(largest.size)}, over the ${fmt(MAX_SINGLE_JS_CHUNK)} budget.`,
    );
    ok = false;
  }
  if (totalJs > MAX_TOTAL_JS) {
    console.error(
      `[ERROR] Total JS payload ${fmt(totalJs)} is over the ${fmt(MAX_TOTAL_JS)} budget.`,
    );
    ok = false;
  }
  if (totalCss > MAX_TOTAL_CSS) {
    console.error(
      `[ERROR] Total CSS payload ${fmt(totalCss)} is over the ${fmt(MAX_TOTAL_CSS)} budget.`,
    );
    ok = false;
  }
  if (ok) {
    console.log('[INFO] Bundle size within budget.');
  }
  return ok;
}

if (!main()) {
  process.exit(1);
}
