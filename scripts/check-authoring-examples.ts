/**
 * Guards the authoring curriculum in docs/authoring/:
 *
 * 1. Every .milk file in docs/authoring/examples/ must compile without
 *    error-severity diagnostics.
 * 2. Every markdown link whose title attribute names a .milk file, e.g.
 *      [▶ Run it](https://toil.fyi/?tool=editor#code=... "examples/10-bench.milk")
 *    must carry a #code= payload that matches the current content of that
 *    file. Titles resolve relative to docs/authoring/, except titles starting
 *    with "public/", which resolve from the repo root (for catalog presets).
 *
 * `--write` regenerates stale link URLs in place instead of failing.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler';

const ROOT = resolve(import.meta.dir, '..');
const AUTHORING_DIR = join(ROOT, 'docs/authoring');
const EXAMPLES_DIR = join(AUTHORING_DIR, 'examples');
const BASE_URL = 'https://toil.fyi/?tool=editor';
const LINK_PATTERN = /\[([^\]]*)\]\(([^()\s]+)\s+"([^"]+\.milk)"\)/gu;

const write = process.argv.includes('--write');
const problems: string[] = [];

function compileOrReport(label: string, source: string) {
  try {
    const compiled = compileMilkdropPresetSource(source);
    const errors = compiled.diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error',
    );
    for (const error of errors) {
      problems.push(
        `${label}: compile error${error.line ? ` (line ${error.line})` : ''}: ${error.message}`,
      );
    }
  } catch (err) {
    problems.push(`${label}: compiler threw: ${(err as Error).message}`);
  }
}

function runUrlFor(source: string) {
  return `${BASE_URL}#code=${encodeURIComponent(
    Buffer.from(source, 'latin1').toString('base64'),
  )}`;
}

function resolveExamplePath(title: string) {
  return title.startsWith('public/')
    ? join(ROOT, title)
    : join(AUTHORING_DIR, title);
}

const exampleFiles = readdirSync(EXAMPLES_DIR).filter((name) =>
  name.endsWith('.milk'),
);
for (const name of exampleFiles) {
  compileOrReport(
    `examples/${name}`,
    readFileSync(join(EXAMPLES_DIR, name), 'latin1'),
  );
}

const markdownFiles = readdirSync(AUTHORING_DIR).filter((name) =>
  name.endsWith('.md'),
);
const linkedTitles = new Set<string>();
for (const name of markdownFiles) {
  const mdPath = join(AUTHORING_DIR, name);
  const original = readFileSync(mdPath, 'utf8');
  let updated = original;

  for (const match of original.matchAll(LINK_PATTERN)) {
    const [full, text, url, title] = match;
    linkedTitles.add(title);
    let source: string;
    try {
      source = readFileSync(resolveExamplePath(title), 'latin1');
    } catch {
      problems.push(`${name}: link "${text}" names missing file ${title}`);
      continue;
    }
    if (!title.startsWith('public/')) {
      // Catalog presets are compiled by the catalog fidelity gate already.
      compileOrReport(`${name} → ${title}`, source);
    }
    const expected = runUrlFor(source);
    if (url !== expected) {
      if (write) {
        updated = updated.replace(full, `[${text}](${expected} "${title}")`);
      } else {
        problems.push(
          `${name}: stale run link for ${title} (run: bun run scripts/check-authoring-examples.ts --write)`,
        );
      }
    }
  }

  if (write && updated !== original) {
    writeFileSync(mdPath, updated);
    console.log(`updated links in docs/authoring/${name}`);
  }
}

for (const name of exampleFiles) {
  if (!linkedTitles.has(`examples/${name}`)) {
    problems.push(
      `examples/${name} is not linked from any docs/authoring/*.md lesson`,
    );
  }
}

if (problems.length > 0) {
  console.error(`check-authoring-examples: ${problems.length} problem(s)`);
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  process.exit(1);
}
console.log(
  `check-authoring-examples: ${exampleFiles.length} examples compile, ${markdownFiles.length} lesson files, all run links current.`,
);
