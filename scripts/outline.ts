#!/usr/bin/env bun
/**
 * Lists every declaration in a source file with its line range, so you read
 * the one function you need instead of paging through the file.
 *
 * Run with `bun run outline <file>…`. Nested declarations shorter than six
 * lines or more than two levels down are left out: `--match <name>` finds one
 * wherever it is, `--min-lines` and `--depth` move the limits, and `--json`
 * emits the whole tree. Reads TypeScript and JavaScript, including JSX.
 */
import { runCli } from 'agent-ergonomics';

if (import.meta.main)
  process.exit(await runCli(['outline', ...process.argv.slice(2)]));
