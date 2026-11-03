#!/usr/bin/env bun
/**
 * Lists package.json scripts grouped by namespace, pulling each script's
 * one-line purpose from the docblock atop its target file.
 *
 * Run with `bun run scripts:list` (alias `bun run help`). `--json` emits the
 * same index as `{name, command, purpose}` records for tooling and agents;
 * `--check` fails when any script's target file lacks a docblock summary.
 *
 * `--for "<symptom>"` answers the question the plain listing cannot: not
 * "what scripts exist" but "which one answers what I am actually asking".
 * With well over a hundred scripts, knowing an instrument exists is not the same as knowing
 * it is the right one, and picking wrong costs an afternoon. Curated routes
 * come first because the best answer is often a script whose name shares no
 * words with the symptom ("my preset looks wrong" -> `parity:capture`);
 * keyword matching over the docblock index is the fallback.
 */
import { runCli } from 'agent-ergonomics';

if (import.meta.main)
  process.exit(await runCli(['help', ...process.argv.slice(2)]));
