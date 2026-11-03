/**
 * Requires a file-level docblock on the source modules big enough to need
 * one, with a shrink-only backlog for the files that predate the rule.
 *
 * The rule binds on size, not on directory, because size is what makes a
 * file expensive to re-derive: the hardest files in a repo are the ones a
 * newcomer opens cold. Below the threshold a good name usually suffices.
 *
 * The backlog lets the rule apply to new and newly-grown code immediately
 * instead of waiting on one enormous documentation diff. It is shrink-only:
 * the guard fails if an entry gains a docblock and stays listed, so progress
 * is recorded rather than quietly reverted, and it fails if an entry
 * disappears from disk. A summary that merely echoes the filename back is
 * rejected too: `// audio-handler.ts — audio handler` passes a regex and
 * teaches nobody anything.
 */
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Glob } from 'bun';
import type { AgentErgonomicsConfig } from './config.ts';
import type { Command } from './context.ts';
import { parseDocblock } from './docblock.ts';

/** True when the summary just echoes the filename back at the reader. */
export function isVacuous(summary: string, file: string): boolean {
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

export type ModuleDocsReport = {
  failures: string[];
  readyToRetire: string[];
  checked: number;
  documented: number;
};

export function checkModuleDocs(
  config: AgentErgonomicsConfig['moduleDocs'],
  root: string,
): ModuleDocsReport {
  const backlog = new Set(config.backlog);
  const failures: string[] = [];
  const readyToRetire: string[] = [];
  const missingFromDisk = new Set(backlog);
  let checked = 0;
  let documented = 0;

  const files = [...new Glob(config.include).scanSync(root)].sort();
  for (const rel of files) {
    const path = relative(root, join(root, rel)).replaceAll('\\', '/');
    let text: string;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    const lineCount = text.split(/\r?\n/u).length;
    const summary =
      parseDocblock(text, { openerWithin: config.docblockWindow })?.summary ||
      null;
    const backlogged = backlog.has(path);
    missingFromDisk.delete(path);

    if (backlogged && summary && summary.length >= config.minSummaryLength) {
      readyToRetire.push(path);
      documented += 1;
      continue;
    }
    if (lineCount <= config.minLines || backlogged) continue;

    checked += 1;
    if (!summary) {
      failures.push(
        `${path} (${lineCount} lines) has no file-level docblock.\n` +
          '        Add a /** … */ block at the top saying what the module owns, ' +
          'and what it deliberately leaves to others.',
      );
      continue;
    }
    if (summary.length < config.minSummaryLength) {
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
      `${stale} is listed in the moduleDocs backlog but no longer exists. Remove the entry.`,
    );
  }
  return { failures, readyToRetire, checked, documented };
}

/** `module-docs` */
export const runModuleDocs: Command = (
  _args,
  { config, cwd, io, configPath },
) => {
  const { moduleDocs } = config;
  const report = checkModuleDocs(moduleDocs, cwd);
  const failures = [...report.failures];
  const where = configPath
    ? relative(cwd, configPath)
    : 'the agent-ergonomics config';

  if (report.readyToRetire.length > 0) {
    io.log(
      `\x1b[32m[INFO]\x1b[0m ${report.readyToRetire.length} backlogged module(s) are now documented — thank you.`,
    );
    for (const path of report.readyToRetire) {
      io.error(`  - remove "${path}" from moduleDocs.backlog in ${where}`);
    }
    failures.push(
      'The backlog is shrink-only: documented entries must be removed from the list ' +
        'so the progress is recorded.',
    );
  }

  if (failures.length > 0) {
    io.error('\x1b[31m[ERROR]\x1b[0m Module documentation check failed:\n');
    for (const failure of failures) io.error(`  ✖ ${failure}\n`);
    io.error(
      `Files over ${moduleDocs.minLines} lines must introduce themselves.${
        moduleDocs.seeAlso ? ` See ${moduleDocs.seeAlso}.` : ''
      }`,
    );
    return 1;
  }

  io.log(
    `\x1b[32m[INFO]\x1b[0m Module docs OK — ${report.documented}/${report.checked + report.documented} module(s) over ${moduleDocs.minLines} lines documented, ` +
      `${moduleDocs.backlog.length} in the backlog.`,
  );
  return 0;
};
