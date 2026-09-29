/**
 * Scaffolds a pull-request description from the branch's diff, and checks a
 * finished one against the same rules CI applies.
 *
 * Every PR needs a body that says what changed and how it was verified, and
 * writing the template's sections by hand is the same rote work each time.
 * This prints a body with the facts it can know — the changed tests and docs,
 * the template's checklists — and leaves `TODO:` markers for the parts only the
 * author can supply. It never ticks a checklist box: a tick is a claim that a
 * check was run, and this script has not run it.
 *
 * `--check` applies the two rules of the "Validate PR description" job in
 * .github/workflows/pr-automation.yml (not empty, and says how it was verified)
 * plus one local rule: no `TODO:` left behind. The two CI rules are mirrored
 * here, so if that workflow's patterns change, change them here too.
 *
 * Usage:
 *   bun run pr:body                          # scaffold for HEAD vs origin/main
 *   bun run pr:body -- --base origin/develop
 *   bun run pr:body -- --footer "🤖 Generated with …"   # appended verbatim
 *   bun run pr:body -- --check body.md       # validate a finished body ('-' = stdin)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export type ScaffoldInput = {
  commits: string[];
  files: string[];
  /** Contents of .github/pull_request_template.md, or null if absent. */
  template: string | null;
  footer?: string;
};

const DOC_PATH =
  /^(docs\/|README\.md$|CONTRIBUTING\.md$|AGENTS\.md$|\.claude\/|\.agent\/|\.github\/AGENTS\.md$)/;
const TEST_PATH = /^tests\/.*\.test\.(?:ts|tsx|js|jsx)$/;

/** The template's checklist sections, verbatim and unticked. */
function checklistsFrom(template: string | null): string {
  if (!template) return '';
  const start = template.search(/^## Review risk checklist/m);
  if (start === -1) return '';
  return template
    .slice(start)
    .trim()
    .replace(/\[[xX]\]/g, '[ ]');
}

export function buildPrBody({
  commits,
  files,
  template,
  footer,
}: ScaffoldInput): string {
  const tests = files.filter((f) => TEST_PATH.test(f));
  const docs = files.filter((f) => DOC_PATH.test(f));

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
  const checklists = checklistsFrom(template);
  if (checklists) sections.push(checklists);
  if (footer) sections.push(footer);
  return `${sections.join('\n\n')}\n`;
}

/**
 * Local mirror of the CI "Validate PR description" job, plus a TODO check.
 * Returns the problems; an empty array means the body would pass.
 */
export function validatePrBody(body: string): string[] {
  const stripped = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^\s*[-*]\s*$/gm, ' ')
    .trim();
  const placeholder = /^(n\/?a|none|-|tbd|wip|\.)$/i;
  const errors: string[] = [];

  if (!stripped || placeholder.test(stripped)) {
    errors.push('The description is empty or a placeholder.');
  } else {
    const evidence = [
      /^#{1,6}\s*(testing|tests?|verification|verified|evidence|how i tested|validation|proof|measured)\b/im,
      /\b(bun run|npm run|pnpm|yarn|pytest|cargo|make)\s+[\w:.-]+/i,
      /\b(test|tests|suite|gate|check|ci)\b(?:[^.\n]|\.(?=\S)){0,120}\b(pass|passes|passed|green|fail|red)\b/i,
      /\b\d+(\.\d+)?\s*(%|ms|fps|px|kb|mb)\b/i,
      /\bbefore\b[^.\n]{0,60}\bafter\b/i,
    ].some((pattern) => pattern.test(body));
    if (!evidence) {
      errors.push(
        'Nothing says how you know this works: name the tests or checks you ran, or give a measurement.',
      );
    }
  }

  const todos = body.split('\n').filter((line) => /\bTODO:/.test(line));
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

function git(...args: string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

if (import.meta.main) {
  const argv = process.argv.slice(2);

  if (argv.includes('--check')) {
    const source = argValue(argv, '--check');
    if (!source) {
      console.error('Usage: bun run pr:body -- --check <file|->');
      process.exit(2);
    }
    const body =
      source === '-'
        ? await Bun.stdin.text()
        : existsSync(source)
          ? readFileSync(source, 'utf8')
          : null;
    if (body === null) {
      console.error(`No such file: ${source}`);
      process.exit(2);
    }
    const errors = validatePrBody(body);
    if (errors.length === 0) {
      console.log('✓ PR description would pass CI.');
      process.exit(0);
    }
    console.error(errors.map((e) => `✖ ${e}`).join('\n'));
    process.exit(1);
  }

  const base = argValue(argv, '--base') ?? 'origin/main';
  const commits = git('log', '--reverse', '--format=%s', `${base}..HEAD`)
    .split('\n')
    .filter(Boolean);
  const files = git('diff', '--name-only', `${base}...HEAD`)
    .split('\n')
    .filter(Boolean);
  if (commits.length === 0) {
    console.error(
      `No commits ahead of ${base}; nothing to describe. (Fetch it first if it is stale: git fetch origin main.)`,
    );
    process.exit(1);
  }
  const templatePath = '.github/pull_request_template.md';
  const template = existsSync(templatePath)
    ? readFileSync(templatePath, 'utf8')
    : null;

  // Commit subjects go to stderr as a writing aid so they do not end up in the
  // body file the author pipes stdout into.
  console.error(
    `Commits vs ${base}:\n${commits.map((c) => `  - ${c}`).join('\n')}\n`,
  );
  process.stdout.write(
    buildPrBody({
      commits,
      files,
      template,
      footer: argValue(argv, '--footer'),
    }),
  );
}
