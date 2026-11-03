/**
 * Scaffolds a pull-request description from the branch's diff, and checks a
 * finished one against the rules a CI description check applies.
 *
 * Every PR needs a body that says what changed and how it was verified, and
 * writing the template's sections by hand is the same rote work each time.
 * This prints a body with the facts it can know — the changed tests and docs,
 * the template's checklists — and leaves `TODO:` markers for the parts only
 * the author can supply. It never ticks a checklist box: a tick is a claim
 * that a check was run, and this has not run it.
 *
 * `--check` applies two rules (not empty, and says how it was verified) plus
 * one local rule: no `TODO:` left behind.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { AgentErgonomicsConfig } from './config.ts';
import { argValue, type Command } from './context.ts';
import { makeGit } from './git.ts';

export type ScaffoldInput = {
  commits: string[];
  files: string[];
  /** Contents of the PR template, or null if absent. */
  template: string | null;
  footer?: string;
};

export type PrBodyRules = Pick<
  AgentErgonomicsConfig['prBody'],
  'checklistHeading' | 'docPath' | 'testPath'
>;

/** The template's checklist sections, verbatim and unticked. */
function checklistsFrom(template: string | null, heading: RegExp): string {
  if (!template) return '';
  const start = template.search(heading);
  if (start === -1) return '';
  return template
    .slice(start)
    .trim()
    .replace(/\[[xX]\]/gu, '[ ]');
}

export function buildPrBody(
  { commits, files, template, footer }: ScaffoldInput,
  rules: PrBodyRules,
): string {
  const tests = files.filter((f) => rules.testPath.test(f));
  const docs = files.filter((f) => rules.docPath.test(f));

  const testLines = [
    'TODO: each command you ran and its result (a bare "tests pass" is not evidence).',
    ...(tests.length > 0
      ? [
          `Tests added or changed: ${tests.map((t) => `\`${t}\``).join(', ')}`,
          'TODO: confirm each new test fails without the change (mutate-check), or say why not.',
        ]
      : ['TODO: no test files changed — say why no test covers this.']),
  ];

  const sections = [
    `## Summary\n\nTODO: what changed and why (${commits.length} commit${commits.length === 1 ? '' : 's'} on this branch).`,
    `## Testing\n\n${testLines.map((line) => `- ${line}`).join('\n')}`,
    `## Docs touched\n\n${
      docs.length > 0 ? docs.map((d) => `- \`${d}\``).join('\n') : 'None'
    }`,
  ];
  const checklists = checklistsFrom(template, rules.checklistHeading);
  if (checklists) sections.push(checklists);
  if (footer) sections.push(footer);
  return `${sections.join('\n\n')}\n`;
}

/**
 * The description rules, plus a TODO check. Returns the problems; an empty
 * array means the body would pass.
 */
export function validatePrBody(body: string): string[] {
  const stripped = body
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/^\s*[-*]\s*$/gmu, ' ')
    .trim();
  const placeholder = /^(n\/?a|none|-|tbd|wip|\.)$/iu;
  const errors: string[] = [];

  if (!stripped || placeholder.test(stripped)) {
    errors.push('The description is empty or a placeholder.');
  } else {
    const evidence = [
      /^#{1,6}\s*(testing|tests?|verification|verified|evidence|how i tested|validation|proof|measured)\b/imu,
      /\b(bun run|npm run|pnpm|yarn|pytest|cargo|make)\s+[\w:.-]+/iu,
      /\b(test|tests|suite|gate|check|ci)\b(?:[^.\n]|\.(?=\S)){0,120}\b(pass|passes|passed|green|fail|red)\b/iu,
      /\b\d+(\.\d+)?\s*(%|ms|fps|px|kb|mb)\b/iu,
      /\bbefore\b[^.\n]{0,60}\bafter\b/iu,
    ].some((pattern) => pattern.test(body));
    if (!evidence) {
      errors.push(
        'Nothing says how you know this works: name the tests or checks you ran, or give a measurement.',
      );
    }
  }

  // Only markers the scaffold emits: a line (or list item) that STARTS with
  // `TODO:`. A body that merely mentions the word in prose must pass.
  const todos = body
    .split('\n')
    .filter((line) => /^\s*(?:[-*]\s+)?TODO:/u.test(line));
  if (todos.length > 0) {
    errors.push(
      `${todos.length} unfinished TODO line(s):\n${todos
        .slice(0, 5)
        .map((line) => `    ${line.trim()}`)
        .join('\n')}`,
    );
  }
  return errors;
}

/** `pr-body [--base <ref>] [--footer <text>] | --check <file|->` */
export const runPrBody: Command = async (
  args,
  { config, cwd, io, readStdin },
) => {
  const { prBody } = config;
  if (args.includes('--check')) {
    const source = argValue(args, '--check');
    if (!source) {
      io.error(`Usage: ${config.commands.prBody} -- --check <file|->`);
      return 2;
    }
    const file = resolve(cwd, source);
    const body =
      source === '-'
        ? await readStdin()
        : existsSync(file)
          ? readFileSync(file, 'utf8')
          : null;
    if (body === null) {
      io.error(`No such file: ${source}`);
      return 2;
    }
    const errors = validatePrBody(body);
    if (errors.length === 0) {
      io.log('✓ PR description would pass CI.');
      return 0;
    }
    io.error(errors.map((e) => `✖ ${e}`).join('\n'));
    return 1;
  }

  const git = makeGit(cwd);
  const base = argValue(args, '--base') ?? prBody.defaultBase;
  const commits = git('log', '--reverse', '--format=%s', `${base}..HEAD`)
    .out.split('\n')
    .filter(Boolean);
  const files = git('diff', '--name-only', `${base}...HEAD`)
    .out.split('\n')
    .filter(Boolean);
  if (commits.length === 0) {
    io.error(
      `No commits ahead of ${base}; nothing to describe. (Fetch it first if it is stale: git fetch ${config.git.remote} ${config.git.defaultBase}.)`,
    );
    return 1;
  }
  const templatePath = join(cwd, prBody.templatePath);
  const template = existsSync(templatePath)
    ? readFileSync(templatePath, 'utf8')
    : null;

  // Commit subjects go to stderr as a writing aid so they do not end up in
  // the body file the author pipes stdout into.
  io.error(
    `Commits vs ${base}:\n${commits.map((c) => `  - ${c}`).join('\n')}\n`,
  );
  io.log(
    buildPrBody(
      { commits, files, template, footer: argValue(args, '--footer') },
      prBody,
    ).slice(0, -1),
  );
  return 0;
};
