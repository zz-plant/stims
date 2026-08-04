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
 * Usage: bun run scripts/check-commit-msg.ts <commit-msg-file>
 *        or:   echo "<message>" | bun run scripts/check-commit-msg.ts -
 */
import { readFileSync } from 'node:fs';

const raw = process.argv[2]
  ? process.argv[2] === '-'
    ? await new Response(Bun.stdin.stream()).text()
    : readFileSync(process.argv[2], 'utf8')
  : '';

const message = raw
  .split('\n')
  .filter((l) => !l.startsWith('#'))
  .join('\n')
  .trim();
const subject = message.split('\n')[0] ?? '';

const BAD_SUBJECTS =
  /^(fixes|fixed|stims|various fixes|certainly this works|hopefully works|hopefully|it works|works now|wip)$/i;
const HOPEFUL = /\b(certainly|hopefully)\b/i;

if (BAD_SUBJECTS.test(subject) || HOPEFUL.test(subject)) {
  console.error(
    `✖ Commit subject is non-descriptive: "${subject}"\n` +
      '  Describe what changed and why. "certainly this works" / "fixes" / ' +
      '"Various fixes" gave no signal and preceded repeated fix flurries.',
  );
  process.exit(1);
}

const CONVENTIONAL =
  /^(feat|fix|refactor|chore|docs|test|style|perf|ci|build|revert|hotfix)(\([^)]+\))?!?: .+/;
if (!CONVENTIONAL.test(subject)) {
  console.error(
    `✖ Commit subject must use Conventional Commits: "${subject}"\n` +
      '  Expected: type(scope): summary  (e.g. fix(audio): close context on unmount)',
  );
  process.exit(1);
}

if (subject.length > 72) {
  console.error(
    `✖ Commit subject exceeds 72 chars (${subject.length}): "${subject}"`,
  );
  process.exit(1);
}

process.exit(0);
