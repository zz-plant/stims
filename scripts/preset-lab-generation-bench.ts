/**
 * Preset lab — generation bench: scores a text-to-preset generation provider against a frozen prompt set.
 *
 * The prompt set lives in `scripts/fixtures/generation-bench-prompts.json`
 * (frozen and diffable) and every generated preset is scored on what the
 * Generate flow itself promises: does the real compiler accept it, and do
 * its equations actually respond to audio (the reactivity-probe pass the
 * panel runs)? The default provider is the deterministic template
 * synthesizer — the control any model-backed provider has to beat:
 *
 *   bun run lab:generation-bench -- --baseline    # deterministic control
 *   bun run lab:generation-bench -- --compare     # what changed since?
 *   bun run lab:generation-bench -- --provider hosted \
 *       --endpoint https://toil.fyi/api/generate-preset --model <id>
 *   bun run lab:generation-bench -- --provider openrouter \
 *       --api-key sk-or-… --model openai/gpt-4o-mini
 *   bun run lab:generation-bench -- --provider openai-compatible \
 *       --endpoint http://127.0.0.1:11434/v1 --model gemma:12b
 *
 * A result is scored on behaviour, not prose: compile success via the real
 * preset compiler, then the audio-reactivity probe (silent-vs-audio VM
 * divergence). Render-based visual metrics are deliberately NOT chained —
 * `lab:visual` needs a full browser session per preset — so `--visual`
 * exists only as a documented stub and exits until that path is wired.
 *
 * Unreachable model endpoints degrade to per-prompt `generation-failed`
 * records instead of aborting the run, so a dead provider still produces
 * a comparable artifact. Reports are deterministic for the control
 * provider, which is what makes baselines diffable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMilkdropPresetSource } from 'milkdrop-toolchain/src/compiler.ts';
import {
  synthesizedPresetToMilkSource,
  synthesizeEELPreset,
} from '../src/js/milkdrop/ai-preset-synthesizer.ts';
import {
  type PresetGenerationProvider,
  requestPresetFromProvider,
} from '../src/js/milkdrop/preset-generator.ts';
import {
  probePresetReactivity,
  type ReactivityProbeVerdict,
} from '../src/js/milkdrop/reactivity-probe.ts';
import {
  compareMetricRecords,
  formatMetricDeltaLines,
  type MetricComparisonSpec,
} from './preset-lab-metrics.ts';

const DEFAULT_OUTPUT_DIR = './scratch/generation-bench';
const PROMPT_FIXTURE_PATH = 'fixtures/generation-bench-prompts.json';
const REPORT_FILE = 'generation-bench.json';
const BASELINE_FILE = 'generation-bench.baseline.json';

// Composite score: compiling at all dominates, then the reactivity verdict,
// then the probe's divergence strength. A preset that compiles but ignores
// audio must never outrank a reactive one, and a preset that fails to
// compile scores nothing.
const COMPILE_OK_POINTS = 100;
const VERDICT_WEIGHT: Record<ReactivityProbeVerdict, number> = {
  reactive: 50,
  unknown: 20,
  static: 0,
};
const REACTIVITY_POINTS_SCALE = 10;

export type GenerationPromptStatus =
  | 'ok'
  | 'compile-failed'
  | 'generation-failed';

export type GenerationPromptResult = {
  prompt: string;
  status: GenerationPromptStatus;
  /** Failure message for `generation-failed` records. */
  failure?: string;
  compileErrorCount: number;
  compileWarningCount: number;
  compileErrors: string[];
  reactivityVerdict: ReactivityProbeVerdict | null;
  reactivityScore: number | null;
  respondingVariables: string[];
  score: number;
  source: string | null;
};

export type GenerationBenchAggregate = {
  promptCount: number;
  okCount: number;
  compileFailedCount: number;
  generationFailedCount: number;
  reactiveCount: number;
  staticCount: number;
  /** Share of all prompts whose output compiled. */
  compileSuccessRate: number;
  /** Share of compiled prompts the probe called reactive. */
  reactiveRate: number;
  meanReactivityScore: number;
  meanCompositeScore: number;
};

export type GenerationBenchReport = {
  version: 1;
  provider: string;
  model: string | null;
  promptFile: string;
  results: GenerationPromptResult[];
  aggregate: GenerationBenchAggregate;
};

function repoRootFromScript() {
  return path.resolve(fileURLToPath(new URL('..', import.meta.url)));
}

function promptId(prompt: string, index: number) {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `generation-bench-${index}-${slug}`;
}

/** Compile one generated source with the real compiler and probe it. */
export function scoreGeneratedPreset(
  prompt: string,
  raw: string,
  index: number,
): GenerationPromptResult {
  const compiled = compileMilkdropPresetSource(raw, {
    id: promptId(prompt, index),
    title: `Bench: ${prompt.slice(0, 60)}`,
    origin: 'generated',
  });
  const errorDiagnostics = compiled.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error',
  );

  if (errorDiagnostics.length > 0) {
    return {
      prompt,
      status: 'compile-failed',
      compileErrorCount: errorDiagnostics.length,
      compileWarningCount:
        compiled.diagnostics.length - errorDiagnostics.length,
      compileErrors: errorDiagnostics.map((diagnostic) =>
        diagnostic.line === undefined
          ? diagnostic.message
          : `line ${diagnostic.line}: ${diagnostic.message}`,
      ),
      reactivityVerdict: null,
      reactivityScore: null,
      respondingVariables: [],
      score: 0,
      source: raw,
    };
  }

  const probe = probePresetReactivity(compiled, { verify: true });
  const score =
    COMPILE_OK_POINTS +
    VERDICT_WEIGHT[probe.verdict] +
    Math.min(Math.max(probe.score, 0), 1) * REACTIVITY_POINTS_SCALE;

  return {
    prompt,
    status: 'ok',
    compileErrorCount: 0,
    compileWarningCount: compiled.diagnostics.length,
    compileErrors: [],
    reactivityVerdict: probe.verdict,
    reactivityScore: probe.score,
    respondingVariables: probe.respondingVariables,
    score,
    source: raw,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function aggregateResults(
  results: GenerationPromptResult[],
): GenerationBenchAggregate {
  const ok = results.filter((result) => result.status === 'ok');
  const reactive = ok.filter(
    (result) => result.reactivityVerdict === 'reactive',
  );
  return {
    promptCount: results.length,
    okCount: ok.length,
    compileFailedCount: results.filter(
      (result) => result.status === 'compile-failed',
    ).length,
    generationFailedCount: results.filter(
      (result) => result.status === 'generation-failed',
    ).length,
    reactiveCount: reactive.length,
    staticCount: ok.filter((result) => result.reactivityVerdict === 'static')
      .length,
    compileSuccessRate:
      results.length === 0
        ? 0
        : (results.length -
            results.filter((result) => result.status !== 'ok').length) /
          results.length,
    reactiveRate: ok.length === 0 ? 0 : reactive.length / ok.length,
    meanReactivityScore: mean(
      ok
        .map((result) => result.reactivityScore)
        .filter((value): value is number => value !== null),
    ),
    meanCompositeScore: mean(results.map((result) => result.score)),
  };
}

/**
 * Run the whole bench over `prompts` with a pluggable generator so unit
 * tests can score fixture presets and the CLI can swap providers. The
 * generator returns raw `.milk` source; a rejected promise becomes a
 * `generation-failed` record, never an aborted run.
 */
export async function runGenerationBench(options: {
  prompts: string[];
  provider: string;
  model: string | null;
  generate: (prompt: string, index: number) => Promise<string> | string;
  onResult?: (result: GenerationPromptResult) => void;
}): Promise<GenerationBenchReport> {
  const results: GenerationPromptResult[] = [];
  for (const [index, prompt] of options.prompts.entries()) {
    let result: GenerationPromptResult;
    try {
      const raw = await options.generate(prompt, index);
      result = scoreGeneratedPreset(prompt, raw, index);
    } catch (error) {
      result = {
        prompt,
        status: 'generation-failed',
        failure: error instanceof Error ? error.message : String(error),
        compileErrorCount: 0,
        compileWarningCount: 0,
        compileErrors: [],
        reactivityVerdict: null,
        reactivityScore: null,
        respondingVariables: [],
        score: 0,
        source: null,
      };
    }
    options.onResult?.(result);
    results.push(result);
  }
  return {
    version: 1,
    provider: options.provider,
    model: options.model,
    promptFile: PROMPT_FIXTURE_PATH,
    results,
    aggregate: aggregateResults(results),
  };
}

/** The deterministic template synthesizer: the control provider. */
function generateDeterministicSource(prompt: string) {
  return synthesizedPresetToMilkSource(synthesizeEELPreset({ prompt }));
}

export function loadBenchPrompts(repoRoot: string): string[] {
  const fixturePath = path.join(repoRoot, 'scripts', PROMPT_FIXTURE_PATH);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
    prompts?: unknown;
  };
  if (!Array.isArray(fixture.prompts)) {
    throw new Error(`${fixturePath} has no prompts array.`);
  }
  const prompts = fixture.prompts.filter(
    (prompt): prompt is string => typeof prompt === 'string' && !!prompt.trim(),
  );
  if (prompts.length === 0) {
    throw new Error(`${fixturePath} has an empty prompts array.`);
  }
  return prompts;
}

export function formatGenerationBenchText(
  report: GenerationBenchReport,
): string {
  const lines: string[] = [];
  const { aggregate } = report;
  lines.push(
    `# Generation bench — ${report.provider}${report.model ? ` (${report.model})` : ''}`,
  );
  lines.push('');
  lines.push(
    `Scored ${aggregate.promptCount} prompts from ${report.promptFile}: compile via the real compiler, reactivity via the probe.`,
  );
  lines.push('');
  lines.push('| prompt | compile | reactivity | probe score | composite |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const result of report.results) {
    const compile =
      result.status === 'ok'
        ? 'ok'
        : result.status === 'compile-failed'
          ? `failed (${result.compileErrorCount} error${result.compileErrorCount === 1 ? '' : 's'})`
          : 'not reached';
    const reactivity = result.reactivityVerdict ?? '—';
    const probeScore =
      result.reactivityScore === null ? '—' : result.reactivityScore.toFixed(3);
    const prompt = result.prompt.slice(0, 48);
    lines.push(
      `| ${prompt} | ${compile} | ${reactivity} | ${probeScore} | ${result.score.toFixed(1)} |`,
    );
    if (result.failure) {
      lines.push(`  - generation failed: ${result.failure}`);
    }
    for (const error of result.compileErrors.slice(0, 3)) {
      lines.push(`  - ${error}`);
    }
  }
  lines.push('');
  lines.push('## Aggregate');
  lines.push(
    `- compiled: ${aggregate.okCount}/${aggregate.promptCount} (rate ${(aggregate.compileSuccessRate * 100).toFixed(1)}%)`,
  );
  lines.push(
    `- reactive: ${aggregate.reactiveCount}/${aggregate.okCount} compiled presets (rate ${(aggregate.reactiveRate * 100).toFixed(1)}%), static: ${aggregate.staticCount}`,
  );
  lines.push(
    `- generation failures: ${aggregate.generationFailedCount}, compile failures: ${aggregate.compileFailedCount}`,
  );
  lines.push(
    `- mean reactivity score: ${aggregate.meanReactivityScore.toFixed(3)}, mean composite: ${aggregate.meanCompositeScore.toFixed(1)}`,
  );
  return lines.join('\n');
}

const COMPARISON_SPECS: MetricComparisonSpec[] = [
  {
    key: 'okCount',
    label: 'prompts fully passing',
    betterWhen: 'higher',
    tolerance: 0,
  },
  {
    key: 'compileFailedCount',
    label: 'compile failures',
    betterWhen: 'lower',
    tolerance: 0,
  },
  {
    key: 'generationFailedCount',
    label: 'generation failures',
    betterWhen: 'lower',
    tolerance: 0,
  },
  {
    key: 'reactiveCount',
    label: 'reactive presets',
    betterWhen: 'higher',
    tolerance: 0,
  },
  {
    key: 'meanReactivityScore',
    label: 'mean reactivity score',
    betterWhen: 'higher',
    tolerance: 0.01,
  },
  {
    key: 'meanCompositeScore',
    label: 'mean composite score',
    betterWhen: 'higher',
    tolerance: 0.5,
  },
];

export function compareGenerationBenchReports(
  baseline: GenerationBenchReport,
  current: GenerationBenchReport,
): string {
  const lines: string[] = [];
  lines.push(
    `# Generation bench comparison — ${current.provider}${current.model ? ` (${current.model})` : ''} vs ${baseline.provider} baseline`,
  );
  lines.push('');
  const deltas = compareMetricRecords(
    COMPARISON_SPECS,
    baseline.aggregate as unknown as Record<string, number>,
    current.aggregate as unknown as Record<string, number>,
  );
  lines.push(...formatMetricDeltaLines(deltas));
  return lines.join('\n');
}

type CliOptions = {
  provider: 'deterministic' | 'hosted' | 'openai-compatible' | 'openrouter';
  endpoint: string;
  model: string;
  apiKey: string;
  outputDir: string;
  writeBaseline: boolean;
  compare: boolean;
  json: boolean;
  visual: boolean;
};

function readArg(argv: string[], name: string, fallback: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

function parseArgs(argv: string[]): CliOptions {
  const providerArg = readArg(argv, '--provider', 'deterministic');
  const provider = (
    ['deterministic', 'hosted', 'openai-compatible', 'openrouter'] as const
  ).includes(providerArg as CliOptions['provider'])
    ? (providerArg as CliOptions['provider'])
    : null;
  if (!provider) {
    console.error(
      `Unknown provider "${providerArg}". Use deterministic, hosted, openai-compatible or openrouter.`,
    );
    process.exit(2);
  }
  return {
    provider,
    endpoint: readArg(argv, '--endpoint', ''),
    model: readArg(argv, '--model', ''),
    apiKey: readArg(argv, '--api-key', process.env.OPENROUTER_API_KEY ?? ''),
    outputDir: path.resolve(readArg(argv, '--out', DEFAULT_OUTPUT_DIR)),
    writeBaseline: argv.includes('--baseline'),
    compare: argv.includes('--compare'),
    json: argv.includes('--json'),
    visual: argv.includes('--visual'),
  };
}

function buildGenerateFn(
  options: CliOptions,
): (prompt: string, index: number) => Promise<string> | string {
  if (options.provider === 'deterministic') {
    return generateDeterministicSource;
  }

  const provider: PresetGenerationProvider =
    options.provider === 'hosted'
      ? { kind: 'hosted', endpoint: options.endpoint || undefined }
      : options.provider === 'openai-compatible'
        ? {
            kind: 'openai-compatible',
            endpoint: options.endpoint,
            model: options.model,
          }
        : { kind: 'openrouter', apiKey: options.apiKey, model: options.model };

  if (
    options.provider === 'hosted' &&
    (!options.endpoint || !/^https?:\/\//u.test(options.endpoint))
  ) {
    console.error(
      'The hosted provider needs an absolute --endpoint, e.g. https://toil.fyi/api/generate-preset.',
    );
    process.exit(2);
  }
  if (
    options.provider === 'openai-compatible' &&
    (!options.endpoint || !options.model)
  ) {
    console.error(
      'The openai-compatible provider needs --endpoint (loopback only) and --model.',
    );
    process.exit(2);
  }
  if (options.provider === 'openrouter') {
    if (!options.apiKey) {
      console.error(
        'The openrouter provider needs --api-key or OPENROUTER_API_KEY. The key is sent straight to openrouter.ai, never to Stims.',
      );
      process.exit(2);
    }
    if (!options.model) {
      console.error('The openrouter provider needs --model.');
      process.exit(2);
    }
  }

  return (prompt) =>
    requestPresetFromProvider(prompt, {}, provider) as Promise<string>;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.visual) {
    console.error(
      'Visual metrics are not wired into this bench yet: they need the lab:visual browser path per preset. ' +
        'Score today is compile + reactivity; track the missing render check in docs/GENERATIVE_AI_USE_CASES.md.',
    );
    process.exit(2);
  }

  const repoRoot = repoRootFromScript();
  const prompts = loadBenchPrompts(repoRoot);
  const model = options.model || null;

  const report = await runGenerationBench({
    prompts,
    provider: options.provider,
    model,
    generate: buildGenerateFn(options),
    onResult: (result) => {
      const tail =
        result.status === 'ok'
          ? `${result.reactivityVerdict} (probe ${result.reactivityScore?.toFixed(3)})`
          : (result.failure ?? `${result.status}`);
      console.error(`  ${result.prompt.slice(0, 48)} — ${tail}`);
    },
  });

  fs.mkdirSync(options.outputDir, { recursive: true });
  const reportPath = path.join(options.outputDir, REPORT_FILE);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatGenerationBenchText(report));
    console.log('');
    console.log(`Report written to ${reportPath}`);
  }

  const baselinePath = path.join(options.outputDir, BASELINE_FILE);
  if (options.writeBaseline) {
    fs.writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Baseline written to ${baselinePath}`);
  }

  if (options.compare) {
    if (!fs.existsSync(baselinePath)) {
      console.error(
        `No baseline at ${baselinePath} — run with --baseline first.`,
      );
      process.exitCode = 1;
    } else {
      const baseline = JSON.parse(
        fs.readFileSync(baselinePath, 'utf8'),
      ) as GenerationBenchReport;
      console.log('');
      console.log(compareGenerationBenchReports(baseline, report));
    }
  }

  if (report.aggregate.generationFailedCount === report.aggregate.promptCount) {
    console.error(
      'Every prompt failed to generate — the provider was unreachable or rejected every request. See the per-prompt failures above.',
    );
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
