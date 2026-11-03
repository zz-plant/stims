#!/usr/bin/env bun
/** Dispatches repository tooling through one validated configuration file. */
import { resolve } from 'node:path';
import { runBranchRestart } from './branch-restart.ts';
import { runCommitMsg } from './commit-msg.ts';
import { loadConfig } from './config.ts';
import { type Command, consoleIo, type Io } from './context.ts';
import { runDocReferences } from './doc-references.ts';
import { runGateCommand } from './gate.ts';
import { runGuardrails } from './guardrails.ts';
import { runModuleDocs } from './module-docs.ts';
import { runPrBody } from './pr-body.ts';
import { runHelp } from './scripts-index.ts';
import { runTestSourceGreps } from './test-source-greps.ts';
import { runWorktreeNew } from './worktree-new.ts';

const commands: Record<string, Command> = {
  help: runHelp,
  gate: runGateCommand,
  guardrails: runGuardrails,
  'doc-refs': runDocReferences,
  'module-docs': runModuleDocs,
  'test-source-greps': runTestSourceGreps,
  'branch-restart': runBranchRestart,
  'worktree-new': runWorktreeNew,
  'pr-body': runPrBody,
  'commit-msg': runCommitMsg,
};

export type CliOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  io?: Io;
  readStdin?: () => Promise<string>;
};

/** Runs the CLI without terminating its caller; relative paths use the selected root. */
export async function runCli(
  argv: string[] = process.argv.slice(2),
  options: CliOptions = {},
): Promise<number> {
  const io = options.io ?? consoleIo;
  let cwd = options.cwd ?? process.cwd();
  let configPath: string | undefined;
  const args = [...argv];
  for (let index = 0; index < args.length; ) {
    const flag = args[index];
    if (flag !== '--config' && flag !== '--cwd') {
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      io.error(`${flag} requires a path`);
      return 2;
    }
    if (flag === '--cwd') cwd = resolve(cwd, value);
    else configPath = value;
    args.splice(index, 2);
  }
  const name = args.shift();
  if (!name || name === '--help' || name === '-h') {
    io.log(
      `Usage: agent-ergonomics <command> [--config <file>] [--cwd <root>] [options]\n\nCommands: ${Object.keys(commands).join(', ')}`,
    );
    return 0;
  }
  const command = Object.hasOwn(commands, name) ? commands[name] : undefined;
  if (!command) {
    io.error(
      `Unknown command ${JSON.stringify(name)}. Commands: ${Object.keys(commands).join(', ')}`,
    );
    return 2;
  }
  try {
    const loaded = await loadConfig(configPath, cwd);
    return await command(
      args.filter((arg) => arg !== '--'),
      {
        config: loaded.config,
        configPath: loaded.path,
        cwd,
        env: options.env ?? process.env,
        io,
        readStdin:
          options.readStdin ?? (() => new Response(Bun.stdin.stream()).text()),
      },
    );
  } catch (error) {
    io.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
}

if (import.meta.main) process.exit(await runCli());
