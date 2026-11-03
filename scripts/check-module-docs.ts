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
import { runCli } from 'agent-ergonomics';

if (import.meta.main)
  process.exit(await runCli(['module-docs', ...process.argv.slice(2)]));
