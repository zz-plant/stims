/**
 * Assembles the GitHub Pages site into `_site/`: the static page under
 * `site/`, the generated figures, and the library bundled for the browser
 * (`lib/flash-guard.js` plus the readback worker beside it, which the
 * sampler loads relative to the bundle).
 *
 *   bun run site:build
 *   bun run site:preview      # serve _site/ on http://localhost:8787
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const TSC_LOCAL = join(ROOT, 'node_modules', '.bin', 'tsc');
const TSC_MONOREPO = join(ROOT, '..', '..', 'node_modules', '.bin', 'tsc');
const tsc = existsSync(TSC_LOCAL)
  ? [TSC_LOCAL]
  : existsSync(TSC_MONOREPO)
    ? [TSC_MONOREPO]
    : ['bunx', 'tsc'];

const build = Bun.spawnSync([...tsc, '-p', 'tsconfig.build.json'], {
  cwd: ROOT,
  stdout: 'inherit',
  stderr: 'inherit',
});
if (build.exitCode !== 0) process.exit(build.exitCode);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'lib'), { recursive: true });

for (const [entry, name] of [
  ['dist/index.js', 'flash-guard.js'],
  ['dist/readback.worker.js', 'readback.worker.js'],
] as const) {
  const result = await Bun.build({
    entrypoints: [join(ROOT, entry)],
    outdir: join(OUT, 'lib'),
    target: 'browser',
    format: 'esm',
    naming: name,
    minify: false,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }
}

cpSync(join(ROOT, 'site'), OUT, { recursive: true });
cpSync(join(ROOT, 'docs'), join(OUT, 'docs'), { recursive: true });
console.log(`wrote ${OUT}`);
