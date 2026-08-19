/**
 * Reject non-descriptive commit messages — the "hopeful commit" pattern
 * that signalled debugging-by-trial without root-cause isolation and
 * clustered before follow-up fix flurries: "certainly this works",
 * "hopefully works", "fixes", "fixed", "stims", "Various fixes".
 *
 * Also enforces Conventional Commits type prefix (feat/fix/refactor/...).
 * Exits non-zero on a violation so a husky `commit-msg` hook or CI can
 * gate on it.
 *
 * `--range` exists because the hook alone did not hold: commits authored
 * outside the local hook path (the GitHub web editor's "Update <file>"
 * commits among them) landed on main with subjects this guard rejects, and
 * CI had dropped its own commit-message job on the assumption that husky
 * covered every path. Range mode is that missing backstop.
 *
 * Usage: bun run scripts/check-commit-msg.ts <commit-msg-file>
 *        or:   echo "<message>" | bun run scripts/check-commit-msg.ts -
 *        or:   bun run scripts/check-commit-msg.ts --range <base>..<head>
 *              [--allow-long-subjects]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Returns an error string when the subject violates a rule, else null. */
export function subjectError(
  subject: string,
  { enforceLength = true }: { enforceLength?: boolean } = {},
): string | null {
  const BAD_SUBJECTS =
    /^(fixes|fixed|stims|various fixes|certainly this works|hopefully works|hopefully|it works|works now|wip)$/i;
  const HOPEFUL = /\b(certainly|hopefully)\b/i;

  if (BAD_SUBJECTS.test(subject) || HOPEFUL.test(subject)) {
    return (
      `Commit subject is non-descriptive: "${subject}"\n` +
      '  Describe what changed and why. "certainly this works" / "fixes" / ' +
      '"Various fixes" gave no signal and preceded repeated fix flurries.'
    );
  }

  const CONVENTIONAL =
    /^(feat|fix|refactor|chore|docs|test|style|perf|ci|build|revert|hotfix)(\([^)]+\))?!?: .+/;
  if (!CONVENTIONAL.test(subject)) {
    return (
      `Commit subject must use Conventional Commits: "${subject}"\n` +
      '  Expected: type(scope): summary  (e.g. fix(audio): close context on unmount)'
    );
  }

  if (enforceLength && subject.length > 72) {
    return `Commit subject exceeds 72 chars (${subject.length}): "${subject}"`;
  }

  return null;
}

function subjectOf(raw: string): string {
  const message = raw
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n')
    .trim();
  return message.split('\n')[0] ?? '';
}

const rangeIndex = process.argv.indexOf('--range');
// The 72-char ceiling is style, not signal: it is the one rule current
// practice breaks routinely on otherwise-good subjects, so range mode can
// waive it and gate only on what actually leaked — a missing Conventional
// prefix and non-descriptive subjects. The local hook still enforces length.
const enforceLength = !process.argv.includes('--allow-long-subjects');

if (rangeIndex !== -1) {
  const range = process.argv[rangeIndex + 1];
  if (!range) {
    console.error('✖ --range requires a <base>..<head> argument');
    process.exit(1);
  }

  // Merges carry GitHub's own generated subject, which no author controls.
  const subjects = execFileSync(
    'git',
    ['log', '--no-merges', '--pretty=%s', range],
    { encoding: 'utf8' },
  )
    .split('\n')
    .filter((line) => line.trim() !== '');

  const failures = subjects
    .map((subject) => ({
      subject,
      error: subjectError(subject, { enforceLength }),
    }))
    .filter((r): r is { subject: string; error: string } => r.error !== null);

  for (const { error } of failures) {
    console.error(`✖ ${error}`);
  }

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} of ${subjects.length} commit(s) in ${range} violate the message policy.`,
    );
    process.exit(1);
  }

  console.log(`✔ ${subjects.length} commit subject(s) in ${range} are clean.`);
  process.exit(0);
}

const raw = process.argv[2]
  ? process.argv[2] === '-'
    ? await new Response(Bun.stdin.stream()).text()
    : readFileSync(process.argv[2], 'utf8')
  : '';

const error = subjectError(subjectOf(raw));
if (error) {
  console.error(`✖ ${error}`);
  process.exit(1);
}

process.exit(0);
