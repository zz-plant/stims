/**
 * Guard against references to the pre-`src/` tree.
 *
 * The move from `assets/**` to `src/**` left 353 dangling references across
 * docs, agent skills, CODEOWNERS, and the labeler config. Docs that lie are
 * worse than missing docs — agents follow the routing tables in
 * `.claude/CLAUDE.md` straight into them — and CODEOWNERS globs that match
 * nothing silently disable review requirements.
 *
 * Historical records are exempt: `docs/archive/`, plus dated audits, critiques
 * and assessments. Those describe what a file tree looked like when someone
 * examined it, so rewriting their paths would misrepresent the record. The
 * guard covers material that is meant to be acted on today.
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

/**
 * Point-in-time findings rather than live instruction. These get archived
 * rather than maintained, so their paths are left as they were recorded.
 */
const HISTORICAL_RECORD =
  /(AUDIT|CRITIQUE|ANTI_PATTERNS|RESEARCH|_REPORT_|assessment)/i;

function isHistoricalRecord(file: string): boolean {
  const name = file.split('/').pop() ?? '';
  return file.startsWith('docs/') && HISTORICAL_RECORD.test(name);
}

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
  if (isHistoricalRecord(file)) continue;
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
