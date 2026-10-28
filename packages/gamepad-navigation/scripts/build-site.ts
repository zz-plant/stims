/**
 * Assembles the GitHub Pages site into `_site/`: the static page under
 * `site/` and the library bundled for the browser as `lib/gamepad-navigation.js`,
 * which the demo imports, so the page runs the real package.
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

const result = await Bun.build({
  entrypoints: [join(ROOT, 'dist/index.js')],
  outdir: join(OUT, 'lib'),
  target: 'browser',
  format: 'esm',
  naming: 'gamepad-navigation.js',
  minify: false,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

cpSync(join(ROOT, 'site'), OUT, { recursive: true });
console.log(`wrote ${OUT}`);
