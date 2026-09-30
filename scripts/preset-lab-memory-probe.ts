/**
 * Preset lab — memory probe: how long each preset control remembers a short bump in one audio signal (no model, no browser).
 *
 * A preset is a program of its audio signals and the clock, so how much audio
 * history a model of it needs is a property of the program, not something to
 * infer from which network trains best. This measures it. Each preset runs
 * once on the stimulus, then again with one signal group (bass, mid, treb,
 * their _att smoothings, level, beat) raised for a few frames partway
 * through. Nothing else changes and the VM is deterministic (a zero bump
 * reproduces the run exactly), so the difference between the two runs is the
 * preset's response to that bump alone:
 *
 *   - memory: how long after the bump ends the response stays above 2% of
 *     the control's spread. Classed as instant (gone when the bump ends),
 *     short (≤0.25 s), seconds (≤4 s), long (>4 s), or persistent (still
 *     there in the run's last half second: accumulators, counters, toggles).
 *   - nonlinearity: ‖Δ₂ − 2Δ₁‖ / ‖2Δ₁‖ from a second run at twice the bump.
 *     0 when the response doubles exactly; above ~0.2 a linear model of the
 *     audio cannot represent it.
 *
 *   bun run lab:memory-probe -- --audio song.wav [--audio more/] [--start 30]
 *   bun run lab:memory-probe -- --audio music/ --sample 120 --shard 0/6 --out output/memory-probe
 *   bun run lab:memory-probe -- --only eos-ether martin-liquid-arrows
 *   bun run lab:memory-probe -- --report output/memory-probe   # census over every shard
 *
 * `lab:vj-baseline -- --memory <out dir>` scores audio R² separately for the
 * bounded columns (instant, short, seconds) and the stateful ones (long,
 * persistent, and audio-driven columns no bump moved). The two behave too
 * differently for one pooled score to describe either.
 *
 * Without --audio the stimulus is the synthetic full-mix scenario, which is
 * fine for a smoke test; measure on real music, whose signal statistics
 * differ. Bumps are half a standard deviation of each signal over the
 * stimulus (twice that for the linearity run); the beat probe injects one
 * detected beat instead, which has no "twice".
 *
 * Writes <out>/probe.jsonl (probe-<k>-of-<n>.jsonl with --shard), one row per
 * preset: { id, status, stimuli, columns: { <name>: { memory, memoryFrames,
 * nonlinearity, signals } } }. Only columns some bump moved are listed, each
 * with the worst case over probes and stimuli. A census by memory class is
 * printed at the end.
 *
 * Limits: a bump small enough to stay local can miss a threshold (an adaptive
 * beat detector that needs a bigger jump), so a column no bump moved may still
 * be audio-driven; lab:vj-baseline counts those as stateful. The twice-size
 * run is only made for probes whose first run moved something. A bump that
 * changes how often a preset calls rand() shifts its random stream for the
 * rest of the run and reads as persistent.
 *
 * lab:sensitivity is the sibling that bumps a preset's fields instead of its
 * audio.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type FrameInputs,
  fnv1a,
  snapshotFrameInputs,
} from '../src/js/milkdrop/trace-capture.ts';
import { buildAudioFileInputs, decodeWav } from './audio-file-inputs.ts';
import {
  audioScenarioName,
  CANONICAL_VARIABLES,
  resolveAudioPaths,
  runPresetForDataset,
} from './preset-lab-dataset.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';
import {
  buildScenarioInputs,
  createFrameSignalReader,
} from './preset-lab-replay.ts';

const FPS = 60;
const DEFAULT_FRAMES = 1800;
const DEFAULT_AT = 600;
const BUMP_FRAMES = 3;
/** Bump size, in standard deviations of the signal over the stimulus. */
const BUMP_STDS = 0.5;
/** A response below this share of the column's spread counts as gone. */
const RESPONSE_THRESHOLD = 0.02;
/** A response still present this close to the end is persistent. */
const PERSISTENT_TAIL_SECONDS = 0.5;

/**
 * Signal groups bumped together. Each group lists every alias the VM reads
 * for that band (vm/shared.ts syncSignalEnvironment), so a bump cannot be
 * dodged by a preset spelling it differently.
 */
export const PROBE_SIGNALS: Readonly<Record<string, readonly string[]>> = {
  bass: ['bass'],
  mid: ['mid', 'mids'],
  treb: ['treb', 'treble'],
  bass_att: ['bass_att', 'bassAtt'],
  mid_att: ['mid_att', 'mids_att', 'midAtt', 'midsAtt'],
  treb_att: ['treb_att', 'treble_att', 'trebleAtt', 'trebAtt'],
  level: ['vol', 'rms', 'weightedEnergy'],
  beat: ['beat', 'beat_pulse', 'beatPulse'],
};

/** Probes that set their signals to 1 (a detected beat) rather than add to them. */
const EVENT_PROBES = new Set(['beat']);

export type MemoryClass =
  | 'instant'
  | 'short'
  | 'seconds'
  | 'long'
  | 'persistent';

/** Classes whose memory ends within seconds; the rest are stateful. */
export const BOUNDED_MEMORY: ReadonlySet<MemoryClass> = new Set([
  'instant',
  'short',
  'seconds',
]);

export function memoryClass(
  memoryFrames: number,
  persistent: boolean,
  fps: number,
): MemoryClass {
  if (persistent) return 'persistent';
  if (memoryFrames <= 0) return 'instant';
  if (memoryFrames <= 0.25 * fps) return 'short';
  if (memoryFrames <= 4 * fps) return 'seconds';
  return 'long';
}

export type Bump = { at: number; length: number };

/**
 * Frames that carry the signals the VM steps with, so a bump can edit them.
 * Audio-file frames already do; synthetic ones run through a fresh signal
 * tracker once, exactly as lab:dataset would feed them.
 */
export function settleSignals(inputs: readonly FrameInputs[]): FrameInputs[] {
  const read = createFrameSignalReader();
  return inputs.map((frame) =>
    frame.signals
      ? frame
      : snapshotFrameInputs({
          time: frame.time,
          deltaMs: frame.deltaMs,
          frequencyData: frame.frequencyData,
          waveformData: frame.waveformData,
          signals: read(frame) as object,
        }),
  );
}

/** Standard deviation of every numeric signal over a stimulus. */
export function signalSpread(
  frames: readonly FrameInputs[],
): Record<string, number> {
  const sums: Record<string, { sum: number; squares: number }> = {};
  for (const frame of frames) {
    for (const [key, value] of Object.entries(frame.signals ?? {})) {
      if (typeof value !== 'number') continue;
      const entry = sums[key] ?? { sum: 0, squares: 0 };
      sums[key] = entry;
      entry.sum += value;
      entry.squares += value * value;
    }
  }
  const n = Math.max(1, frames.length);
  return Object.fromEntries(
    Object.entries(sums).map(([key, { sum, squares }]) => [
      key,
      Math.sqrt(Math.max(0, squares / n - (sum / n) ** 2)),
    ]),
  );
}

/**
 * A copy of `frames` with `keys` raised by `size` standard deviations for
 * the bump's frames, or set to 1 when `event` (a detected beat). Frames
 * outside the bump are shared, not copied.
 */
export function bumpFrames(
  frames: readonly FrameInputs[],
  keys: readonly string[],
  spread: Readonly<Record<string, number>>,
  bump: Bump,
  size: number,
  event = false,
): FrameInputs[] {
  return frames.map((frame, f) => {
    if (f < bump.at || f >= bump.at + bump.length || !frame.signals) {
      return frame;
    }
    const signals = { ...frame.signals };
    for (const key of keys) {
      const value = signals[key];
      if (typeof value !== 'number') continue;
      signals[key] = event ? 1 : value + size * (spread[key] ?? 0);
    }
    return { ...frame, signals };
  });
}

export type Response = {
  memoryFrames: number;
  persistent: boolean;
  nonlinearity: number | null;
};

/**
 * One column's response to a bump: how many frames after the bump ends it
 * stays above RESPONSE_THRESHOLD of the column's spread, whether it is still
 * there at the end, and (given the twice-size run) how far it is from
 * doubling. null when the bump never moves the column past the threshold.
 */
export function measureResponse(
  base: ArrayLike<number>,
  bumped: ArrayLike<number>,
  doubled: ArrayLike<number> | null,
  bump: Bump,
  fps: number,
): Response | null {
  const n = base.length;
  let mean = 0;
  for (let f = 0; f < n; f += 1) mean += base[f] as number;
  mean /= n;
  let variance = 0;
  for (let f = 0; f < n; f += 1) variance += ((base[f] as number) - mean) ** 2;
  // A column that sits still in the base run is scaled by its magnitude, so
  // any real departure from it still registers.
  const scale = Math.max(
    Math.sqrt(variance / n),
    1e-3 * Math.max(1, Math.abs(mean)),
  );
  let last = -1;
  for (let f = bump.at; f < n; f += 1) {
    const departure =
      Math.abs((bumped[f] as number) - (base[f] as number)) / scale;
    if (departure > RESPONSE_THRESHOLD) last = f;
  }
  if (last < 0) return null;
  let nonlinearity: number | null = null;
  if (doubled) {
    let residual = 0;
    let expected = 0;
    for (let f = bump.at; f <= last; f += 1) {
      const once = (bumped[f] as number) - (base[f] as number);
      const twice = (doubled[f] as number) - (base[f] as number);
      residual += (twice - 2 * once) ** 2;
      expected += (2 * once) ** 2;
    }
    nonlinearity = expected > 0 ? Math.sqrt(residual / expected) : null;
  }
  return {
    memoryFrames: Math.max(0, last - (bump.at + bump.length - 1)),
    persistent: last >= n - Math.round(PERSISTENT_TAIL_SECONDS * fps),
    nonlinearity,
  };
}

export type ColumnMemory = {
  memory: MemoryClass;
  memoryFrames: number;
  nonlinearity: number | null;
  /** The probes that moved it. */
  signals: string[];
};

export type ProbeRow = {
  id: string;
  status: string;
  detail?: string;
  stimuli: string[];
  columns: Record<string, ColumnMemory>;
};

export type Stimulus = { name: string; frames: FrameInputs[] };

/** Probes one preset against every stimulus; see the file docblock. */
export function probePreset(
  raw: string,
  id: string,
  stimuli: readonly Stimulus[],
  bump: Bump,
  fps = FPS,
): ProbeRow {
  const worst = new Map<
    string,
    {
      memoryFrames: number;
      persistent: boolean;
      nonlinearity: number | null;
      signals: Set<string>;
    }
  >();
  const row: ProbeRow = {
    id,
    status: 'ok',
    stimuli: stimuli.map((s) => s.name),
    columns: {},
  };
  const width = CANONICAL_VARIABLES.length;
  const column = (states: Float32Array, c: number) =>
    Float64Array.from(
      { length: states.length / width },
      (_, f) => states[f * width + c] as number,
    );
  let moving = false;
  for (const stimulus of stimuli) {
    const base = runPresetForDataset(
      raw,
      id,
      stimulus.frames,
      CANONICAL_VARIABLES,
    );
    // Nothing moves on this stimulus, so no bump is worth the runs.
    if (base.status === 'static') continue;
    moving = true;
    if (base.status !== 'ok' || !base.states) {
      row.status = base.status;
      row.detail = base.detail;
      return row;
    }
    const baseStates = base.states;
    const spread = signalSpread(stimulus.frames);
    for (const [probe, keys] of Object.entries(PROBE_SIGNALS)) {
      const event = EVENT_PROBES.has(probe);
      const run = (size: number) =>
        runPresetForDataset(
          raw,
          id,
          bumpFrames(stimulus.frames, keys, spread, bump, size, event),
          CANONICAL_VARIABLES,
        ).states;
      const once = run(BUMP_STDS);
      if (!once || once.every((value, i) => value === baseStates[i])) continue;
      const twice = event ? null : run(2 * BUMP_STDS);
      for (let c = 0; c < width; c += 1) {
        const response = measureResponse(
          column(baseStates, c),
          column(once, c),
          twice ? column(twice, c) : null,
          bump,
          fps,
        );
        if (!response) continue;
        const name = CANONICAL_VARIABLES[c] as string;
        const entry = worst.get(name) ?? {
          memoryFrames: 0,
          persistent: false,
          nonlinearity: null,
          signals: new Set<string>(),
        };
        entry.memoryFrames = Math.max(
          entry.memoryFrames,
          response.memoryFrames,
        );
        entry.persistent ||= response.persistent;
        if (response.nonlinearity !== null) {
          entry.nonlinearity = Math.max(
            entry.nonlinearity ?? 0,
            response.nonlinearity,
          );
        }
        entry.signals.add(probe);
        worst.set(name, entry);
      }
    }
  }
  if (!moving) row.status = 'static';
  for (const [name, entry] of worst) {
    row.columns[name] = {
      memory: memoryClass(entry.memoryFrames, entry.persistent, fps),
      memoryFrames: entry.memoryFrames,
      nonlinearity:
        entry.nonlinearity === null
          ? null
          : Math.round(entry.nonlinearity * 1000) / 1000,
      signals: [...entry.signals],
    };
  }
  return row;
}

/** Every probe row under `target`: a probe*.jsonl file or a directory of them. */
export function readMemoryProbe(target: string): ProbeRow[] {
  const files = fs.statSync(target).isDirectory()
    ? fs
        .readdirSync(target)
        .filter((file) => /^probe.*\.jsonl$/.test(file))
        .map((file) => path.join(target, file))
    : [target];
  if (files.length === 0) throw new Error(`${target} has no probe*.jsonl`);
  return files.flatMap((file) =>
    fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ProbeRow),
  );
}

const CLASSES: readonly MemoryClass[] = [
  'instant',
  'short',
  'seconds',
  'long',
  'persistent',
];

const COLUMN_GROUPS: ReadonlyArray<[string, (name: string) => boolean]> = [
  ['motion', (n) => /^(zoom|zoomexp|rot|warp\w*|cx|cy|dx|dy|sx|sy)$/.test(n)],
  ['wave', (n) => n.startsWith('wave_')],
  ['border', (n) => /^(ob|ib)_/.test(n)],
  ['q', (n) => /^q\d+$/.test(n)],
  ['other', () => true],
];

/** Census lines: memory classes over every moved column, overall and by group. */
export function formatCensus(rows: readonly ProbeRow[]): string[] {
  const ok = rows.filter((row) => row.status === 'ok');
  const cells = ok.flatMap((row) => Object.entries(row.columns));
  const moved = ok.filter((row) => Object.keys(row.columns).length > 0);
  const line = (label: string, group: Array<[string, ColumnMemory]>) => {
    const n = group.length;
    if (n === 0) return `  ${label.padEnd(8)} n=0`;
    const share = (count: number) => `${Math.round((100 * count) / n)}%`;
    const classes = CLASSES.map(
      (c) => `${c} ${share(group.filter(([, m]) => m.memory === c).length)}`,
    ).join(', ');
    const linear = group.filter(
      ([, m]) => m.nonlinearity !== null && m.nonlinearity < 0.2,
    ).length;
    return `  ${label.padEnd(8)} n=${n}: ${classes}; linear ${share(linear)}`;
  };
  const statuses = new Map<string, number>();
  for (const row of rows) {
    statuses.set(row.status, (statuses.get(row.status) ?? 0) + 1);
  }
  const lines = [
    `Memory probe: ${rows.length} presets (${[...statuses].map(([s, n]) => `${n} ${s}`).join(', ')}), ${moved.length} with a column some bump moved`,
    line('all', cells),
  ];
  const groupOf = (name: string) =>
    COLUMN_GROUPS.find(([, test]) => test(name))?.[0];
  for (const [label] of COLUMN_GROUPS) {
    lines.push(
      line(
        label,
        cells.filter(([name]) => groupOf(name) === label),
      ),
    );
  }
  const stateful = moved.filter((row) =>
    Object.values(row.columns).some((m) => !BOUNDED_MEMORY.has(m.memory)),
  ).length;
  lines.push(
    `  presets with a column that remembers a bump for over 4 s: ${stateful} of ${moved.length}`,
  );
  return lines;
}

async function buildStimuli(options: {
  audio: string[];
  frames: number;
  startSeconds: number;
}): Promise<Stimulus[]> {
  if (options.audio.length === 0) {
    return [
      {
        name: 'full-mix',
        frames: settleSignals(buildScenarioInputs('full-mix', options.frames)),
      },
    ];
  }
  const stimuli: Stimulus[] = [];
  const taken = new Set<string>();
  // One at a time: the offline analyser stands in for browser globals, and
  // two builds in flight share them.
  for (const file of resolveAudioPaths(options.audio)) {
    const name = audioScenarioName(file, taken);
    taken.add(name);
    const inputs = await buildAudioFileInputs(
      decodeWav(new Uint8Array(fs.readFileSync(file))),
      { frames: options.frames, startSeconds: options.startSeconds },
    );
    if (inputs.length < options.frames) {
      throw new Error(
        `${file} is shorter than ${options.frames} frames after --start.`,
      );
    }
    stimuli.push({ name, frames: settleSignals(inputs) });
  }
  return stimuli;
}

async function main() {
  const argv = process.argv.slice(2);
  const options = {
    audio: [] as string[],
    only: [] as string[],
    frames: DEFAULT_FRAMES,
    at: DEFAULT_AT,
    startSeconds: 0,
    sample: 0,
    shard: { index: 0, count: 1 },
    out: 'output/memory-probe',
    report: null as string | null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    const value = () => {
      const next = argv[++index];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      return next;
    };
    switch (arg) {
      case '--audio':
        options.audio.push(value());
        break;
      case '--only':
        while (argv[index + 1] && !argv[index + 1]?.startsWith('--')) {
          options.only.push(argv[++index] as string);
        }
        break;
      case '--frames':
        options.frames = Number(value());
        break;
      case '--at':
        options.at = Number(value());
        break;
      case '--start':
        options.startSeconds = Number(value());
        break;
      case '--sample':
        options.sample = Number(value());
        break;
      case '--shard': {
        const match = /^(\d+)\/(\d+)$/.exec(value());
        const shardIndex = Number(match?.[1]);
        const count = Number(match?.[2]);
        if (!match || count < 1 || shardIndex >= count) {
          throw new Error('--shard takes k/n with 0 <= k < n, e.g. 0/4');
        }
        options.shard = { index: shardIndex, count };
        break;
      }
      case '--out':
        options.out = value();
        break;
      case '--report':
        options.report = value();
        break;
      default:
        throw new Error(`Unknown flag ${arg}`);
    }
  }
  if (options.report) {
    for (const line of formatCensus(readMemoryProbe(options.report))) {
      console.log(line);
    }
    return;
  }
  const tail = Math.round(PERSISTENT_TAIL_SECONDS * FPS);
  if (!(options.at >= 1) || options.at + BUMP_FRAMES + tail >= options.frames) {
    throw new Error(
      `--at must leave room after the bump: 1 <= at < frames - ${BUMP_FRAMES + tail}`,
    );
  }

  const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  let entries = [...loadCatalogEntries(repoRoot).values()];
  if (options.only.length > 0) {
    const wanted = new Set(options.only);
    entries = entries.filter((entry) => wanted.has(entry.id));
    const missing = options.only.filter(
      (id) => !entries.some((entry) => entry.id === id),
    );
    if (missing.length > 0) throw new Error(`Unknown preset ids: ${missing}`);
  }
  if (options.sample > 0) {
    // A fixed pseudo-random sample: catalog order clusters remix families.
    entries = entries
      .map((entry) => ({ entry, key: fnv1a(`memory-probe:${entry.id}`) }))
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(0, options.sample)
      .map(({ entry }) => entry);
  }
  entries = entries.filter(
    (_, i) => i % options.shard.count === options.shard.index,
  );

  const stimuli = await buildStimuli(options);
  const bump = { at: options.at, length: BUMP_FRAMES };
  fs.mkdirSync(options.out, { recursive: true });
  const outFile = path.join(
    options.out,
    options.shard.count > 1
      ? `probe-${options.shard.index}-of-${options.shard.count}.jsonl`
      : 'probe.jsonl',
  );
  fs.writeFileSync(outFile, '');
  const rows: ProbeRow[] = [];
  for (const [i, entry] of entries.entries()) {
    const raw = fs.readFileSync(
      path.join(repoRoot, 'public', entry.file.replace(/^\//, '')),
      'latin1',
    );
    const row = probePreset(raw, entry.id, stimuli, bump);
    rows.push(row);
    // Appended per preset so a long run can be read, or resumed, midway.
    fs.appendFileSync(outFile, `${JSON.stringify(row)}\n`);
    console.error(
      `[${i + 1}/${entries.length}] ${entry.id}: ${row.status}, ${Object.keys(row.columns).length} columns moved`,
    );
  }
  for (const line of formatCensus(rows)) console.log(line);
  console.log(`Wrote ${outFile}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
