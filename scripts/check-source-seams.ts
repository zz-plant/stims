/**
 * Fails on source seams left behind by a promoted package — the references
 * that only work while the package's source still lives in packages/ here.
 *
 * A package whose role is `promoted` in scripts/package-manifest.ts has its
 * own repository; this repo consumes a published version. Two references are
 * seams, and each fails this check:
 *
 *  1. a `workspace:`-protocol dependency in any package.json — the app must
 *     depend on a version range resolved from the registry, not the workspace
 *     link that stopped existing with the directory.
 *  2. a subpath import into the package's source (`audio-reactive/src/...`)
 *     or a relative import reaching into `packages/<name>/...` — the
 *     published package exports its public entry points (`.` and `./worklet`
 *     for audio-reactive), not its internals. This is the seam that makes
 *     milkdrop-toolchain the hard case: dozens of `src/` subpath imports
 *     would each have to move behind a public entry point first.
 *
 * Standalone packages are exempt by design: deep `src/` subpaths are their
 * in-repo consumption path (see packages/README.md), and the `stims-source`
 * export condition depends on it.
 *
 *   bun run check:no-source-seams
 */

import type { Dirent } from 'node:fs';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { packageNames } from './package-manifest.ts';

const ROOT = process.cwd();

/** One dependency entry from a package.json, flattened for the check. */
export type DependencyRef = {
  file: string;
  name: string;
  version: string;
};

/** One code file to scan, as path-plus-text so tests can use synthetic files. */
export type SeamFile = {
  path: string;
  content: string;
};

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The seams in the given dependency entries and code files. No `promoted`
 * names means nothing to check: the scan is skipped entirely so the guard
 * costs nothing while every package is standalone.
 */
export function findSourceSeams({
  promoted,
  dependencies,
  files,
}: {
  promoted: readonly string[];
  dependencies: readonly DependencyRef[];
  files: readonly SeamFile[];
}): string[] {
  if (promoted.length === 0) return [];

  const errors: string[] = [];

  for (const dep of dependencies) {
    if (!promoted.includes(dep.name)) continue;
    if (dep.version.startsWith('workspace:')) {
      errors.push(
        `${dep.file}: ${dep.name} is promoted but is depended on as ` +
          `"${dep.version}" — use a version range resolved from the registry`,
      );
    }
  }

  // Any quoted literal starting with "<promoted>/" is an import specifier in
  // practice (static import, dynamic import, or a worklet/worker URL), so
  // scanning string literals catches every form without parsing the AST.
  const nameGroup = promoted.map(escapeRegExp).join('|');
  const subpathImport = new RegExp(`['"](?:${nameGroup})/src/[^'"]*['"]`, 'gu');
  const relativeIntoPackage = new RegExp(
    `['"][^'"]*\\bpackages/(?:${nameGroup})/`,
    'gu',
  );
  for (const file of files) {
    for (const match of file.content.matchAll(subpathImport)) {
      errors.push(
        `${file.path}: subpath import into a promoted package's source — ` +
          `${match[0]} resolves to nothing once the directory is gone; import ` +
          `the package's public entry points instead`,
      );
    }
    for (const match of file.content.matchAll(relativeIntoPackage)) {
      errors.push(
        `${file.path}: relative import into a promoted package — ` +
          `${match[0]}; depend on the published version instead`,
      );
    }
  }
  return errors;
}

/** Collects every dependency entry of every package.json under the repo root. */
function collectDependencies(): DependencyRef[] {
  const refs: DependencyRef[] = [];
  const packageJsonPaths = ['package.json'];
  try {
    for (const entry of readdirSync(join(ROOT, 'packages'), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) {
        packageJsonPaths.push(join('packages', entry.name, 'package.json'));
      }
    }
  } catch {
    // No packages directory: only the root manifest exists.
  }
  for (const relPath of packageJsonPaths) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(ROOT, relPath), 'utf8'),
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      for (const section of ['dependencies', 'devDependencies'] as const) {
        for (const [name, version] of Object.entries(manifest[section] ?? {})) {
          refs.push({ file: relPath, name, version });
        }
      }
    } catch {
      // An unreadable manifest is another check's problem (or no manifest).
    }
  }
  return refs;
}

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'output',
  'scratch',
  'screenshots',
  '_site',
]);

function collectCodeFiles(dir: string, out: SeamFile[] = []): SeamFile[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectCodeFiles(fullPath, out);
      continue;
    }
    if (!CODE_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
      continue;
    }
    out.push({
      path: relative(ROOT, fullPath),
      content: readFileSync(fullPath, 'utf8'),
    });
  }
  return out;
}

async function main() {
  const promoted = packageNames('promoted');
  if (promoted.length === 0) {
    console.log('✔ no promoted packages, no source seams to check');
    return;
  }
  const files: SeamFile[] = [];
  for (const dir of ['src', 'scripts', 'functions', 'tests', 'spec']) {
    const full = join(ROOT, dir);
    if (statSync(full, { throwIfNoEntry: false })?.isDirectory()) {
      collectCodeFiles(full, files);
    }
  }
  const errors = findSourceSeams({
    promoted,
    dependencies: collectDependencies(),
    files,
  });
  if (errors.length > 0) {
    console.error(`✖ source seams found (${errors.length}):\n`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log(
    `✔ no source seams for promoted packages (${promoted.join(', ')}), ` +
      `${files.length} files scanned`,
  );
}

if (import.meta.main) {
  await main();
}
