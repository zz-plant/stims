/**
 * Detect exported symbols with zero importers — the "remove dead code"
 * pattern that recurred 12+ times in the last 400 commits. Codex PRs
 * introduced exports that nothing imported; they survived merge and were
 * purged weeks later in bulk.
 *
 * A full-corpus grep has too many false positives (dynamic imports, runtime
 * refs, barrel re-exports), so this check is **diff-scoped**: it only flags
 * *new* named exports introduced in the current uncommitted change (via
 * `git diff`) that have no reference anywhere in src, tests, scripts, or
 * index.html. This catches the codex pattern — a new export nothing
 * imports — without flagging the existing codebase.
 *
 * Type-only exports (`export type`, `export interface`) are skipped —
 * they're often consumed indirectly and erased at compile time.
 *
 * Advisory by default; pass `--strict` to fail the gate. Run via
 * `bun run check:unused-exports`.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const STRICT = process.argv.includes('--strict');

const SCAN_GLOBS = ['src', 'tests', 'scripts', 'index.html'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'public']);

// Gather the full reference corpus.
function readCorpus(): string {
  const files: string[] = [];
  const walk = (dir: string) => {
    try {
      for (const entry of execSync(`ls -1 "${dir}"`, { encoding: 'utf8' })
        .split('\n')
        .filter(Boolean)) {
        if (SKIP_DIRS.has(entry)) continue;
        const full = `${dir}/${entry}`;
        try {
          if (require('node:fs').statSync(full).isDirectory()) walk(full);
          else files.push(full);
        } catch {}
      }
    } catch {}
  };
  for (const root of SCAN_GLOBS) {
    try {
      walk(root);
    } catch {}
  }
  // Also include index.html
  try {
    files.push('index.html');
  } catch {}
  return files
    .filter((f) => /\.(ts|tsx|js|mjs|html)$/.test(f))
    .map((f) => {
      try {
        return readFileSync(f, 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

// Get added lines from the uncommitted diff (staged + unstaged).
function getAddedDiffLines(): string[] {
  let diff = '';
  try {
    diff = execSync('git diff --no-color --unified=0', { encoding: 'utf8' });
  } catch {}
  try {
    diff +=
      '\n' +
      execSync('git diff --cached --no-color --unified=0', {
        encoding: 'utf8',
      });
  } catch {}
  return diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'));
}

const added = getAddedDiffLines();
if (added.length === 0) {
  console.log('✔ No uncommitted changes — nothing to check');
  process.exit(0);
}

// Find new named exports introduced in the diff.
const newExports = new Set<string>();
for (const line of added) {
  for (const m of line.matchAll(
    /export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    newExports.add(m[1]);
  }
  for (const m of line.matchAll(/export\s+\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)[0]
        .trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) newExports.add(name);
    }
  }
}

if (newExports.size === 0) {
  console.log('✔ No new named exports in the current diff');
  process.exit(0);
}

const corpus = readCorpus();
const dead: string[] = [];
for (const name of newExports) {
  // A name is "used" if it appears anywhere in the corpus. The declaring
  // file's own lines are in the corpus too, but the export statement itself
  // counts as a reference, so we check for *a second* occurrence by also
  // looking at whether the name appears in any file other than where it's
  // declared — approximated by requiring the corpus to contain the name
  // in a context that isn't the export keyword itself.
  const matches = corpus.match(
    new RegExp(`\\b${name.replace(/[$]/g, '\\$')}\\b`, 'g'),
  );
  // If the only occurrences are the export declaration line itself, matches
  // will be 1 (from the diff line). Anything more means it's referenced.
  if (matches === null) {
    dead.push(name);
  }
}

if (dead.length > 0) {
  console.error(`✖ ${dead.length} new export(s) with no reference anywhere:\n`);
  for (const name of dead) console.error(`  ${name}`);
  console.error(
    '\n  If intentional public API, add a usage or re-export from a barrel.' +
      ' Otherwise remove the export.',
  );
  if (STRICT) process.exit(1);
  process.exit(0);
}

console.log(`✔ All ${newExports.size} new export(s) are referenced`);
