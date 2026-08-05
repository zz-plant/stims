/**
 * Preset lab — audio reactivity report (no browser, no vision, no hearing).
 *
 * Drives a MilkDrop preset's VM headlessly with deterministic, band-isolated
 * synthetic audio scenarios and measures how each per-frame variable (plus the
 * main wave geometry) responds. The output is numbers and verdicts, so any
 * agent — sighted or not — can iterate on a preset's audio reactivity:
 *
 *   bun run lab:reactivity -- --preset eos-ether            # report
 *   bun run lab:reactivity -- --preset eos-ether --baseline # snapshot metrics
 *   <edit the .milk file>
 *   bun run lab:reactivity -- --preset eos-ether --compare  # improved or not?
 *
 * Determinism: the VM seeds its RNG from the preset id and the scenarios are
 * pure functions of frame time, so identical inputs give identical reports.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import { createMilkdropSignalTracker } from '../src/js/milkdrop/runtime-signals.ts';
import { createMilkdropVM } from '../src/js/milkdrop/vm.ts';
import {
  AUDIO_DRIVEN_SCENARIOS,
  assessVariableReactivity,
  compareMetricRecords,
  fillScenarioSpectrum,
  fillScenarioWaveform,
  formatMetricDeltaLines,
  type MetricComparisonSpec,
  PRESET_LAB_SPECTRUM_BINS,
  type PresetLabScenario,
  type VariableReactivity,
  type VariableScenarioMeasurement,
} from './preset-lab-metrics.ts';

const DEFAULT_OUTPUT_DIR = './scratch/preset-lab';
const DEFAULT_FPS = 60;
const DEFAULT_WARMUP_FRAMES = 90;
const DEFAULT_SAMPLE_FRAMES = 360;

/**
 * Derived geometry series, computed from the frame state rather than a preset
 * variable. These catch reactivity that never touches per-frame variables:
 * waveform-amplitude presets (main wave), wavecode per-point presets (custom
 * waves), and shapecode presets (shapes).
 */
const DERIVED_SERIES = [
  'mainWave.deviation',
  'customWaves.deviation',
  'shapes.motion',
] as const;

/**
 * Variables worth watching by default: the classic MilkDrop motion/appearance
 * controls. Variables absent from a preset's state are dropped automatically.
 */
const DEFAULT_TRACKED_VARIABLES = [
  'zoom',
  'zoomexp',
  'rot',
  'warp',
  'cx',
  'cy',
  'dx',
  'dy',
  'sx',
  'sy',
  'decay',
  'gamma',
  'echo_zoom',
  'echo_alpha',
  'wave_a',
  'wave_scale',
  'wave_r',
  'wave_g',
  'wave_b',
  'wave_x',
  'wave_y',
  'wave_mystery',
  'ob_size',
  'ob_a',
  'ib_size',
  'ib_a',
  'mv_a',
  'mv_l',
  ...Array.from({ length: 8 }, (_, index) => `q${index + 1}`),
] as const;

const AUDIO_CODE_TOKENS = [
  'bass',
  'bass_att',
  'mid',
  'mid_att',
  'treb',
  'treb_att',
  'vol',
  'beat',
  'beat_pulse',
] as const;

type PresetSource = {
  id: string;
  title: string;
  filePath: string;
  raw: string;
};

type ScenarioTrace = {
  scenario: PresetLabScenario;
  /** Band level actually delivered to the preset per frame (post-smoothing). */
  driver: number[];
  variableSeries: Map<string, number[]>;
};

export type PresetReactivityReport = {
  version: 1;
  presetId: string;
  title: string;
  file: string;
  frames: number;
  warmupFrames: number;
  fps: number;
  codeReferencesAudio: Record<string, boolean>;
  variables: VariableReactivity[];
  /** Strongest |correlation| any variable reaches per scenario. */
  bandInfluence: Record<string, number>;
  summary: {
    reactiveVariableCount: number;
    autonomousVariableCount: number;
    staticVariableCount: number;
    weakVariableCount: number;
    bestVariable: string | null;
    bestCorrelation: number;
    bassInfluence: number;
    midInfluence: number;
    trebleInfluence: number;
    fullMixInfluence: number;
  };
};

function repoRootFromScript() {
  return path.resolve(fileURLToPath(new URL('..', import.meta.url)));
}

function loadCatalogEntries(repoRoot: string) {
  const publicRoot = path.join(repoRoot, 'public');
  const catalogPaths = [
    path.join(publicRoot, 'milkdrop-presets', 'catalog.json'),
    ...(() => {
      const librariesRoot = path.join(
        publicRoot,
        'milkdrop-presets',
        'libraries',
      );
      if (!fs.existsSync(librariesRoot)) {
        return [] as string[];
      }
      return fs
        .readdirSync(librariesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(librariesRoot, entry.name, 'catalog.json'))
        .filter((candidate) => fs.existsSync(candidate));
    })(),
  ];

  const entries = new Map<
    string,
    { id: string; title?: string; file: string }
  >();
  for (const catalogPath of catalogPaths) {
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as {
      presets: Array<{ id: string; title?: string; file: string }>;
    };
    for (const preset of catalog.presets) {
      if (!entries.has(preset.id)) {
        entries.set(preset.id, preset);
      }
    }
  }
  return entries;
}

export function loadPresetSource(
  repoRoot: string,
  options: { presetId?: string; filePath?: string },
): PresetSource {
  if (options.filePath) {
    const filePath = path.resolve(options.filePath);
    const raw = fs.readFileSync(filePath, 'latin1');
    const id =
      options.presetId ?? path.basename(filePath).replace(/\.milk$/i, '');
    return { id, title: id, filePath, raw };
  }
  if (!options.presetId) {
    throw new Error('Provide --preset <id> or --file <path/to/preset.milk>.');
  }
  const entries = loadCatalogEntries(repoRoot);
  const entry = entries.get(options.presetId);
  if (!entry) {
    const known = [...entries.keys()].slice(0, 12).join(', ');
    throw new Error(
      `Unknown preset id "${options.presetId}". Known ids include: ${known}, …`,
    );
  }
  const filePath = path.join(repoRoot, 'public', entry.file.replace(/^\//, ''));
  return {
    id: entry.id,
    title: entry.title ?? entry.id,
    filePath,
    raw: fs.readFileSync(filePath, 'latin1'),
  };
}

function scanAudioCodeReferences(raw: string): Record<string, boolean> {
  const codeLines = raw
    .split(/\r?\n/)
    .filter((line) =>
      /^\s*(per_frame|per_pixel|init|wave_\d+_per|shape_\d+_per|wavecode|shapecode)/i.test(
        line,
      ),
    )
    .join('\n')
    .toLowerCase();
  const references: Record<string, boolean> = {};
  for (const token of AUDIO_CODE_TOKENS) {
    references[token] = new RegExp(`\\b${token}\\b`).test(codeLines);
  }
  return references;
}

function positionsDeviation(positions: number[] | Float32Array): number {
  if (positions.length === 0) {
    return 0;
  }
  let mean = 0;
  for (let index = 0; index < positions.length; index += 1) {
    mean += positions[index] ?? 0;
  }
  mean /= positions.length;
  let squareTotal = 0;
  for (let index = 0; index < positions.length; index += 1) {
    const delta = (positions[index] ?? 0) - mean;
    squareTotal += delta * delta;
  }
  return Math.sqrt(squareTotal / positions.length);
}

/**
 * Scalar shape-motion signature. Distinct irrational weights keep independent
 * parameter movements from cancelling each other out in the sum.
 */
function shapesMotionSignature(
  shapes: ReadonlyArray<{
    x: number;
    y: number;
    radius: number;
    rotation: number;
  }>,
): number {
  let signature = 0;
  for (const shape of shapes) {
    signature +=
      shape.x * 1.318 +
      shape.y * 2.177 +
      shape.radius * 3.731 +
      shape.rotation * 0.577;
  }
  return signature;
}

function driverForScenario(
  scenario: PresetLabScenario,
  signals: { bass: number; mid: number; treb: number; weightedEnergy: number },
): number {
  if (scenario === 'bass-pulse') {
    return signals.bass;
  }
  if (scenario === 'mid-pulse') {
    return signals.mid;
  }
  if (scenario === 'treble-pulse') {
    return signals.treb;
  }
  return signals.weightedEnergy;
}

function runScenario({
  raw,
  presetId,
  scenario,
  warmupFrames,
  sampleFrames,
  fps,
  trackedVariables,
}: {
  raw: string;
  presetId: string;
  scenario: PresetLabScenario;
  warmupFrames: number;
  sampleFrames: number;
  fps: number;
  trackedVariables: readonly string[];
}): ScenarioTrace {
  const compiled = compileMilkdropPresetSource(raw, { id: presetId });
  const vm = createMilkdropVM(compiled);
  const tracker = createMilkdropSignalTracker();
  const frequencyData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const waveformData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const deltaMs = 1000 / fps;

  const driver: number[] = [];
  const variableSeries = new Map<string, number[]>(
    [...trackedVariables, ...DERIVED_SERIES].map((variable) => [variable, []]),
  );

  const totalFrames = warmupFrames + sampleFrames;
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const timeMs = frame * deltaMs;
    fillScenarioSpectrum(frequencyData, scenario, timeMs);
    fillScenarioWaveform(waveformData, scenario, timeMs);
    const signals = tracker.update({
      time: timeMs / 1000,
      deltaMs,
      analyser: null,
      frequencyData,
      waveformData,
    });
    const frameState = vm.step(signals);
    if (frame < warmupFrames) {
      continue;
    }
    driver.push(driverForScenario(scenario, signals));
    for (const variable of trackedVariables) {
      const value = frameState.variables[variable];
      variableSeries
        .get(variable)
        ?.push(typeof value === 'number' && Number.isFinite(value) ? value : 0);
    }
    variableSeries
      .get('mainWave.deviation')
      ?.push(positionsDeviation(frameState.mainWave.positions));
    let customWaveDeviation = 0;
    for (const wave of frameState.customWaves) {
      customWaveDeviation += positionsDeviation(wave.positions);
    }
    variableSeries.get('customWaves.deviation')?.push(customWaveDeviation);
    variableSeries
      .get('shapes.motion')
      ?.push(shapesMotionSignature(frameState.shapes));
  }

  return { scenario, driver, variableSeries };
}

function resolveTrackedVariables(
  raw: string,
  presetId: string,
  requested: readonly string[] | null,
): string[] {
  if (requested && requested.length > 0) {
    return [...requested];
  }
  const compiled = compileMilkdropPresetSource(raw, { id: presetId });
  const vm = createMilkdropVM(compiled);
  const snapshot = vm.getStateSnapshot();
  return DEFAULT_TRACKED_VARIABLES.filter((variable) => variable in snapshot);
}

export function measurePresetReactivity({
  source,
  warmupFrames = DEFAULT_WARMUP_FRAMES,
  sampleFrames = DEFAULT_SAMPLE_FRAMES,
  fps = DEFAULT_FPS,
  trackedVariables = null,
}: {
  source: PresetSource;
  warmupFrames?: number;
  sampleFrames?: number;
  fps?: number;
  trackedVariables?: readonly string[] | null;
}): PresetReactivityReport {
  const variables = resolveTrackedVariables(
    source.raw,
    source.id,
    trackedVariables,
  );

  const silenceTrace = runScenario({
    raw: source.raw,
    presetId: source.id,
    scenario: 'silence',
    warmupFrames,
    sampleFrames,
    fps,
    trackedVariables: variables,
  });
  const scenarioTraces = AUDIO_DRIVEN_SCENARIOS.map((scenario) =>
    runScenario({
      raw: source.raw,
      presetId: source.id,
      scenario,
      warmupFrames,
      sampleFrames,
      fps,
      trackedVariables: variables,
    }),
  );

  const assessments: VariableReactivity[] = [];
  for (const variable of [...variables, ...DERIVED_SERIES]) {
    const silenceSeries = silenceTrace.variableSeries.get(variable) ?? [];
    const measurements: Record<string, VariableScenarioMeasurement> = {};
    for (const trace of scenarioTraces) {
      measurements[trace.scenario] = {
        driver: trace.driver,
        response: trace.variableSeries.get(variable) ?? [],
      };
    }
    assessments.push(
      assessVariableReactivity(variable, silenceSeries, measurements),
    );
  }

  const bandInfluence: Record<string, number> = {};
  for (const trace of scenarioTraces) {
    let strongest = 0;
    for (const assessment of assessments) {
      const scenarioResult = assessment.scenarios[trace.scenario];
      if (scenarioResult) {
        strongest = Math.max(strongest, Math.abs(scenarioResult.correlation));
      }
    }
    bandInfluence[trace.scenario] = strongest;
  }

  const byVerdict = (verdict: VariableReactivity['verdict']) =>
    assessments.filter((assessment) => assessment.verdict === verdict).length;
  const bestAssessment = [...assessments].sort(
    (left, right) =>
      Math.abs(right.bestCorrelation) - Math.abs(left.bestCorrelation),
  )[0];

  return {
    version: 1,
    presetId: source.id,
    title: source.title,
    file: source.filePath,
    frames: sampleFrames,
    warmupFrames,
    fps,
    codeReferencesAudio: scanAudioCodeReferences(source.raw),
    variables: assessments,
    bandInfluence,
    summary: {
      reactiveVariableCount: byVerdict('reactive'),
      autonomousVariableCount: byVerdict('autonomous'),
      staticVariableCount: byVerdict('static'),
      weakVariableCount: byVerdict('weak'),
      bestVariable: bestAssessment?.variable ?? null,
      bestCorrelation: bestAssessment?.bestCorrelation ?? 0,
      bassInfluence: bandInfluence['bass-pulse'] ?? 0,
      midInfluence: bandInfluence['mid-pulse'] ?? 0,
      trebleInfluence: bandInfluence['treble-pulse'] ?? 0,
      fullMixInfluence: bandInfluence['full-mix'] ?? 0,
    },
  };
}

const REACTIVITY_COMPARISON_SPECS: MetricComparisonSpec[] = [
  {
    key: 'bassInfluence',
    label: 'bass influence',
    betterWhen: 'higher',
    tolerance: 0.03,
  },
  {
    key: 'midInfluence',
    label: 'mid influence',
    betterWhen: 'higher',
    tolerance: 0.03,
  },
  {
    key: 'trebleInfluence',
    label: 'treble influence',
    betterWhen: 'higher',
    tolerance: 0.03,
  },
  {
    key: 'fullMixInfluence',
    label: 'full-mix influence',
    betterWhen: 'higher',
    tolerance: 0.03,
  },
  {
    key: 'reactiveVariableCount',
    label: 'reactive variables',
    betterWhen: 'higher',
    tolerance: 0,
  },
  {
    key: 'staticVariableCount',
    label: 'static variables',
    betterWhen: 'lower',
    tolerance: 0,
  },
];

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return Math.abs(value) >= 100 ? value.toFixed(1) : value.toFixed(3);
}

export function formatReactivityReportText(
  report: PresetReactivityReport,
): string {
  const lines: string[] = [];
  lines.push(`# Reactivity report — ${report.title} (${report.presetId})`);
  lines.push('');
  lines.push(
    `Sampled ${report.frames} frames at ${report.fps} fps per scenario after ${report.warmupFrames} warmup frames.`,
  );
  const referenced = Object.entries(report.codeReferencesAudio)
    .filter(([, used]) => used)
    .map(([token]) => token);
  lines.push(
    referenced.length > 0
      ? `Preset code references audio inputs: ${referenced.join(', ')}.`
      : 'Preset code references NO audio inputs — any reactivity comes from built-in wave/beat behavior.',
  );
  lines.push('');
  lines.push(
    '## Band influence (strongest |correlation| any variable reaches)',
  );
  for (const [scenario, influence] of Object.entries(report.bandInfluence)) {
    lines.push(`- ${scenario}: ${influence.toFixed(3)}`);
  }
  lines.push('');
  lines.push('## Variables');
  lines.push('');
  lines.push(
    '| variable | verdict | best scenario | corr | via | lag (frames) | silence σ | response ratio |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  const ordered = [...report.variables].sort((left, right) => {
    const verdictRank = (assessment: VariableReactivity) =>
      assessment.verdict === 'reactive'
        ? 0
        : assessment.verdict === 'weak'
          ? 1
          : assessment.verdict === 'autonomous'
            ? 2
            : 3;
    return (
      verdictRank(left) - verdictRank(right) ||
      Math.abs(right.bestCorrelation) - Math.abs(left.bestCorrelation)
    );
  });
  for (const assessment of ordered) {
    const bestSignal = assessment.bestScenario
      ? (assessment.scenarios[assessment.bestScenario]?.signal ?? 'value')
      : '—';
    lines.push(
      `| ${assessment.variable} | ${assessment.verdict} | ${assessment.bestScenario ?? '—'} | ${formatNumber(assessment.bestCorrelation)} | ${bestSignal} | ${assessment.bestLagFrames} | ${formatNumber(assessment.silenceStdDev)} | ${formatNumber(assessment.responseRatio)} |`,
    );
  }
  lines.push('');
  lines.push('## Summary');
  lines.push(
    `- reactive: ${report.summary.reactiveVariableCount}, autonomous: ${report.summary.autonomousVariableCount}, weak: ${report.summary.weakVariableCount}, static: ${report.summary.staticVariableCount}`,
  );
  lines.push(
    `- strongest audio link: ${report.summary.bestVariable ?? 'none'} (corr ${report.summary.bestCorrelation.toFixed(3)})`,
  );
  return lines.join('\n');
}

function reportOutputDir(outputDir: string, presetId: string) {
  return path.join(outputDir, presetId);
}

export function comparePresetReactivityReports(
  baseline: PresetReactivityReport,
  current: PresetReactivityReport,
): string {
  const lines: string[] = [];
  lines.push(
    `# Reactivity comparison — ${current.presetId} (baseline vs current)`,
  );
  lines.push('');
  const deltas = compareMetricRecords(
    REACTIVITY_COMPARISON_SPECS,
    baseline.summary as unknown as Record<string, number>,
    current.summary as unknown as Record<string, number>,
  );
  lines.push(...formatMetricDeltaLines(deltas));
  lines.push('');

  const baselineByVariable = new Map(
    baseline.variables.map((assessment) => [assessment.variable, assessment]),
  );
  const movers = current.variables
    .map((assessment) => {
      const before = baselineByVariable.get(assessment.variable);
      if (!before) {
        return null;
      }
      return {
        variable: assessment.variable,
        before: before.bestCorrelation,
        after: assessment.bestCorrelation,
        delta:
          Math.abs(assessment.bestCorrelation) -
          Math.abs(before.bestCorrelation),
        verdictBefore: before.verdict,
        verdictAfter: assessment.verdict,
      };
    })
    .filter((mover): mover is NonNullable<typeof mover> => mover !== null)
    .filter(
      (mover) =>
        Math.abs(mover.delta) > 0.05 ||
        mover.verdictBefore !== mover.verdictAfter,
    )
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta));

  if (movers.length === 0) {
    lines.push('No per-variable reactivity changes above the 0.05 threshold.');
  } else {
    lines.push('Per-variable movers:');
    for (const mover of movers.slice(0, 12)) {
      lines.push(
        `- ${mover.variable}: |corr| ${Math.abs(mover.before).toFixed(3)} → ${Math.abs(mover.after).toFixed(3)} (${mover.verdictBefore} → ${mover.verdictAfter})`,
      );
    }
  }
  return lines.join('\n');
}

type CliOptions = {
  presetIds: string[];
  filePath: string | null;
  outputDir: string;
  warmupFrames: number;
  sampleFrames: number;
  fps: number;
  variables: string[] | null;
  writeBaseline: boolean;
  compare: boolean;
  json: boolean;
};

function readArg(argv: string[], name: string, fallback: string) {
  const index = argv.indexOf(name);
  return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
}

function parseArgs(argv: string[]): CliOptions {
  return {
    presetIds: argv.flatMap((arg, index) =>
      arg === '--preset' && argv[index + 1] ? [argv[index + 1] as string] : [],
    ),
    filePath: argv.includes('--file')
      ? readArg(argv, '--file', '') || null
      : null,
    outputDir: path.resolve(readArg(argv, '--out', DEFAULT_OUTPUT_DIR)),
    warmupFrames: Number.parseInt(
      readArg(argv, '--warmup', `${DEFAULT_WARMUP_FRAMES}`),
      10,
    ),
    sampleFrames: Number.parseInt(
      readArg(argv, '--frames', `${DEFAULT_SAMPLE_FRAMES}`),
      10,
    ),
    fps: Number.parseInt(readArg(argv, '--fps', `${DEFAULT_FPS}`), 10),
    variables: argv.includes('--vars')
      ? readArg(argv, '--vars', '')
          .split(',')
          .map((token) => token.trim())
          .filter(Boolean)
      : null,
    writeBaseline: argv.includes('--baseline'),
    compare: argv.includes('--compare'),
    json: argv.includes('--json'),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = repoRootFromScript();
  const targets: Array<{ presetId?: string; filePath?: string }> =
    options.filePath !== null
      ? [{ filePath: options.filePath, presetId: options.presetIds[0] }]
      : options.presetIds.map((presetId) => ({ presetId }));
  if (targets.length === 0) {
    console.error(
      'Usage: bun run lab:reactivity -- --preset <id> [--preset <id> …] [--file path.milk]\n' +
        '  [--frames 360] [--warmup 90] [--fps 60] [--vars zoom,warp,…]\n' +
        '  [--out scratch/preset-lab] [--baseline] [--compare] [--json]',
    );
    process.exit(2);
  }

  for (const target of targets) {
    const source = loadPresetSource(repoRoot, target);
    const report = measurePresetReactivity({
      source,
      warmupFrames: options.warmupFrames,
      sampleFrames: options.sampleFrames,
      fps: options.fps,
      trackedVariables: options.variables,
    });

    const outputDir = reportOutputDir(options.outputDir, report.presetId);
    fs.mkdirSync(outputDir, { recursive: true });
    const reportPath = path.join(outputDir, 'reactivity.json');
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    const baselinePath = path.join(outputDir, 'reactivity.baseline.json');
    if (options.writeBaseline) {
      fs.writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`);
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(formatReactivityReportText(report));
      console.log('');
      console.log(`Report written to ${reportPath}`);
      if (options.writeBaseline) {
        console.log(`Baseline written to ${baselinePath}`);
      }
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
        ) as PresetReactivityReport;
        console.log('');
        console.log(comparePresetReactivityReports(baseline, report));
      }
    }
  }
}

if (import.meta.main) {
  await main();
}
