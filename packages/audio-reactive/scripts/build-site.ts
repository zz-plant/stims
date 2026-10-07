/**
 * Assembles the GitHub Pages site into `_site/`: compiles the package with
 * `tsc`, bundles the main entry and the worklet into two self-contained
 * browser ES modules under `_site/lib/`, then copies the static page from
 * `site/` on top. The worklet bundle must have no `import` statements left,
 * because `audioWorklet.addModule` does not follow them in every browser.
 *
 *   bun run site:build
 *   bun run site:preview      # serve _site/ on http://localhost:8787
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const LIB = join(OUT, 'lib');

function run(cmd: string[]) {
  const result = Bun.spawnSync(cmd, {
    cwd: ROOT,
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  return result.exitCode === 0;
}

// 1. Compile src/ to dist/ with the package's own build config. Prefer the
// monorepo's tsc, fall back to bunx when the package lives on its own.
const localTsc = join(ROOT, '..', '..', 'node_modules', '.bin', 'tsc');
const tscOk = existsSync(localTsc)
  ? run([localTsc, '-p', 'tsconfig.build.json'])
  : run(['bunx', 'tsc', '-p', 'tsconfig.build.json']);
if (!tscOk) {
  console.error('tsc failed');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(LIB, { recursive: true });

// 2. Bundle both entry points for the browser. Not minified: the site is
// also a readable reference for what the package ships.
async function bundle(entry: string, outfile: string) {
  const result = await Bun.build({
    entrypoints: [join(ROOT, entry)],
    target: 'browser',
    format: 'esm',
    minify: false,
    sourcemap: 'none',
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`bundle failed: ${entry}`);
  }
  const [artifact] = result.outputs;
  if (!artifact) throw new Error(`no output for ${entry}`);
  await Bun.write(join(LIB, outfile), artifact);
  return join(LIB, outfile);
}

const mainOut = await bundle('dist/index.js', 'audio-reactive.js');
const workletOut = await bundle(
  'dist/frequency-analyser-processor.js',
  'worklet.js',
);

// 3. The worklet must be one self-contained module.
const workletSource = readFileSync(workletOut, 'utf8');
if (/^\s*import\s/m.test(workletSource)) {
  throw new Error(
    'worklet.js still contains import statements; addModule cannot resolve them',
  );
}
if (
  !workletSource.includes("registerProcessor('frequency-analyser'") &&
  !workletSource.includes('registerProcessor("frequency-analyser"')
) {
  throw new Error('worklet.js lost its registerProcessor call');
}

// 4. The static page.
cpSync(join(ROOT, 'site'), OUT, { recursive: true });

const kb = (path: string) => `${(statSync(path).size / 1024).toFixed(1)} kB`;
console.log(`wrote ${OUT}`);
console.log(`  lib/audio-reactive.js ${kb(mainOut)}`);
console.log(`  lib/worklet.js        ${kb(workletOut)}`);
