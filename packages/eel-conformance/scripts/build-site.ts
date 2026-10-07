/**
 * Assembles the GitHub Pages site into `_site/`: the static page under
 * `site/`, the coverage figures, the schema, and the corpus itself with an
 * `index.json` listing its files so the page can fetch them.
 *
 *   bun run site:build
 *   bun run site:preview      # serve _site/ on http://localhost:8787
 */
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

cpSync(join(ROOT, 'site'), OUT, { recursive: true });
cpSync(join(ROOT, 'docs'), join(OUT, 'docs'), { recursive: true });
cpSync(join(ROOT, 'schema.json'), join(OUT, 'schema.json'));
cpSync(join(ROOT, 'cases'), join(OUT, 'cases'), { recursive: true });

const files = readdirSync(join(ROOT, 'cases'))
  .filter((name) => name.endsWith('.json'))
  .sort();
writeFileSync(
  join(OUT, 'cases', 'index.json'),
  `${JSON.stringify({ files }, null, 2)}\n`,
);
// A directory listing for the "Browse the JSON" link.
writeFileSync(
  join(OUT, 'cases', 'index.html'),
  `<!doctype html><meta charset="utf-8"><title>eel-conformance cases</title><link rel="stylesheet" href="../styles.css"><div class="wrap"><h1>cases/</h1><ul>${files
    .map((f) => `<li><a href="./${f}">${f}</a></li>`)
    .join('')}</ul><p><a href="../">Back</a></p></div>\n`,
);

console.log(`wrote ${OUT} (${files.length} case files)`);
