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
  ms: number;
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

export type OutputMode = 'text' | 'json';

export function parseOutputMode(argv: string[]): OutputMode {
  return argv.includes('--json') ? 'json' : 'text';
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
      ...(mode === 'quick'
        ? [
            {
              label: 'Biome lint (changed files)',
              // STIMS_LINT_STAGED=1 (set by the pre-commit hook) narrows the
              // lint to the index so another session's working-tree churn
              // cannot block an unrelated commit.
              cmd:
                process.env.STIMS_LINT_STAGED === '1'
                  ? ['bun', 'run', 'lint:changed', '--staged']
                  : ['bun', 'run', 'lint:changed'],
            },
          ]
        : [
            {
              label: 'Biome check',
              cmd: ['bun', 'run', 'biome:check'],
            },
          ]),
      {
        label: 'Asset health check',
        cmd: ['bun', 'run', 'assets:check'],
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
        label: 'CSS radius/type scale',
        cmd: ['bun', 'run', 'check:css-scale'],
      },
      {
        label: 'Agent action id drift',
        cmd: ['bun', 'run', 'check:agent-action-ids'],
      },
      {
        label: 'WebGPU target sampling',
        cmd: ['bun', 'run', 'check:webgpu-target-sampling'],
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
        label: 'Script docblock coverage',
        cmd: ['bun', 'run', 'check:script-docs'],
      },
      {
        label: 'Module docblock coverage',
        cmd: ['bun', 'run', 'check:module-docs'],
      },
      {
        label: 'Guardrails doc freshness',
        cmd: ['bun', 'run', 'check:guardrails-doc'],
      },
      {
        // The C++ parity harness and our capture path must feed byte-identical
        // audio; the header is generated so they cannot drift silently.
        label: 'Reference audio header freshness',
        cmd: ['bun', 'run', 'check:reference-audio-header'],
      },
      {
        // A test that greps src/ cannot fail when behaviour changes. The
        // allowlist enumerates the ones that already exist so the class
        // cannot grow quietly.
        label: 'No new source-text tests',
        cmd: ['bun', 'run', 'check:test-source-greps'],
      },
      {
        label: 'First-run preset evidence freshness',
        cmd: ['bun', 'run', 'check:first-run-evidence'],
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
        label: 'Agent skill index',
        cmd: ['bun', 'run', 'check:skill-index'],
      },
      {
        label: 'Architecture boundary check',
        cmd: ['bun', 'run', 'check:architecture'],
      },
      {
        label: 'Unbounded cache check',
        cmd: ['bun', 'run', 'check:cache-bounds'],
      },
      {
        // Diff-scoped, so this gates new and changed code without demanding a
        // repo-wide cleanup first.
        label: 'Banned pattern guard (changed files)',
        cmd: ['bun', 'run', 'check:guard-registry'],
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
                // gate profile: unit + compat + corpus. Corpus carries the
                // parity and golden-snapshot tests for the dual-backend
                // boundary; running them only in CI let a compiler change go
                // green here and red after push. e2e stays out — it is serial,
                // browser-backed, and slow.
                label: 'Gate test suite',
                cmd: ['bun', 'run', 'test:gate'],
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
  const start = performance.now();
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
    ms: Math.round(performance.now() - start),
  };
}

function printStepResult(result: GateStepResult, outputMode: OutputMode) {
  if (outputMode === 'json') {
    console.log(
      JSON.stringify({
        step: result.step.label,
        ok: result.exitCode === 0,
        ms: result.ms,
      }),
    );
    return;
  }

  console.log(`\n==> ${result.step.label} (${result.ms}ms)`);
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

async function runStepListSerial(
  steps: readonly GateStep[],
  outputMode: OutputMode,
) {
  for (const step of steps) {
    const result = await runStep(step);
    printStepResult(result, outputMode);
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

async function runStepListConcurrent(
  steps: readonly GateStep[],
  outputMode: OutputMode,
) {
  const runningSteps: RunningStep[] = steps.map((step) => {
    const proc = Bun.spawn({
      cmd: step.cmd,
      cwd: process.cwd(),
      stdin: 'inherit',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const promise = (async () => {
      const start = performance.now();
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
    printStepResult(result, outputMode);

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
  const outputMode = parseOutputMode(argv);
  const plan = buildGatePlan(mode, executionMode);

  await runStepListSerial(plan.preflight, outputMode);

  if (plan.executionMode === 'parallel') {
    await runStepListConcurrent(plan.concurrent, outputMode);
  } else {
    await runStepListSerial(plan.concurrent, outputMode);
  }

  await runStepListSerial(plan.postflight, outputMode);
}

if (import.meta.main) {
  await main();
}
