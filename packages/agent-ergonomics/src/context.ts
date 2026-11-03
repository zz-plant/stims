/**
 * What every subcommand runs with: the resolved config, the repository root,
 * the environment, and where its lines go. Subcommands write through `io`
 * rather than `console` so a test can collect their output in-process, and
 * they return an exit code rather than calling `process.exit`, so one failing
 * step cannot take a test runner down with it.
 */
import type { AgentErgonomicsConfig } from './config.ts';

export type Io = {
  log: (line?: string) => void;
  error: (line?: string) => void;
  warn: (line?: string) => void;
};

export const consoleIo: Io = {
  log: (line = '') => console.log(line),
  error: (line = '') => console.error(line),
  warn: (line = '') => console.warn(line),
};

/** An `Io` that keeps every line, for tests and for callers that render later. */
export function collectIo(): Io & { logged: string[]; errored: string[] } {
  const logged: string[] = [];
  const errored: string[] = [];
  return {
    logged,
    errored,
    log: (line = '') => {
      logged.push(line);
    },
    error: (line = '') => {
      errored.push(line);
    },
    warn: (line = '') => {
      errored.push(line);
    },
  };
}

export type CommandContext = {
  config: AgentErgonomicsConfig;
  /** The repository root every relative path in the config resolves against. */
  cwd: string;
  env: Record<string, string | undefined>;
  io: Io;
  /** Where the config was loaded from, for messages that send people to it. */
  configPath?: string;
  readStdin: () => Promise<string>;
};

export type Command = (
  args: string[],
  context: CommandContext,
) => Promise<number> | number;

/** `--flag value` lookup; undefined when the flag is absent. */
export function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}
