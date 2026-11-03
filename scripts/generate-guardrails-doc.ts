#!/usr/bin/env bun
/**
 * Generates `docs/GUARDRAILS.md` — the rules this repo enforces — from the
 * guard scripts themselves.
 *
 * The 25 `check:*` scripts encode the repo's unwritten rules, and most already
 * explain their own rationale in a docblock. That rationale was only reachable
 * by opening `scripts/`, so in practice contributors met each rule by tripping
 * it. This generator surfaces the explanations that already exist as one page a
 * person can read before writing code.
 *
 * Generated, not written, for the same reason `bun run help` is: a hand-kept
 * list of guards drifts the moment someone adds one, and a stale list of rules
 * is worse than none. `--check` fails when the committed page is out of date,
 * so the docblock is the single source of truth.
 *
 * Run `bun run generate:guardrails` to refresh, `--check` in the quality gate.
 */
import { runCli } from 'agent-ergonomics';

if (import.meta.main)
  process.exit(await runCli(['guardrails', ...process.argv.slice(2)]));
