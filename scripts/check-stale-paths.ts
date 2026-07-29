/**
 * Guard against references to the pre-`src/` tree.
 *
 * The move from `assets/**` to `src/**` left 353 dangling references across
 * docs, agent skills, CODEOWNERS, and the labeler config. Docs that lie are
 * worse than missing docs — agents follow the routing tables in
 * `.claude/CLAUDE.md` straight into them — and CODEOWNERS globs that match
 * nothing silently disable review requirements.
 *
 * `docs/archive/` is exempt: archived material is a record of what was true
 * at the time, not a live instruction.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['.agent', 'docs', '.github', 'src', 'scripts', 'tests'];
const EXTRA_FILES = ['AGENTS.md', 'README.md'];
const SKIP_DIRS = new Set([
  'archive',
  'node_modules',
  '.git',
  'dist',
  'screenshots',
]);
const STALE = /\bassets\/(js|data)\b/;

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const offenders: Array<{ file: string; line: number; text: string }> = [];

for (const file of [...ROOTS.flatMap((r) => walk(r)), ...EXTRA_FILES]) {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (!STALE.test(text)) continue;
  text.split('\n').forEach((line, i) => {
    if (STALE.test(line)) {
      offenders.push({ file, line: i + 1, text: line.trim().slice(0, 120) });
    }
  });
}

if (offenders.length > 0) {
  console.error(
    `Found ${offenders.length} reference(s) to the removed assets/ tree.\n` +
      `The source lives under src/js/** and src/data/** now.\n`,
  );
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line}  ${o.text}`);
  }
  process.exit(1);
}

console.log('✔ no references to the removed assets/ tree');
