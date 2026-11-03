/**
 * Runs the repo quality gate — lint, typecheck, guard scripts, and tests — in
 * one of three progressively broader modes.
 *
 * Modes:
 *
 * - `quick`  — lint + typecheck only, no tests (~10s). Use constantly during
 *              development to catch type/style errors early.
 * - `full`   — lint + typecheck + gate test suite (unit + compat + corpus).
 *              This is the default `bun run check` mode. Corpus is in the gate
 *              because its parity and golden-snapshot tests guard the
 *              dual-backend boundary: leaving them to CI let a compiler change
 *              pass here and fail after push. Excludes e2e, which is serial,
 *              browser-backed, and slow.
 * - `all`    — lint + typecheck + every profile including e2e (~5min+). Use
 *              before merging changes to the MilkDrop compiler, renderer
 *              adapter, or parity pipeline.
 *
 * `--no-tests` drops the test suite from any mode, leaving the checks. It
 * exists for CI, which runs the suite as its own parallel job; locally,
 * `bun run check` should stay the single command that runs everything.
 */
import {
  type GateExecutionMode,
  type GateMode,
  parseOutputMode as outputMode,
  buildGatePlan as planGate,
  resolveConfig,
  runCli,
} from 'agent-ergonomics';
import stimsConfig from '../agent-ergonomics.config.ts';

export {
  type GateStepResult,
  parseExecutionMode,
  parseMode,
  parseSkipTests,
  printStepResult,
} from 'agent-ergonomics';

const config = resolveConfig(stimsConfig);
export const buildGatePlan = (
  mode: GateMode,
  executionMode: GateExecutionMode,
  skipTests = false,
) => planGate(config.gate, mode, executionMode, skipTests);
export const parseOutputMode = (
  argv: string[],
  env: Record<string, string | undefined> = process.env,
) => outputMode(argv, env, config.gate);

if (import.meta.main)
  process.exit(await runCli(['gate', ...process.argv.slice(2)]));
