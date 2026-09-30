/**
 * Preset lab — audio-to-controls baseline: how much of each preset's per-frame behaviour a linear model of the audio predicts.
 *
 * The "neural VJ" idea is a model that drives a preset's controls (zoom,
 * rotation, colours, q-registers) from live audio. Before training one, this
 * measures the floor it has to beat: ridge regression to each preset's
 * per-frame state from a clock (time, and its sine/cosine at a few
 * periods), and from the clock plus the audio signals and their recent
 * history. Much preset motion is driven by `time`, so the clock is the
 * honest reference; what audio adds on top is the number that matters.
 *
 *   bun run lab:dataset -- --out output/dataset --scenarios bass-pulse,mid-pulse,treble-pulse,full-mix
 *   bun run lab:vj-baseline -- --dataset output/dataset [--ridge 0.1]
 *
 * Scored leave-one-scenario-out: each model learns from all but one
 * scenario and predicts the held-out one, for every scenario in turn. The
 * scenarios span the same stretch of time, so the clock can explain only
 * what they share; what differs between stimuli has to come from the audio.
 * (A split in time does not work on few-second clips: clock periods longer
 * than the training window cannot be identified and extrapolate wildly.)
 * R² per moving column is averaged over folds, then the median is taken per
 * preset. Every preset hears the same audio, so each fold's design matrix is
 * shared and one solve serves the whole corpus.
 *
 * Reported per preset (report.json) and summarised: median held-out R² for
 * each model, the median gain from audio, and the share of presets where
 * audio adds more than 0.1.
 *
 * Plain R² rewards the clock: many presets are clockwork (the same function
 * of time on every stimulus), and they score near 1 without any audio. So
 * the headline is audio R² (`audioR2`): on columns whose variance is at
 * least 10% audio-driven (`audioShare`: the part that differs between
 * scenarios at the same frame), the share of the held-out scenario's
 * departure from the clock oracle (the training scenarios' mean trajectory)
 * that the clock + audio model predicts. 0 is the clock oracle, 1 is
 * perfect; errors are pooled over folds so a quiet scenario cannot blow up
 * the ratio. Presets with no audio-driven column are counted as clockwork
 * and left out of it. Low scores are informative too: they mark
 * presets whose behaviour is not a linear function of time and audio
 * (thresholds, accumulators, feedback), which is what a nonlinear model is
 * for.
 */

import fs from 'node:fs';
import path from 'node:path';
import { decodeNpy } from './preset-lab-map.ts';

/** History the model sees: the current frame and these many frames back. */
const LAGS = [0, 4, 12, 30] as const;
/**
 * Default ridge penalty per training row, on standardised inputs with the
 * intercept unpenalised. Override with --ridge; the scores move with it
 * (four stimuli are few), so compare models at the same value.
 */
const DEFAULT_RIDGE = 0.1;

type IndexRow = {
  presetId: string;
  scenario: string;
  file: string | null;
};

/**
 * Ridge regression: solves (AᵀA + λ·n·I′) x = Aᵀb for several right-hand
 * sides via Cholesky, where I′ leaves the intercept (column 0) unpenalised.
 */
export function ridgeSolver(
  design: readonly Float64Array[],
  lambda: number,
): (targets: readonly Float64Array[]) => Float64Array[] {
  const rows = design.length;
  const width = design[0]?.length ?? 0;
  const gram = Array.from({ length: width }, () => new Float64Array(width));
  for (const row of design) {
    for (let i = 0; i < width; i += 1) {
      const ri = row[i] as number;
      if (ri === 0) continue;
      const gi = gram[i] as Float64Array;
      for (let j = 0; j <= i; j += 1)
        gi[j] = (gi[j] as number) + ri * (row[j] as number);
    }
  }
  // Column 0 is the intercept: penalising it shrinks every prediction
  // towards zero, and preset controls sit far from zero (zoom ≈ 1).
  for (let i = 1; i < width; i += 1) {
    const gi = gram[i] as Float64Array;
    gi[i] = (gi[i] as number) + lambda * rows;
  }
  // Cholesky: gram = L·Lᵀ.
  const lower = Array.from({ length: width }, () => new Float64Array(width));
  for (let i = 0; i < width; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let sum = gram[i]?.[j] as number;
      for (let k = 0; k < j; k += 1) {
        sum -= (lower[i]?.[k] as number) * (lower[j]?.[k] as number);
      }
      (lower[i] as Float64Array)[j] =
        i === j
          ? Math.sqrt(Math.max(sum, 1e-12))
          : sum / (lower[j]?.[j] as number);
    }
  }
  return (targets) =>
    targets.map((target) => {
      const rhs = new Float64Array(width);
      design.forEach((row, r) => {
        const t = target[r] as number;
        for (let i = 0; i < width; i += 1)
          rhs[i] = (rhs[i] as number) + (row[i] as number) * t;
      });
      const y = new Float64Array(width);
      for (let i = 0; i < width; i += 1) {
        let sum = rhs[i] as number;
        for (let k = 0; k < i; k += 1)
          sum -= (lower[i]?.[k] as number) * (y[k] as number);
        y[i] = sum / (lower[i]?.[i] as number);
      }
      const x = new Float64Array(width);
      for (let i = width - 1; i >= 0; i -= 1) {
        let sum = y[i] as number;
        for (let k = i + 1; k < width; k += 1)
          sum -= (lower[k]?.[i] as number) * (x[k] as number);
        x[i] = sum / (lower[i]?.[i] as number);
      }
      return x;
    });
}

/**
 * Design rows for one scenario: a bias, then each signal at every lag in
 * LAGS (clamped at the first frame). Signals are standardised with the
 * training statistics so the ridge penalty treats them alike.
 */
export function audioDesign(
  signals: Float32Array,
  signalWidth: number,
  stats: { mean: Float64Array; std: Float64Array },
): Float64Array[] {
  const frames = signals.length / signalWidth;
  return Array.from({ length: frames }, (_, f) => {
    const row = new Float64Array(1 + signalWidth * LAGS.length);
    row[0] = 1;
    LAGS.forEach((lag, l) => {
      const source = Math.max(0, f - lag);
      for (let s = 0; s < signalWidth; s += 1) {
        const value = signals[source * signalWidth + s] as number;
        row[1 + l * signalWidth + s] =
          (value - (stats.mean[s] as number)) / (stats.std[s] as number) || 0;
      }
    });
    return row;
  });
}

/**
 * One leave-one-scenario-out fold's clock + audio rows. Audio is
 * standardised with the training scenarios' statistics only: the scale sets
 * how hard the ridge penalty bites, so fitting it on the held-out scenario
 * too would leak that scenario into the model.
 */
export function scenarioFold(
  signals: readonly Float32Array[],
  signalWidth: number,
  clock: readonly Float64Array[],
  held: number,
): { others: number[]; train: Float64Array[]; heldOut: Float64Array[] } {
  const others = signals.map((_, i) => i).filter((i) => i !== held);
  const frames = clock.length;
  const stats = signalStats(
    others.map((i) => signals[i] as Float32Array),
    signalWidth,
    frames,
  );
  const rows = (scenario: number) =>
    audioDesign(signals[scenario] as Float32Array, signalWidth, stats).map(
      (row, f) => concat(clock[f] as Float64Array, row.subarray(1)),
    );
  return { others, train: others.flatMap(rows), heldOut: rows(held) };
}

/**
 * Clock-only rows: bias, and sin/cos of time at periods covering the ones
 * presets use (including 2π s, i.e. sin(time)). No linear time term: a ramp
 * fitted on the training frames extrapolates into the held-out ones, and it
 * competes with slowly adapting audio signals for the same variance.
 */
export function clockDesign(frames: number, fps: number): Float64Array[] {
  const periods = [0.5, 1, 2, 4, 2 * Math.PI, 8, 16];
  return Array.from({ length: frames }, (_, f) => {
    const t = f / fps;
    const row = new Float64Array(1 + periods.length * 2);
    row[0] = 1;
    periods.forEach((period, i) => {
      row[1 + i * 2] = Math.sin((2 * Math.PI * t) / period);
      row[2 + i * 2] = Math.cos((2 * Math.PI * t) / period);
    });
    return row;
  });
}

/** R² of `predicted` against `actual`; null when actual does not vary. */
export function rSquared(
  actual: ArrayLike<number>,
  predicted: ArrayLike<number>,
): number | null {
  const n = actual.length;
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += actual[i] as number;
  mean /= n;
  let total = 0;
  let residual = 0;
  for (let i = 0; i < n; i += 1) {
    total += ((actual[i] as number) - mean) ** 2;
    residual += ((actual[i] as number) - (predicted[i] as number)) ** 2;
  }
  if (total <= 1e-12 * n) return null;
  return 1 - residual / total;
}

/** Columns at least this audio-driven are scored by audio R². */
const AUDIO_SHARE_MIN = 0.1;

/**
 * Share of a column's variance that differs between runs of the same
 * preset at the same frame, i.e. is driven by the stimulus rather than the
 * clock. runs: one Float64Array per scenario, equal lengths. 0 when flat.
 */
export function audioShare(runs: readonly Float64Array[]): number {
  const frames = runs[0]?.length ?? 0;
  const n = runs.length * frames;
  if (n === 0 || runs.length < 2) return 0;
  let sum = 0;
  for (const run of runs) for (const value of run) sum += value;
  const mean = sum / n;
  let total = 0;
  for (const run of runs) for (const value of run) total += (value - mean) ** 2;
  if (total / n < 1e-12) return 0;
  let between = 0;
  for (let f = 0; f < frames; f += 1) {
    let frameMean = 0;
    for (const run of runs) frameMean += run[f] as number;
    frameMean /= runs.length;
    for (const run of runs) between += ((run[f] as number) - frameMean) ** 2;
  }
  return between / total;
}

/**
 * Audio R², pooled: 1 − Σ(actual − predicted)² / Σ(actual − oracle)² over
 * every (fold, frame) pair given, where `oracle` is the clock oracle for
 * that fold. null when the actual never departs from the oracle (nothing
 * audio-driven to explain). Clamped at −1 like the per-column R².
 */
export function audioR2(
  pairs: ReadonlyArray<{
    actual: Float64Array;
    predicted: Float64Array;
    oracle: Float64Array;
  }>,
): number | null {
  let residual = 0;
  let departure = 0;
  for (const { actual, predicted, oracle } of pairs) {
    for (let f = 0; f < actual.length; f += 1) {
      residual += ((actual[f] as number) - (predicted[f] as number)) ** 2;
      departure += ((actual[f] as number) - (oracle[f] as number)) ** 2;
    }
  }
  if (departure < 1e-12) return null;
  return Math.max(-1, 1 - residual / departure);
}

function predict(
  design: readonly Float64Array[],
  weights: Float64Array,
): Float64Array {
  return Float64Array.from(design, (row) => {
    let sum = 0;
    for (let i = 0; i < row.length; i += 1)
      sum += (row[i] as number) * (weights[i] as number);
    return sum;
  });
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function readJsonl<T>(file: string): T[] {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as T);
}

function main() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const datasetDir = get('--dataset');
  if (!datasetDir) {
    throw new Error(
      'Usage: bun run lab:vj-baseline -- --dataset <lab:dataset dir> [--ridge 0.1] [--out output/vj-baseline]',
    );
  }
  const outDir = path.resolve(get('--out') ?? 'output/vj-baseline');
  const ridge = Number(get('--ridge') ?? DEFAULT_RIDGE);
  if (!(ridge >= 0)) throw new Error('--ridge must be a number >= 0');
  const root = path.resolve(datasetDir);
  const files = fs.readdirSync(root);
  const manifestFile = files.find((file) => /^manifest.*\.json$/.test(file));
  if (!manifestFile) throw new Error(`${root} has no manifest*.json`);
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, manifestFile), 'utf8'),
  ) as {
    fps: number;
    signals: { columns: string[] };
    states: { columns: string[] | string };
  };
  if (!Array.isArray(manifest.states.columns)) {
    throw new Error(
      'lab:vj-baseline needs a dataset with the canonical columns.',
    );
  }
  const columns = manifest.states.columns.length;
  const signalWidth = manifest.signals.columns.length;
  const loadFloats = (file: string) =>
    decodeNpy(new Uint8Array(fs.readFileSync(path.join(root, file))))
      .data as Float32Array;

  const rows = files
    .filter((file) => /^index.*\.jsonl$/.test(file))
    .flatMap((file) => readJsonl<IndexRow>(path.join(root, file)));
  const scenarios = [...new Set(rows.map((row) => row.scenario))].sort();
  const signals = scenarios.map((scenario) =>
    loadFloats(`signals/${scenario}.npy`),
  );
  const frames = (signals[0]?.length ?? 0) / signalWidth;
  if (scenarios.length < 2) {
    throw new Error(
      'lab:vj-baseline needs at least two scenarios to hold one out.',
    );
  }
  // Leave one scenario out: every scenario spans the same stretch of time,
  // so the clock model can only explain what they share, and whatever
  // differs between stimuli has to come from the audio.
  const clock = clockDesign(frames, manifest.fps);
  const folds = scenarios.map((_, held) => {
    const fold = scenarioFold(signals, signalWidth, clock, held);
    return {
      held,
      others: fold.others,
      heldFull: fold.heldOut,
      solveClock: ridgeSolver(
        fold.others.flatMap(() => clock),
        ridge,
      ),
      solveFull: ridgeSolver(fold.train, ridge),
    };
  });

  const byPreset = new Map<string, Map<string, string>>();
  for (const row of rows) {
    if (!row.file) continue;
    const map = byPreset.get(row.presetId) ?? new Map<string, string>();
    map.set(row.scenario, row.file);
    byPreset.set(row.presetId, map);
  }

  const perPreset: Array<{
    id: string;
    clockR2: number;
    clockAudioR2: number;
    columns: number;
    audioColumns: number;
    audioR2: number | null;
  }> = [];
  for (const [id, scenarioFiles] of [...byPreset].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!scenarios.every((s) => scenarioFiles.has(s))) continue;
    const states = scenarios.map((s) =>
      loadFloats(scenarioFiles.get(s) as string),
    );
    const column = (scenario: number, c: number) =>
      Float64Array.from(
        { length: frames },
        (_, f) => states[scenario]?.[f * columns + c] as number,
      );
    const moving: number[] = [];
    for (let c = 0; c < columns; c += 1) {
      // Scored only where the column moves in some scenario.
      if (
        states.some((_, i) => rSquared(column(i, c), column(i, c)) !== null)
      ) {
        moving.push(c);
      }
    }
    if (moving.length === 0) continue;
    const foldScores = (model: 'clock' | 'full') =>
      moving.map((c) => {
        const perFold = folds.map((fold) => {
          const target = Float64Array.from(
            fold.others.flatMap((i) => Array.from(column(i, c))),
          );
          const [weights] = (
            model === 'clock' ? fold.solveClock : fold.solveFull
          )([target]);
          const design = model === 'clock' ? clock : fold.heldFull;
          const actual = column(fold.held, c);
          const predicted = predict(design, weights as Float64Array);
          const r2 = rSquared(actual, predicted);
          // A held-out scenario where the column is flat is scored by
          // whether the model also predicts it flat (1) or not (0).
          if (r2 === null) {
            const error = actual.reduce(
              (sum, value, f) =>
                sum + Math.abs(value - (predicted[f] as number)),
              0,
            );
            return error / frames < 1e-3 ? 1 : 0;
          }
          // Worse than predicting the mean scores below 0; clamp so one
          // wild column cannot dominate a preset's median.
          return Math.max(-1, r2);
        });
        return perFold.reduce((sum, value) => sum + value, 0) / perFold.length;
      });
    // Audio R² on the audio-driven columns: the clock + audio model against
    // each fold's clock oracle, the training scenarios' mean trajectory.
    const audioScores: number[] = [];
    for (const c of moving) {
      const runs = scenarios.map((_, i) => column(i, c));
      if (audioShare(runs) < AUDIO_SHARE_MIN) continue;
      const pairs = folds.map((fold) => {
        const target = Float64Array.from(
          fold.others.flatMap((i) => Array.from(runs[i] as Float64Array)),
        );
        const [weights] = fold.solveFull([target]);
        const oracle = Float64Array.from({ length: frames }, (_, f) => {
          let sum = 0;
          for (const i of fold.others)
            sum += (runs[i] as Float64Array)[f] as number;
          return sum / fold.others.length;
        });
        return {
          actual: runs[fold.held] as Float64Array,
          predicted: predict(fold.heldFull, weights as Float64Array),
          oracle,
        };
      });
      const score = audioR2(pairs);
      if (score !== null) audioScores.push(score);
    }
    perPreset.push({
      id,
      clockR2: median(foldScores('clock')),
      clockAudioR2: median(foldScores('full')),
      columns: moving.length,
      audioColumns: audioScores.length,
      audioR2: audioScores.length ? median(audioScores) : null,
    });
  }

  const gain = perPreset.map((p) => p.clockAudioR2 - p.clockR2);
  const reactive = perPreset.filter((p) => p.audioR2 !== null);
  const summary = {
    presets: perPreset.length,
    audioReactivePresets: reactive.length,
    clockworkPresets: perPreset.length - reactive.length,
    medianAudioR2: reactive.length
      ? median(reactive.map((p) => p.audioR2 as number))
      : null,
    scenarios,
    split: 'leave one scenario out',
    lags: LAGS,
    ridge,
    medianClockR2: median(perPreset.map((p) => p.clockR2)),
    medianClockAudioR2: median(perPreset.map((p) => p.clockAudioR2)),
    medianAudioGain: median(gain),
    shareAudioGainOverTenth:
      gain.filter((g) => g > 0.1).length / Math.max(1, perPreset.length),
    shareClockAudioOverHalf:
      perPreset.filter((p) => p.clockAudioR2 > 0.5).length /
      Math.max(1, perPreset.length),
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify({ summary, presets: perPreset }, null, 2),
  );
  console.log(
    `Linear controls baseline on ${summary.presets} presets (${summary.split}, ${scenarios.length} folds)`,
  );
  console.log(
    summary.medianAudioR2 === null
      ? '  audio R²: no preset has an audio-driven column'
      : `  audio R² (beyond the clock oracle, ${summary.audioReactivePresets} audio-reactive presets; ${summary.clockworkPresets} clockwork): ${summary.medianAudioR2.toFixed(3)}`,
  );
  console.log(
    `  median held-out R² per preset: clock only ${summary.medianClockR2.toFixed(3)}, clock + audio ${summary.medianClockAudioR2.toFixed(3)} (median gain ${summary.medianAudioGain.toFixed(3)})`,
  );
  console.log(
    `  audio adds >0.1 R² for ${(summary.shareAudioGainOverTenth * 100).toFixed(1)}% of presets; clock + audio explains >50% for ${(summary.shareClockAudioOverHalf * 100).toFixed(1)}%`,
  );
}

function concat(a: Float64Array, b: Float64Array): Float64Array {
  const out = new Float64Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

/** Per-signal mean and spread over the training frames of every scenario. */
function signalStats(
  blocks: readonly Float32Array[],
  width: number,
  frames: number,
): { mean: Float64Array; std: Float64Array } {
  const mean = new Float64Array(width);
  const std = new Float64Array(width);
  const count = blocks.length * frames;
  for (const block of blocks) {
    for (let f = 0; f < frames; f += 1) {
      for (let s = 0; s < width; s += 1) {
        mean[s] = (mean[s] as number) + (block[f * width + s] as number);
      }
    }
  }
  for (let s = 0; s < width; s += 1) mean[s] = (mean[s] as number) / count;
  for (const block of blocks) {
    for (let f = 0; f < frames; f += 1) {
      for (let s = 0; s < width; s += 1) {
        std[s] =
          (std[s] as number) +
          ((block[f * width + s] as number) - (mean[s] as number)) ** 2;
      }
    }
  }
  for (let s = 0; s < width; s += 1) {
    std[s] = Math.sqrt((std[s] as number) / count) || 1;
  }
  return { mean, std };
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
