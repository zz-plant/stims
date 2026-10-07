/**
 * Builds every standalone package's GitHub Pages site into `_site/<name>/`
 * with an index page at the root, so one Pages deployment from this
 * repository serves all of them (`.github/workflows/pages-packages.yml`).
 *
 * Each package owns its own site (`packages/<name>/site/`, assembled by its
 * `site:build` script into `packages/<name>/_site/`); this script only runs
 * those and arranges the results. After a package is split into its own
 * repository, its own `.github/workflows/pages.yml` deploys the same site.
 *
 *   bun run site:packages            # writes ./_site
 *   bun run site:packages -- --serve # ...and serves it on http://localhost:8788
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PACKAGES_DIR = join(ROOT, 'packages');
const OUT = join(ROOT, '_site');
const serve = process.argv.includes('--serve');

type Manifest = { name: string; description: string; version: string };

const packages = readdirSync(PACKAGES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => existsSync(join(PACKAGES_DIR, name, 'site', 'index.html')))
  .sort();

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const built: Manifest[] = [];
for (const name of packages) {
  const cwd = join(PACKAGES_DIR, name);
  const result = Bun.spawnSync(['bun', 'run', 'site:build'], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0) {
    console.error(`site:build failed for ${name}`);
    process.exit(result.exitCode);
  }
  cpSync(join(cwd, '_site'), join(OUT, name), { recursive: true });
  const manifest = JSON.parse(
    readFileSync(join(cwd, 'package.json'), 'utf8'),
  ) as Manifest;
  built.push(manifest);
}

// The shared stylesheet is identical across packages by convention.
cpSync(
  join(PACKAGES_DIR, packages[0] as string, 'site', 'styles.css'),
  join(OUT, 'styles.css'),
);

const cards = built
  .map(
    (m) =>
      `<a class="card" href="./${m.name}/"><h3>${m.name} <span class="badge">${m.version}</span></h3><p>${m.description}</p></a>`,
  )
  .join('\n');

writeFileSync(
  join(OUT, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stims packages</title>
<meta name="description" content="Standalone libraries extracted from Stims, the browser MilkDrop visualizer at toil.fyi.">
<link rel="stylesheet" href="./styles.css">
<style>a.card { display: block; text-decoration: none; color: inherit; } a.card:hover { border-color: var(--accent); }</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <a class="brand" href="./">stims / packages</a>
    <nav><a href="https://github.com/zz-plant/stims/tree/main/packages">GitHub</a><a href="https://toil.fyi">toil.fyi</a></nav>
  </header>
  <div class="hero">
    <h1>Libraries extracted from Stims.</h1>
    <p class="lead">Each one is a standalone npm package with no dependency on the app, its own tests, and a page with a working demo. Public domain.</p>
  </div>
  <section>
    <div class="grid">
${cards}
    </div>
  </section>
  <footer><p>Built from <a href="https://github.com/zz-plant/stims">zz-plant/stims</a>.</p></footer>
</div>
</body>
</html>
`,
);
writeFileSync(join(OUT, '.nojekyll'), '');
console.log(`wrote ${OUT} (${built.map((m) => m.name).join(', ')})`);

if (serve) {
  const server = Bun.serve({
    port: 8788,
    async fetch(request) {
      let path = join(OUT, decodeURIComponent(new URL(request.url).pathname));
      if (
        existsSync(path) &&
        Bun.file(path).size === 0 &&
        existsSync(join(path, 'index.html'))
      ) {
        path = join(path, 'index.html');
      }
      const file = Bun.file(path);
      return (await file.exists())
        ? new Response(file)
        : new Response('not found', { status: 404 });
    },
  });
  console.log(`serving ${OUT} on http://localhost:${server.port}`);
}
