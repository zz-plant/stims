/**
 * Quality gate modes:
 *
 * - `quick`  — lint + typecheck only, no tests (~10s). Use constantly during
 *              development to catch type/style errors early.
 * - `full`   — lint + typecheck + fast test suite (~2min). This is the default
 *              `bun run check` mode. Excludes slow corpus/certification/integration
 *              tests so it remains a fast feedback loop.
 * - `all`    — lint + typecheck + full test suite including corpus/certification
 *              tests (~5min+). Use before merging changes to the MilkDrop
 *              compiler, renderer adapter, or parity pipeline.
 */
type GateMode = 'quick' | 'full' | 'all';

type GateExecutionMode = 'parallel' | 'serial';

type GateStep = {
  label: string;
  cmd: string[];
};

type GatePlan = {
  mode: GateMode;
  executionMode: GateExecutionMode;
  preflight: GateStep[];
  concurrent: GateStep[];
  postflight: GateStep[];
};

type GateStepResult = {
  step: GateStep;
  exitCode: number;
  stdout: string;
  stderr: string;
};

const noTsNoCheckLabel = ['No ', '@ts-', 'nocheck', ' guard'].join('');

export function parseMode(argv: string[]): GateMode {
  if (argv.includes('--quick')) return 'quick';
  if (argv.includes('--all')) return 'all';
  return 'full';
}

export function parseExecutionMode(argv: string[]): GateExecutionMode {
  return argv.includes('--serial') ? 'serial' : 'parallel';
}

export function buildGatePlan(
  mode: GateMode,
  executionMode: GateExecutionMode,
): GatePlan {
  return {
    mode,
    executionMode,
    preflight: [
      {
        label: noTsNoCheckLabel,
        cmd: ['bun', 'run', 'check:no-ts-nocheck'],
      },
      {
        label: 'CI config drift check',
        cmd: ['bun', 'run', 'check:ci-config'],
      },
    ],
    concurrent: [
      {
        label: 'Asset health check',
        cmd: ['bun', 'run', 'assets:check'],
      },
      {
        label: 'Biome check',
        cmd: ['bun', 'run', 'biome:check'],
      },
      {
        label: 'Bundled catalog fidelity',
        cmd: ['bun', 'run', 'check:catalog-fidelity'],
      },
      {
        label: 'Bundled catalog integrity',
        cmd: ['bun', 'run', 'check:catalog-integrity'],
      },
      {
        label: 'README public claim drift',
        cmd: ['bun', 'run', 'check:readme-claims'],
      },
      {
        label: 'SEO surface check',
        cmd: ['bun', 'run', 'check:seo'],
      },
      {
        label: 'CSS token resolution',
        cmd: ['bun', 'run', 'check:css-tokens'],
      },
      {
        label: 'Stale assets/ path check',
        cmd: ['bun', 'run', 'check:stale-paths'],
      },
      {
        label: 'Doc reference check',
        cmd: ['bun', 'run', 'check:doc-references'],
      },
      {
        label: 'Authoring examples and reference',
        cmd: ['bun', 'run', 'check:authoring-docs'],
      },
      {
        label: 'Duplicate CSS check',
        cmd: ['bun', 'run', 'check:duplicate-css'],
      },
      {
        label: 'Architecture boundary check',
        cmd: ['bun', 'run', 'check:architecture'],
      },
      {
        label: 'TypeScript typecheck',
        cmd: ['bun', 'run', 'typecheck'],
      },
    ],
    postflight:
      mode === 'quick'
        ? []
        : mode === 'full'
          ? [
              {
                // fast profile: all tests except slow corpus/certification/integration
                label: 'Fast test suite',
                cmd: ['bun', 'run', 'test:fast'],
              },
            ]
          : [
              {
                // all profile: full suite including corpus/certification tests
                label: 'Full test suite (all profiles)',
                cmd: ['bun', 'run', 'test'],
              },
            ],
  };
}

async function runStep(step: GateStep): Promise<GateStepResult> {
  const proc = Bun.spawn({
    cmd: step.cmd,
    cwd: process.cwd(),
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
  });

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
  };
}

function printStepResult(result: GateStepResult) {
  console.log(`\n==> ${result.step.label}`);
  if (result.stdout) {
    console.log(result.stdout);
  }
  if (result.stderr) {
    if (result.stdout) {
      console.log('');
    }
    console.error(result.stderr);
  }
}

async function runStepListSerial(steps: readonly GateStep[]) {
  for (const step of steps) {
    const result = await runStep(step);
    printStepResult(result);
    if (result.exitCode !== 0) {
      process.exit(result.exitCode);
    }
  }
}

type RunningStep = {
  step: GateStep;
  proc: ReturnType<typeof Bun.spawn>;
  promise: Promise<GateStepResult>;
};

async function runStepListConcurrent(steps: readonly GateStep[]) {
  const runningSteps: RunningStep[] = steps.map((step) => {
    const proc = Bun.spawn({
      cmd: step.cmd,
      cwd: process.cwd(),
      stdin: 'inherit',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const promise = Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]).then(([exitCode, stdout, stderr]) => ({
      step,
      exitCode,
      stdout: stdout.trim(),
      stderr: stderr.trim(),
    }));

    return { step, proc, promise };
  });

  const pending = new Map(
    runningSteps.map((item, index) => [
      index,
      item.promise.then((result) => ({ index, result })),
    ]),
  );

  while (pending.size > 0) {
    const { index, result } = await Promise.race(pending.values());
    pending.delete(index);
    printStepResult(result);

    if (result.exitCode !== 0) {
      for (const [idx] of pending.entries()) {
        try {
          runningSteps[idx].proc.kill();
        } catch {
          // ignore if process exited
        }
      }
      process.exit(result.exitCode);
    }
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const mode = parseMode(argv);
  const executionMode = parseExecutionMode(argv);
  const plan = buildGatePlan(mode, executionMode);

  await runStepListSerial(plan.preflight);

  if (plan.executionMode === 'parallel') {
    await runStepListConcurrent(plan.concurrent);
  } else {
    await runStepListSerial(plan.concurrent);
  }

  await runStepListSerial(plan.postflight);
}

if (import.meta.main) {
  await main();
}
