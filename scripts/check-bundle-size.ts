/**
 * Bundle-size budget for the built app.
 *
 * The quality gate has 60+ checks but until now nothing guarded bundle
 * bytes, so a stray eager import (stats-gl, a CSS file for a lazy panel, an
 * unpinned Three.js subpath) could silently grow the startup payload. This
 * asserts budgets
 * against `dist/` output:
 *
 *   - per-chunk ceiling for the largest JS chunk,
 *   - total JS payload ceiling,
 *   - total CSS payload ceiling,
 *   - gzipped ceilings for the catalog manifests,
 *   - chunk-graph rules: which vendor chunks may sit on the boot path.
 *
 * The manifests are guarded separately because they are the largest things
 * the app downloads and nothing watched them: `public/_headers` described
 * catalog.json as ~1.7 MB while it had already reached 2.4 MB. They are
 * budgeted gzipped, since that is what crosses the wire (2.4 MB of highly
 * repetitive JSON is 100 KB compressed) and raw size would fail for growth
 * that costs a visitor nothing.
 *
 * Budgets are deliberately generous versus today's output — they exist to
 * catch step-change regressions, not to fight every kilobyte. Run with a
 * fresh `bun run build`. If dist/ is absent the check fails loudly rather
 * than passing vacuously; wire it after a build step, not into check:quick.
 *
 * Usage: bun run scripts/check-bundle-size.ts [--dist=dist]
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const DIST =
  process.argv.find((a) => a.startsWith('--dist='))?.slice('--dist='.length) ??
  'dist';

// Ceilings in bytes (uncompressed on-disk size).
const MAX_SINGLE_JS_CHUNK = 1_400_000;
const MAX_TOTAL_JS = 6_000_000;
const MAX_TOTAL_CSS = 500_000;

/**
 * Gzipped ceilings for the catalog manifests, with headroom over today's
 * output (catalog 100 KB, search index 61 KB, starter 2 KB). The starter
 * catalog is the tight one on purpose: it is the only manifest on the boot
 * path, so growth there is paid by every visitor before first render, while
 * the other two are fetched at idle.
 */
const MANIFEST_GZIP_BUDGETS: ReadonlyArray<{ file: string; max: number }> = [
  { file: 'milkdrop-presets/starter-catalog.json', max: 8_000 },
  { file: 'milkdrop-presets/catalog.json', max: 160_000 },
  { file: 'milkdrop-presets/search-index.json', max: 100_000 },
];

/**
 * Byte totals cannot see a chunk moving onto the boot path, and two did:
 * CodeMirror (~121 kB gz) became eager through vendor-other, and
 * three/webgpu (~189 kB gz) entered the runtime closure every WebGL session
 * loads. Each rule names a chunk prefix that must stay out of a load set
 * (a prefix: `vendor-three` also matches `vendor-three-webgpu`).
 */
export const BOOT_PATH_RULES: ReadonlyArray<{
  forbidden: string;
  set: 'eager' | 'runtime';
  why: string;
}> = [
  {
    forbidden: 'vendor-codemirror',
    set: 'eager',
    why: 'the editor is prewarmed at idle; first paint must not wait for it',
  },
  {
    forbidden: 'vendor-three',
    set: 'eager',
    why: 'the landing page paints and takes input before any engine mounts; three.js loads with the engine',
  },
  {
    forbidden: 'vendor-three-webgpu',
    set: 'eager',
    why: 'WebGL-only browsers can never execute it',
  },
  {
    forbidden: 'vendor-three-webgpu',
    set: 'runtime',
    why: 'WebGL sessions load the runtime; WebGPU code must stay behind the WebGPU adapter import',
  },
  {
    forbidden: 'vendor-codemirror',
    set: 'runtime',
    why: 'the engine does not need the editor to render',
  },
];

/** Asset paths index.html loads up front: module scripts and modulepreloads. */
export function eagerChunks(indexHtml: string): string[] {
  const found = [
    ...indexHtml.matchAll(/<script[^>]*type="module"[^>]*src="\/([^"]+)"/g),
    ...indexHtml.matchAll(/rel="modulepreload"[^>]*href="\/([^"]+)"/g),
  ].map((match) => match[1] as string);
  return [...new Set(found)];
}

/**
 * Chunks reachable from `start` through static imports only. Dynamic
 * imports and preload-dependency lists are deliberately not followed: they
 * load on demand, which is the point of splitting them out.
 */
export function staticClosure(
  start: string[],
  readChunk: (assetPath: string) => string | null,
): Set<string> {
  const seen = new Set<string>();
  const pending = [...start];
  const staticImport =
    /(?:^|[;}\s])(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["']\.\/([^"']+\.js)["']/g;
  while (pending.length > 0) {
    const assetPath = pending.pop() as string;
    if (seen.has(assetPath)) continue;
    seen.add(assetPath);
    const source = readChunk(assetPath);
    if (source === null) continue;
    const dir = path.posix.dirname(assetPath);
    for (const match of source.matchAll(staticImport)) {
      pending.push(path.posix.join(dir, match[1] as string));
    }
  }
  return seen;
}

/** Violations of BOOT_PATH_RULES, one message each. */
export function findBootPathLeaks(
  indexHtml: string,
  assetPaths: string[],
  readChunk: (assetPath: string) => string | null,
): string[] {
  const eager = staticClosure(eagerChunks(indexHtml), readChunk);
  const runtimeEntry = assetPaths.filter((asset) =>
    /^assets\/runtime-[\w-]+\.js$/.test(asset),
  );
  const runtime = staticClosure(runtimeEntry, readChunk);
  const sets = { eager, runtime };
  const leaks: string[] = [];
  for (const rule of BOOT_PATH_RULES) {
    const hit = [...sets[rule.set]].find((asset) =>
      path.posix.basename(asset).startsWith(`${rule.forbidden}-`),
    );
    if (hit) {
      leaks.push(
        `${rule.forbidden} is in the ${rule.set} load set (${hit}): ${rule.why}.`,
      );
    }
  }
  return leaks;
}

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

  for (const { file, max } of MANIFEST_GZIP_BUDGETS) {
    const full = path.join(DIST, file);
    if (!existsSync(full)) {
      console.error(`[ERROR] Missing catalog manifest ${file} in ${DIST}.`);
      ok = false;
      continue;
    }
    const gzipped = gzipSync(readFileSync(full), { level: 9 }).byteLength;
    const raw = statSync(full).size;
    console.log(
      `[INFO] ${file} ${fmt(raw)} raw, ${fmt(gzipped)} gzipped (budget ${fmt(max)})`,
    );
    if (gzipped > max) {
      console.error(
        `[ERROR] ${file} is ${fmt(gzipped)} gzipped, over the ${fmt(max)} budget.`,
      );
      ok = false;
    }
  }
  const indexPath = path.join(DIST, 'index.html');
  if (existsSync(indexPath)) {
    const assetPaths = js.map((f) =>
      path.relative(DIST, f).split(path.sep).join('/'),
    );
    const leaks = findBootPathLeaks(
      readFileSync(indexPath, 'utf8'),
      assetPaths,
      (assetPath) => {
        const full = path.join(DIST, assetPath);
        return existsSync(full) ? readFileSync(full, 'utf8') : null;
      },
    );
    for (const leak of leaks) {
      console.error(`[ERROR] ${leak}`);
    }
    if (leaks.length > 0) ok = false;
  } else {
    console.error(
      `[ERROR] Missing ${DIST}/index.html for the boot-path check.`,
    );
    ok = false;
  }

  if (ok) {
    console.log('[INFO] Bundle size within budget.');
  }
  return ok;
}

if (import.meta.main && !main()) {
  process.exit(1);
}
