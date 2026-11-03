/**
 * Rejects non-descriptive commit messages and enforces a Conventional
 * Commits type prefix, for a `commit-msg` hook or a CI range check.
 *
 * The "hopeful commit" ("certainly this works", "fixes", "Various fixes")
 * signals debugging by trial without root-cause isolation, and clusters
 * before follow-up fix flurries; the configured patterns name the subjects
 * a repo has learned to reject. `--range` exists because a hook alone does
 * not hold: commits authored outside the local hook path (a web editor's
 * "Update <file>" among them) land on the default branch unless CI checks
 * the range too.
 *
 * Length is style, not signal: a subject over the limit warns in hook mode
 * and can be waived in range mode with `--allow-long-subjects`, so the gate
 * blocks only on what actually leaked — a missing type prefix and a
 * non-descriptive subject.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentErgonomicsConfig } from './config.ts';
import type { Command } from './context.ts';

export type CommitMsgRules = AgentErgonomicsConfig['commitMsg'];

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Returns an error string when the subject violates a rule, else null. */
export function subjectError(
  subject: string,
  rules: CommitMsgRules,
  { enforceLength = true }: { enforceLength?: boolean } = {},
): string | null {
  if (rules.badSubjects.test(subject) || rules.hopeful.test(subject)) {
    return `Commit subject is non-descriptive: "${subject}"\n  ${rules.badSubjectHint}`;
  }

  // Subjects git writes itself say what happened, and a squash-merging repo
  // never lets them reach the default branch as-is.
  if (rules.gitGenerated.test(subject)) return null;

  const conventional = new RegExp(
    `^(${rules.types.map(escapeRegExp).join('|')})(\\([^)]+\\))?!?: .+`,
    'u',
  );
  if (!conventional.test(subject)) {
    return (
      `Commit subject must use Conventional Commits: "${subject}"\n` +
      `  Expected: type(scope): summary  (e.g. ${rules.example})`
    );
  }

  if (enforceLength && subject.length > rules.subjectLengthLimit) {
    return `Commit subject exceeds ${rules.subjectLengthLimit} chars (${subject.length}): "${subject}"`;
  }
  return null;
}

export function subjectOf(raw: string): string {
  const message = raw
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n')
    .trim();
  return message.split('\n')[0] ?? '';
}

/** `commit-msg <file|-> | --range <base>..<head> [--allow-long-subjects]` */
export const runCommitMsg: Command = async (
  args,
  { config, cwd, io, readStdin },
) => {
  const rules = config.commitMsg;
  const rangeIndex = args.indexOf('--range');
  const enforceLength = !args.includes('--allow-long-subjects');

  if (rangeIndex !== -1) {
    const range = args[rangeIndex + 1];
    if (!range) {
      io.error('✖ --range requires a <base>..<head> argument');
      return 1;
    }
    // Merges carry the forge's own generated subject, which no author controls.
    const subjects = execFileSync(
      'git',
      ['log', '--no-merges', '--pretty=%s', range],
      {
        cwd,
        encoding: 'utf8',
      },
    )
      .split('\n')
      .filter((line) => line.trim() !== '');
    const failures = subjects
      .map((subject) => ({
        subject,
        error: subjectError(subject, rules, { enforceLength }),
      }))
      .filter((r): r is { subject: string; error: string } => r.error !== null);
    for (const { error } of failures) io.error(`✖ ${error}`);
    if (failures.length > 0) {
      io.error(
        `\n${failures.length} of ${subjects.length} commit(s) in ${range} violate the message policy.`,
      );
      return 1;
    }
    io.log(`✔ ${subjects.length} commit subject(s) in ${range} are clean.`);
    return 0;
  }

  const source = args.find((arg) => !arg.startsWith('--'));
  const raw = source
    ? source === '-'
      ? await readStdin()
      : readFileSync(resolve(cwd, source), 'utf8')
    : '';
  const subject = subjectOf(raw);

  // Length is style; the other rules are signal. Blocking a commit locally
  // over a few characters, after the message is written and the gate has
  // run, buys nothing but a retype. Say it and move on.
  const lengthOnly =
    subjectError(subject, rules) !== null &&
    subjectError(subject, rules, { enforceLength: false }) === null;
  if (lengthOnly) {
    io.warn(
      `! Commit subject is ${subject.length} chars; ${rules.subjectLengthLimit} keeps \`git log --oneline\` scannable.`,
    );
    return 0;
  }
  const error = subjectError(subject, rules);
  if (error) {
    io.error(`✖ ${error}`);
    return 1;
  }
  return 0;
};
