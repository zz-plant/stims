/**
 * Assembles the GitHub Pages site into `_site/`: the static page under
 * `site/` plus a single browser bundle of the library at
 * `_site/lib/milkdrop-toolchain.js`, which the playground imports.
 *
 * The bundle is built from `dist/` (so the page runs exactly what the package
 * ships), with the `data/parity-allowlist.json` import attribute inlined so
 * the browser loads one file and no `with { type: 'json' }` syntax.
 *
 *   bun run site:build
 *   bun run site:preview      # serve _site/ on http://localhost:8787
 */
import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const BUNDLE = 'milkdrop-toolchain.js';

function compileDist() {
  const localTsc = join(ROOT, '..', '..', 'node_modules', '.bin', 'tsc');
  const command = existsSync(localTsc)
    ? [localTsc, '-p', 'tsconfig.build.json']
    : ['bunx', 'tsc', '-p', 'tsconfig.build.json'];
  const run = Bun.spawnSync(command, {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (run.exitCode !== 0) {
    throw new Error(`tsc failed with exit code ${run.exitCode}`);
  }
}

async function bundleLibrary() {
  const result = await Bun.build({
    entrypoints: [join(ROOT, 'dist', 'index.js')],
    outdir: join(OUT, 'lib'),
    target: 'browser',
    format: 'esm',
    naming: BUNDLE,
    minify: false,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error('Bun.build failed');
  }
  const bundlePath = join(OUT, 'lib', BUNDLE);
  const text = await Bun.file(bundlePath).text();
  // The page must load one file: anything the bundler left as an import
  // (or the JSON import attribute tsc emits) would fail in the browser.
  if (/^\s*import\s/m.test(text)) {
    throw new Error(`${BUNDLE} still contains an import statement`);
  }
  if (/with\s*\{\s*type:\s*['"]json['"]\s*\}/.test(text)) {
    throw new Error(`${BUNDLE} still contains a JSON import attribute`);
  }
  return statSync(bundlePath).size;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

compileDist();
cpSync(join(ROOT, 'site'), OUT, { recursive: true });
const bytes = await bundleLibrary();

console.log(`wrote ${OUT} (lib/${BUNDLE}: ${(bytes / 1024).toFixed(1)} KiB)`);
