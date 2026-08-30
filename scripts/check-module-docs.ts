#!/usr/bin/env bun
/**
 * Requires a file-level docblock on the `src/` modules big enough to need one.
 *
 * `scripts-list.ts --check` already guarantees every script explains itself,
 * and that index is why `bun run help` cannot drift from the code. This guard
 * is the same contract applied to `src/`, where the payoff is larger: the
 * hardest files in the repo are the ones a newcomer opens cold. Reading
 * `shader-analysis.ts` today starts with a sixty-symbol import block and no
 * statement of what the file is for, or — just as costly — what it
 * deliberately does not do.
 *
 * The rule binds on size, not on directory, because size is what makes a file
 * expensive to re-derive. Below the threshold a good name usually suffices.
 *
 * Files that predate the guard are listed in `BACKLOG` so the rule can apply
 * to new and newly-grown code immediately instead of waiting on one enormous
 * documentation diff. The backlog is shrink-only: the guard fails if an entry
 * gains a docblock and stays listed, so progress is recorded rather than
 * quietly reverted, and it fails if an entry disappears from disk. Deleting
 * the last line of `BACKLOG` retires the mechanism.
 *
 * A summary is a paragraph a maintainer would write, not a restatement of the
 * filename: `// audio-handler.ts — audio handler` passes a regex and teaches
 * nobody anything, so the guard also rejects summaries that are merely the
 * filename echoed back.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Glob } from 'bun';

const ROOT = process.cwd();

/**
 * Lines of code above which a file must introduce itself. Chosen as the point
 * where "read the whole thing to find out what it does" stops being a
 * reasonable ask. Lower it as the backlog drains.
 */
const MIN_LINES = 400;

/** Shortest summary that can say anything useful, in characters. */
const MIN_SUMMARY_LENGTH = 40;

/**
 * Modules over `MIN_LINES` that predate this guard. Shrink-only — never add.
 * Removing an entry is the point; the guard tells you when one is ready to go.
 */
const BACKLOG = new Set<string>();

function logError(msg: string) {
  console.error(`\x1b[31m[ERROR]\x1b[0m ${msg}`);
}

function logInfo(msg: string) {
  console.log(`\x1b[32m[INFO]\x1b[0m ${msg}`);
}

/**
 * Pulls the first paragraph of a file-level docblock, mirroring the extraction
 * `scripts-list.ts` uses so both surfaces agree on what "documented" means.
 *
 * The opener must be near the top or an interior docblock describing some
 * constant would be read as the file's summary. The closer may be anywhere:
 * the best-documented files have the longest headers.
 */
function moduleSummary(text: string): string | null {
  const lines = text.split(/\r?\n/u);
  const start = lines
    .slice(0, 10)
    .findIndex((line) => line.trimStart().startsWith('/**'));
  if (start === -1) return null;

  let paragraph = '';
  for (const raw of lines.slice(start)) {
    const line = raw
      .replace(/^\s*\/?\*+\s?/u, '')
      .replace(/\*\/.*$/u, '')
      .trim();
    const done = raw.includes('*/');
    if (line.startsWith('@')) break;
    if (line.length === 0) {
      if (paragraph) break;
      if (done) break;
      continue;
    }
    paragraph = paragraph ? `${paragraph} ${line}` : line;
    if (done) break;
  }
  return paragraph || null;
}

/** True when the summary just echoes the filename back at the reader. */
function isVacuous(summary: string, file: string): boolean {
  const stem = (file.split('/').pop() ?? '').replace(/\.tsx?$/u, '');
  const words = stem.split(/[-_.]/u).filter(Boolean);
  const normalized = summary
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
  const withoutStem = words.reduce(
    (acc, word) => acc.replaceAll(word.toLowerCase(), ' '),
    normalized,
  );
  return withoutStem.replace(/\s+/gu, ' ').trim().length < 12;
}

const failures: string[] = [];
const readyToRetire: string[] = [];
const missingFromDisk = new Set(BACKLOG);

let checked = 0;
let documented = 0;

const glob = new Glob('src/js/**/*.{ts,tsx}');
const files = [...glob.scanSync(ROOT)].sort();

for (const rel of files) {
  const path = relative(ROOT, join(ROOT, rel)).replaceAll('\\', '/');
  let text: string;
  try {
    text = readFileSync(join(ROOT, rel), 'utf8');
  } catch {
    continue;
  }

  const lineCount = text.split(/\r?\n/u).length;
  const summary = moduleSummary(text);
  const backlogged = BACKLOG.has(path);
  missingFromDisk.delete(path);

  if (backlogged && summary && summary.length >= MIN_SUMMARY_LENGTH) {
    readyToRetire.push(path);
    documented += 1;
    continue;
  }

  if (lineCount <= MIN_LINES || backlogged) continue;

  checked += 1;

  if (!summary) {
    failures.push(
      `${path} (${lineCount} lines) has no file-level docblock.\n` +
        '        Add a /** … */ block at the top saying what the module owns, ' +
        'and what it deliberately leaves to others.',
    );
    continue;
  }
  if (summary.length < MIN_SUMMARY_LENGTH) {
    failures.push(
      `${path} (${lineCount} lines) has a docblock summary of only ` +
        `${summary.length} characters. Say what the module is for.`,
    );
    continue;
  }
  if (isVacuous(summary, path)) {
    failures.push(
      `${path} (${lineCount} lines) restates its own filename:\n` +
        `        "${summary}"\n` +
        '        Describe the job, not the name.',
    );
    continue;
  }
  documented += 1;
}

for (const stale of missingFromDisk) {
  failures.push(
    `${stale} is listed in BACKLOG but no longer exists. Remove the entry.`,
  );
}

if (readyToRetire.length > 0) {
  logInfo(
    `${readyToRetire.length} backlogged module(s) are now documented — thank you.`,
  );
  for (const path of readyToRetire) {
    console.error(
      `  - remove "${path}" from BACKLOG in ${relative(ROOT, __filename)}`,
    );
  }
  failures.push(
    'BACKLOG is shrink-only: documented entries must be removed from the list ' +
      'so the progress is recorded.',
  );
}

if (failures.length > 0) {
  logError('Module documentation check failed:\n');
  for (const failure of failures) console.error(`  ✖ ${failure}\n`);
  console.error(
    `Files over ${MIN_LINES} lines must introduce themselves. See docs/ONBOARDING.md.`,
  );
  process.exit(1);
}

logInfo(
  `Module docs OK — ${documented}/${checked + documented} module(s) over ${MIN_LINES} lines documented, ` +
    `${BACKLOG.size} in the backlog.`,
);
