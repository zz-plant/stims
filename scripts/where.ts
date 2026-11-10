#!/usr/bin/env bun
/**
 * Reports where a name is declared, which functions use it and which tests
 * touch it, each with line numbers, in one answer.
 *
 * Run with `bun run where <symbol>`. The match is the whole word across
 * tracked and untracked TypeScript and JavaScript; it is textual, so two
 * unrelated things sharing a name are reported together. `--path <prefix>`
 * narrows the search, `--all` lifts the per-section limits, and `--json`
 * emits the full report.
 */
import { runCli } from 'agent-ergonomics';

if (import.meta.main)
  process.exit(await runCli(['where', ...process.argv.slice(2)]));
