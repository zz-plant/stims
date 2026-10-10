#!/usr/bin/env bun
/**
 * Fails when a source file grows past a monolith threshold.
 *
 * A file's length is the strongest cheap proxy for the costs that actually
 * hurt: every change touches more context, every review reads more code, and
 * every git-blame funnels through one path. The repo's largest files are also
 * its most-changed ones — the evidence that size and maintenance pain travel
 * together here.
 *
 * The default limit is 5000 lines across src/, scripts/, tests/, and
 * functions/ (.ts/.tsx/.js/.jsx/.mjs, plus .css under src/). Files already
 * over it are listed in KNOWN_EXCEEDANCES frozen at their current size: they
 * pass, but any growth fails immediately. The list is a ratchet, not an
 * amnesty — entries are removed as the files are split, and the limit they
 * return to is the default.
 *
 * Split targets are named in the docblock rationale of each entry. New
 * deliberately-large files are not addable by editing this script alone;
 * an entry needs a reason that will still be true in a year.
 */
import { Glob } from 'bun';

const SCAN_DIRS = ['src', 'scripts', 'tests', 'functions'] as const;
const CODE_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mjs'] as const;
const CSS_EXTENSIONS = ['css'] as const;

const DEFAULT_LIMIT = 5000;

type Exceedance = {
  path: string;
  limit: number;
  reason: string;
};

/**
 * Files that already exceed DEFAULT_LIMIT, frozen at the size they were when
 * this guard landed. The limit is their current line count, so the first
 * added line fails the gate. Remove an entry when its file is split below
 * DEFAULT_LIMIT — not by raising the limit when the file grows.
 */
const KNOWN_EXCEEDANCES: Exceedance[] = [
  {
    path: 'src/css/app-shell.css',
    limit: 5102,
    reason:
      'the pre-CSS-modules global stylesheet; surfaces are migrating to *.module.css files colocated with their components',
  },
  {
    path: 'tests/unit/milkdrop-renderer-adapter.test.ts',
    limit: 5299,
    reason:
      'the dual-backend renderer adapter contract; splits along backend seams (webgl vs webgpu) when it next grows',
  },
];

function exceedanceFor(path: string): Exceedance | undefined {
  return KNOWN_EXCEEDANCES.find((entry) => entry.path === path);
}

async function scanFiles(
  dir: string,
  extensions: readonly string[],
): Promise<string[]> {
  const files: string[] = [];
  for (const ext of extensions) {
    const glob = new Glob(`**/*.${ext}`);
    for await (const file of glob.scan({ cwd: dir, absolute: false })) {
      // Vendor and build outputs never count; only source under our control.
      if (file.includes('node_modules') || file.includes('dist/')) continue;
      files.push(file);
    }
  }
  return files;
}

async function countLines(path: string): Promise<number> {
  const content = await Bun.file(path).text();
  // Match `wc -l`: a single trailing newline is a terminator, not a line.
  const trimmed = content.trimEnd();
  return trimmed === '' ? 0 : trimmed.split('\n').length;
}

const violations: string[] = [];
const staleEntries: string[] = [];

for (const dir of SCAN_DIRS) {
  const extensions =
    dir === 'src' ? [...CODE_EXTENSIONS, ...CSS_EXTENSIONS] : CODE_EXTENSIONS;
  for (const file of await scanFiles(dir, extensions)) {
    const relPath = `${dir}/${file}`;
    const known = exceedanceFor(relPath);
    const limit = known?.limit ?? DEFAULT_LIMIT;
    const lines = await countLines(relPath);
    if (known && lines <= known.limit * 0.9) {
      // Listed well under its frozen limit: the split probably happened and
      // the entry is stale. Kept out of the failures so shrinking a file can
      // never turn the guard red; surfaced for cleanup instead.
      staleEntries.push(relPath);
      continue;
    }
    if (lines > limit) {
      violations.push(
        `${relPath}: ${lines} lines (limit ${limit}${
          known ? ', frozen' : ''
        })${known ? ` — ${known.reason}` : ''}`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error('Files over the monolith size limit:');
  for (const violation of violations) {
    console.error(`  ${violation}`);
  }
  console.error(
    '\nSplit the file along its existing seams instead of growing it. ' +
      'A listed file grew past its frozen size — the ratchet exists so the ' +
      'largest files can only shrink.',
  );
  process.exit(1);
}

for (const stale of staleEntries) {
  console.log(
    `[INFO] ${stale} is well under its KNOWN_EXCEEDANCES limit; remove the entry.`,
  );
}

console.log(
  `File size ratchet passed: no file over ${DEFAULT_LIMIT} lines, ` +
    `${KNOWN_EXCEEDANCES.length} frozen entries honored.`,
);
