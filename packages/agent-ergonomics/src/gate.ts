/**
 * The quality gate: preflight steps in order, a concurrent lane that fails
 * fast, then a postflight test pass, in one of three progressively broader
 * modes (`quick`, `full`, `all`), with a quiet output mode for agents.
 *
 * The step lists come from the config; this module only decides which steps
 * a mode includes, runs them, and reports. `quiet` prints one line per
 * passing step and full output only for a failing one: a green gate is
 * hundreds of lines of check marks, which costs an agent context and buries
 * the one line that says whether it passed. It is chosen by `--quiet`, by the
 * configured quiet variable set to `1`, or automatically inside an agent
 * session (any of `gate.agentEnvs` set to `1`); `--verbose` or the quiet
 * variable set to `0` restores full output. Humans and CI keep the full text
 * by default.
 *
 * `--no-tests` drops the postflight suite, leaving the checks. It exists for
 * CI, which runs the suite as its own parallel job; locally the gate should
 * stay the single command that runs everything.
 */
import type { AgentErgonomicsConfig, GateMode, GateStep } from './config.ts';
import { GATE_MODES } from './config.ts';
import { type Command, consoleIo, type Io } from './context.ts';

export type GateExecutionMode = 'parallel' | 'serial';

/** A step with its command resolved for the current environment. */
export type PlannedStep = { label: string; cmd: string[] };

export type GatePlan = {
  mode: GateMode;
  /** Named in the quiet summary line; `Quality gate` when absent. */
  summaryLabel?: string;
  executionMode: GateExecutionMode;
  preflight: PlannedStep[];
  concurrent: PlannedStep[];
  postflight: PlannedStep[];
};

export type GateStepResult = {
  step: PlannedStep;
  exitCode: number;
  stdout: string;
  stderr: string;
  ms: number;
};

export function parseMode(argv: string[]): GateMode {
  if (argv.includes('--quick')) return 'quick';
  if (argv.includes('--all')) return 'all';
  return 'full';
}

export function parseExecutionMode(argv: string[]): GateExecutionMode {
  return argv.includes('--serial') ? 'serial' : 'parallel';
}

export function parseSkipTests(argv: string[]): boolean {
  return argv.includes('--no-tests');
}

export type OutputMode = 'text' | 'json' | 'quiet';

export type OutputModeEnv = { quietEnv: string; agentEnvs: string[] };

export function parseOutputMode(
  argv: string[],
  env: Record<string, string | undefined>,
  { quietEnv, agentEnvs }: OutputModeEnv,
): OutputMode {
  if (argv.includes('--json')) return 'json';
  if (argv.includes('--verbose') || env[quietEnv] === '0') return 'text';
  if (argv.includes('--quiet') || env[quietEnv] === '1') return 'quiet';
  return agentEnvs.some((name) => env[name] === '1') ? 'quiet' : 'text';
}

const runsIn = (step: GateStep, mode: GateMode) =>
  step.modes === undefined || step.modes.includes(mode);

const resolveCmd = (step: GateStep, env: Record<string, string | undefined>) =>
  step.envCmd && env[step.envCmd.name] === step.envCmd.value
    ? step.envCmd.cmd
    : step.cmd;

/**
 * The steps a mode runs, in their lanes. `skipTests` drops the postflight
 * suite only; every check still runs, so moving the suite to another job
 * never checks less.
 */
export function buildGatePlan(
  gate: AgentErgonomicsConfig['gate'],
  mode: GateMode,
  executionMode: GateExecutionMode,
  skipTests = false,
  env: Record<string, string | undefined> = process.env,
): GatePlan {
  const plan = (steps: GateStep[]) =>
    steps
      .filter((step) => runsIn(step, mode))
      .map((step) => ({ label: step.label, cmd: resolveCmd(step, env) }));
  return {
    mode,
    executionMode,
    preflight: plan(gate.preflight),
    concurrent: plan(gate.concurrent),
    postflight: skipTests ? [] : plan(gate.postflight[mode] ?? []),
  };
}

/**
 * The runner script names a mode invokes (`<runner> <name>` steps), read from
 * the plan rather than from any composite command string: the gate's own
 * script names resolve to this module, so membership is only knowable here.
 */
export function gateScriptNames(
  gate: AgentErgonomicsConfig['gate'],
  mode: GateMode,
): Set<string> {
  const plan = buildGatePlan(gate, mode, 'parallel', false, {});
  const steps = [...plan.preflight, ...plan.concurrent, ...plan.postflight];
  return new Set(
    steps
      .map((step) => step.cmd[step.cmd.indexOf('run') + 1])
      .filter((name): name is string => Boolean(name)),
  );
}

export type GateProgress = { passed: number; totalMs: number };

export function printStepResult(
  result: GateStepResult,
  outputMode: OutputMode,
  io: Io = consoleIo,
  progress: GateProgress = { passed: 0, totalMs: 0 },
) {
  if (outputMode === 'json') {
    io.log(
      JSON.stringify({
        step: result.step.label,
        ok: result.exitCode === 0,
        ms: result.ms,
      }),
    );
    return;
  }

  progress.totalMs += result.ms;
  if (result.exitCode === 0) progress.passed += 1;

  if (outputMode === 'quiet') {
    if (result.exitCode === 0) {
      io.log(`✓ ${result.step.label} (${result.ms}ms)`);
      return;
    }
    // A failure keeps its full output below; only the header changes so the
    // failing step is the first thing a reader sees.
    io.log(`\n✖ ${result.step.label} FAILED (${result.ms}ms)`);
  } else {
    io.log(`\n==> ${result.step.label} (${result.ms}ms)`);
  }
  if (result.stdout) io.log(result.stdout);
  if (result.stderr) {
    if (result.stdout) io.log('');
    io.error(result.stderr);
  }
}

type RunningStep = {
  step: PlannedStep;
  proc: ReturnType<typeof Bun.spawn>;
  promise: Promise<GateStepResult>;
};

function spawnStep(step: PlannedStep, cwd: string): RunningStep {
  const start = performance.now();
  const proc = Bun.spawn({
    cmd: step.cmd,
    cwd,
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const promise = (async () => {
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return {
      step,
      exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      ms: Math.round(performance.now() - start),
    };
  })();
  return { step, proc, promise };
}

export type RunGateOptions = { cwd: string; io?: Io };

/** Runs a plan; returns the first failing step's exit code, or 0. */
export async function runGate(
  plan: GatePlan,
  outputMode: OutputMode,
  { cwd, io = consoleIo }: RunGateOptions,
): Promise<number> {
  const progress: GateProgress = { passed: 0, totalMs: 0 };

  const serial = async (steps: readonly PlannedStep[]) => {
    for (const step of steps) {
      const result = await spawnStep(step, cwd).promise;
      printStepResult(result, outputMode, io, progress);
      if (result.exitCode !== 0) return result.exitCode;
    }
    return 0;
  };

  const concurrent = async (steps: readonly PlannedStep[]) => {
    const running = steps.map((step) => spawnStep(step, cwd));
    const pending = new Map(
      running.map((item, index) => [
        index,
        item.promise.then((result) => ({ index, result })),
      ]),
    );
    while (pending.size > 0) {
      const { index, result } = await Promise.race(pending.values());
      pending.delete(index);
      printStepResult(result, outputMode, io, progress);
      if (result.exitCode !== 0) {
        for (const [idx] of pending) {
          try {
            running[idx]?.proc.kill();
          } catch {
            // already exited
          }
        }
        return result.exitCode;
      }
    }
    return 0;
  };

  let code = await serial(plan.preflight);
  if (code !== 0) return code;
  code =
    plan.executionMode === 'parallel'
      ? await concurrent(plan.concurrent)
      : await serial(plan.concurrent);
  if (code !== 0) return code;
  code = await serial(plan.postflight);
  if (code !== 0) return code;

  if (outputMode === 'quiet') {
    io.log(
      `\n✅ ${plan.summaryLabel ?? 'Quality gate'} passed: ${progress.passed} steps (${(progress.totalMs / 1000).toFixed(1)}s of step time)`,
    );
  }
  return 0;
}

/** `gate [--quick | --all] [--serial] [--no-tests] [--quiet | --verbose | --json]` */
export const runGateCommand: Command = async (
  args,
  { config, cwd, env, io },
) => {
  const mode = parseMode(args);
  if (!GATE_MODES.includes(mode)) return 2;
  const plan = {
    ...buildGatePlan(
      config.gate,
      mode,
      parseExecutionMode(args),
      parseSkipTests(args),
      env,
    ),
    summaryLabel: config.gate.summaryLabel,
  };
  const outputMode = parseOutputMode(args, env, config.gate);
  return runGate(plan, outputMode, { cwd, io });
};
