/**
 * Restarts a feature branch from the latest default branch after its pull
 * request was squash-merged, without losing work it would still need.
 *
 * A squash-merge leaves the branch's own commits unreachable from main, so the
 * manual recovery (`git checkout -B <branch> origin/main`) also leaves the
 * upstream tracking `origin/main` instead of `origin/<branch>`, and any hook
 * that compares against the upstream then reports commits that are already
 * merged as "unpushed". This does the reset once, correctly: it refuses when
 * there is uncommitted or unpushed work, resets only the LOCAL branch, points
 * the upstream at the remote feature branch when it exists, and prints the
 * exact push command. It never pushes: rewriting a remote branch is outward
 * facing and hard to undo, so that stays a deliberate second step.
 *
 * Usage:
 *   bun run branch:restart                      # current branch onto origin/main
 *   bun run branch:restart -- --branch <name>   # a named branch
 *   bun run branch:restart -- --base <name>     # a base other than main
 *   bun run branch:restart -- --dry-run         # print the plan, change nothing
 */
import { runCli } from 'agent-ergonomics';

if (import.meta.main)
  process.exit(await runCli(['branch-restart', ...process.argv.slice(2)]));
