/**
 * Reject non-descriptive commit messages — the "hopeful commit" pattern
 * that signalled debugging-by-trial without root-cause isolation and
 * clustered before follow-up fix flurries: "certainly this works",
 * "hopefully works", "fixes", "fixed", "stims", "Various fixes".
 *
 * Also enforces Conventional Commits type prefix (feat/fix/refactor/...).
 * Exits non-zero on a violation so a lefthook `commit-msg` hook or CI can
 * gate on it.
 *
 * `--range` exists because the hook alone did not hold: commits authored
 * outside the local hook path (the GitHub web editor's "Update <file>"
 * commits among them) landed on main with subjects this guard rejects, and
 * CI had dropped its own commit-message job on the assumption that the hook
 * covered every path. Range mode is that missing backstop.
 *
 * Usage: bun run scripts/check-commit-msg.ts <commit-msg-file>
 *        or:   echo "<message>" | bun run scripts/check-commit-msg.ts -
 *        or:   bun run scripts/check-commit-msg.ts --range <base>..<head>
 *              [--allow-long-subjects]
 */
import { runCli } from 'agent-ergonomics';

if (import.meta.main)
  process.exit(await runCli(['commit-msg', ...process.argv.slice(2)]));
