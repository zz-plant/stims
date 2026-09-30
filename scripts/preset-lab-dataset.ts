/**
 * Preset lab — ML dataset export: audio in, per-frame preset state out (no browser).
 *
 * Steps every catalog preset's CPU VM through deterministic audio scenarios
 * (the same generators lab:reactivity and lab:replay use) and writes the
 * result as NumPy arrays plus a JSONL index, ready for any training stack:
 *
 *   bun run lab:dataset                                   # whole corpus → output/dataset
 *   bun run lab:dataset -- --out /data/stims --frames 600
 *   bun run lab:dataset -- --scenarios full-mix,sweep --limit 50
 *   bun run lab:dataset -- --only eos-ether [...]         # subset
 *   bun run lab:dataset -- --vars all                     # every numeric VM variable
 *   bun run lab:dataset -- --shard 0/4 & … --shard 3/4    # four processes, one --out
 *
 * Layout written under --out:
 *   manifest.json            schema, scenarios, variable columns, split counts
 *   index.jsonl              one row per (preset, scenario): id, family, split, status, file
 *                            (index-<k>-of-<n>.jsonl and manifest-<k>-of-<n>.json with --shard)
 *   inputs/<scenario>.npy    uint8   [frames, 256]  spectrum bins 0–127 then waveform 0–127
 *   signals/<scenario>.npy   float32 [frames, S]    the tracker's band levels the VM stepped with
 *   states/<id>__<scenario>.npy float32 [frames, V] per-frame variables (columns in the manifest,
 *                                                   or in the index row with --vars all)
 *
 * Splits are assigned per remix family (src/js/milkdrop/preset-lineage.ts),
 * never per preset: a remix and its parent differ by a few lines, so a random
 * per-preset split puts near-copies on both sides and inflates every score.
 *
 * Presets whose compile or VM step throws, or whose output goes non-finite,
 * are listed in the index with that status and no states file. Presets whose
 * every column stays constant are kept and marked `static`.
 *
 * Determinism: the VM seeds its RNG from the preset id and the scenarios are
 * pure functions of frame time, so the same flags always write the same bytes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import {
  buildPresetFamilies,
  type LineageCatalogEntry,
} from '../src/js/milkdrop/preset-lineage.ts';
import { createMilkdropSignalTracker } from '../src/js/milkdrop/runtime-signals.ts';
import { fnv1a } from '../src/js/milkdrop/trace-capture.ts';
import type { MilkdropRuntimeSignals } from '../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../src/js/milkdrop/vm.ts';
import {
  PRESET_LAB_SCENARIOS,
  PRESET_LAB_SPECTRUM_BINS,
  type PresetLabScenario,
} from './preset-lab-metrics.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';
import { buildScenarioInputs, type FrameInputs } from './preset-lab-replay.ts';

const DEFAULT_FRAMES = 600;
const DEFAULT_OUT = 'output/dataset';
const FPS = 60;
const DATASET_VERSION = 1;

/**
 * The per-frame variables that describe what a MilkDrop frame looks like and
 * that nearly every preset carries: motion, feedback, the main wave, borders,
 * motion vectors and the q1–q32 channels presets use to pass state to their
 * shaders. A fixed list gives every states file the same columns, so the
 * whole corpus stacks into one tensor. `--vars all` trades that for every
 * numeric variable the VM exposes (around 2,000, mostly custom wave/shape
 * slots a given preset never enables).
 */
export const CANONICAL_VARIABLES: readonly string[] = [
  'zoom',
  'zoomexp',
  'rot',
  'warp',
  'warpanimspeed',
  'warp_scale',
  'cx',
  'cy',
  'dx',
  'dy',
  'sx',
  'sy',
  'decay',
  'gammaadj',
  'video_echo_zoom',
  'video_echo_alpha',
  'video_echo_orientation',
  'brighten',
  'darken',
  'darken_center',
  'solarize',
  'invert',
  'texture_wrap',
  'wave_mode',
  'wave_x',
  'wave_y',
  'wave_r',
  'wave_g',
  'wave_b',
  'wave_a',
  'wave_mystery',
  'wave_scale',
  'wave_smoothing',
  'wave_thick',
  'wave_additive',
  'wave_usedots',
  'wave_brighten',
  'ob_size',
  'ob_r',
  'ob_g',
  'ob_b',
  'ob_a',
  'ib_size',
  'ib_r',
  'ib_g',
  'ib_b',
  'ib_a',
  'motion_vectors_x',
  'motion_vectors_y',
  'mv_dx',
  'mv_dy',
  'mv_l',
  'mv_r',
  'mv_g',
  'mv_b',
  'mv_a',
  ...Array.from({ length: 32 }, (_, index) => `q${index + 1}`),
];

/** Tracker outputs written to signals/<scenario>.npy — what the VM heard. */
export const SIGNAL_COLUMNS: readonly string[] = [
  'bass',
  'mid',
  'treb',
  'bass_att',
  'mid_att',
  'treb_att',
  'rms',
  'vol',
  'beat',
  'beat_pulse',
  'transient',
  'spectralFlux',
  'weightedEnergy',
];

export type DatasetSplit = 'train' | 'val' | 'test';

export type SplitFractions = { val: number; test: number };

/**
 * Groups each preset with its remix family and assigns the whole family one
 * split, by hashing the family key with `seed`. Presets with no parseable
 * credit form a family of one. Deterministic for a given catalog and seed,
 * and stable when unrelated presets are added (each family's split depends
 * only on its own key).
 */
export function assignFamilySplits(
  entries: readonly LineageCatalogEntry[],
  fractions: SplitFractions,
  seed = 'stims',
): Map<string, { family: string; split: DatasetSplit }> {
  const familyOf = new Map<string, string>();
  for (const family of buildPresetFamilies(entries).values()) {
    for (const member of family.members) {
      familyOf.set(member.id, family.key);
    }
  }
  const result = new Map<string, { family: string; split: DatasetSplit }>();
  for (const entry of entries) {
    const family = familyOf.get(entry.id) ?? `solo:${entry.id}`;
    // fnv1a gives 32 well-mixed bits; map them to [0, 1).
    const unit = Number.parseInt(fnv1a(`${seed}\u0000${family}`), 16) / 2 ** 32;
    const split: DatasetSplit =
      unit < fractions.test
        ? 'test'
        : unit < fractions.test + fractions.val
          ? 'val'
          : 'train';
    result.set(entry.id, { family, split });
  }
  return result;
}

/**
 * Encodes a typed array as a NumPy .npy v1.0 file (C order, little-endian),
 * loadable with `numpy.load` and every .npy reader, no Python dependency here.
 */
export function encodeNpy(
  data: Float32Array | Uint8Array,
  shape: readonly number[],
): Uint8Array {
  const expected = shape.reduce((product, size) => product * size, 1);
  if (expected !== data.length) {
    throw new Error(
      `encodeNpy: shape [${shape.join(', ')}] needs ${expected} values, got ${data.length}`,
    );
  }
  const descr = data instanceof Float32Array ? '<f4' : '|u1';
  const shapeText =
    shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(', ')})`;
  let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': ${shapeText}, }`;
  // Magic (6) + version (2) + header length (2) + header + '\n' must be a
  // multiple of 64 so the data block is aligned.
  const unpadded = 10 + header.length + 1;
  header += ' '.repeat((64 - (unpadded % 64)) % 64);
  header += '\n';
  const headerBytes = new TextEncoder().encode(header);
  const out = new Uint8Array(10 + headerBytes.length + data.byteLength);
  out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0);
  out[8] = headerBytes.length & 0xff;
  out[9] = (headerBytes.length >> 8) & 0xff;
  out.set(headerBytes, 10);
  // Typed arrays are platform-endian; every platform Bun ships on is
  // little-endian, which is what the header declares.
  out.set(
    new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    10 + headerBytes.length,
  );
  return out;
}

export type PresetRunStatus =
  | 'ok'
  | 'static'
  | 'compile-error'
  | 'step-error'
  | 'nan';

export type PresetRun = {
  status: PresetRunStatus;
  /** Row-major [frames, columns.length]; null unless status is ok/static. */
  states: Float32Array | null;
  columns: string[];
  detail?: string;
};

/**
 * Steps one preset over `inputs` and returns its per-frame variables.
 * `variables` is either a fixed column list (missing variables read as 0) or
 * 'all', which uses every numeric variable present on the first frame.
 */
export function runPresetForDataset(
  raw: string,
  presetId: string,
  inputs: readonly FrameInputs[],
  variables: readonly string[] | 'all',
): PresetRun {
  const empty = (status: PresetRunStatus, detail: string): PresetRun => ({
    status,
    states: null,
    columns: [],
    detail,
  });
  let compiled: ReturnType<typeof compileMilkdropPresetSource>;
  try {
    compiled = compileMilkdropPresetSource(raw, { id: presetId });
  } catch (error) {
    return empty('compile-error', (error as Error).message.slice(0, 200));
  }
  const vm = createMilkdropVM(compiled);
  const tracker = createMilkdropSignalTracker();
  const frequencyData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const waveformData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);

  let columns: string[] | null = variables === 'all' ? null : [...variables];
  let states: Float32Array | null =
    columns === null ? null : new Float32Array(inputs.length * columns.length);
  let moved = false;

  for (let frame = 0; frame < inputs.length; frame += 1) {
    const input = inputs[frame] as FrameInputs;
    frequencyData.set(input.frequencyData);
    waveformData.set(input.waveformData);
    const signals = tracker.update({
      time: input.time,
      deltaMs: input.deltaMs,
      analyser: null,
      frequencyData,
      waveformData,
    });
    let frameVariables: Record<string, unknown>;
    try {
      frameVariables = vm.step(signals).variables;
    } catch (error) {
      return empty(
        'step-error',
        `frame ${frame}: ${(error as Error).message.slice(0, 200)}`,
      );
    }
    if (columns === null || states === null) {
      columns = Object.keys(frameVariables)
        .filter((key) => typeof frameVariables[key] === 'number')
        .sort();
      states = new Float32Array(inputs.length * columns.length);
    }
    const rowOffset = frame * columns.length;
    for (let column = 0; column < columns.length; column += 1) {
      const name = columns[column] as string;
      const value = frameVariables[name];
      const numeric = typeof value === 'number' ? value : 0;
      if (!Number.isFinite(numeric)) {
        return empty('nan', `frame ${frame}: ${name}=${numeric}`);
      }
      states[rowOffset + column] = numeric;
      // Compare as stored: the previous row is float32, and a value such as
      // decay=0.98 never equals its own float64 original.
      if (
        frame > 0 &&
        states[rowOffset - columns.length + column] !== Math.fround(numeric)
      ) {
        moved = true;
      }
    }
  }
  return {
    status: moved ? 'ok' : 'static',
    states: states ?? new Float32Array(0),
    columns: columns ?? [],
  };
}

/** Packs a scenario's inputs as uint8 [frames, 256]: spectrum then waveform. */
export function packInputs(inputs: readonly FrameInputs[]): Uint8Array {
  const width = PRESET_LAB_SPECTRUM_BINS * 2;
  const packed = new Uint8Array(inputs.length * width);
  inputs.forEach((input, frame) => {
    packed.set(input.frequencyData, frame * width);
    packed.set(input.waveformData, frame * width + PRESET_LAB_SPECTRUM_BINS);
  });
  return packed;
}

/** Replays the signal tracker over `inputs` and returns [frames, SIGNAL_COLUMNS]. */
export function computeSignals(inputs: readonly FrameInputs[]): Float32Array {
  const tracker = createMilkdropSignalTracker();
  const frequencyData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const waveformData = new Uint8Array(PRESET_LAB_SPECTRUM_BINS);
  const out = new Float32Array(inputs.length * SIGNAL_COLUMNS.length);
  inputs.forEach((input, frame) => {
    frequencyData.set(input.frequencyData);
    waveformData.set(input.waveformData);
    const signals = tracker.update({
      time: input.time,
      deltaMs: input.deltaMs,
      analyser: null,
      frequencyData,
      waveformData,
    }) as unknown as Record<keyof MilkdropRuntimeSignals, unknown>;
    SIGNAL_COLUMNS.forEach((name, column) => {
      const value = signals[name as keyof MilkdropRuntimeSignals];
      out[frame * SIGNAL_COLUMNS.length + column] =
        typeof value === 'number' && Number.isFinite(value) ? value : 0;
    });
  });
  return out;
}

type CliOptions = {
  out: string;
  frames: number;
  scenarios: PresetLabScenario[];
  only: string[];
  limit: number | null;
  variables: 'canonical' | 'all';
  fractions: SplitFractions;
  seed: string;
  shard: { index: number; count: number } | null;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    out: DEFAULT_OUT,
    frames: DEFAULT_FRAMES,
    scenarios: [...PRESET_LAB_SCENARIOS],
    only: [],
    limit: null,
    variables: 'canonical',
    fractions: { val: 0.1, test: 0.1 },
    seed: 'stims',
    shard: null,
  };
  const valueAfter = (index: number, flag: string) => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} needs a value`);
    }
    return value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--out':
        options.out = valueAfter(index++, arg);
        break;
      case '--frames':
        options.frames = Number(valueAfter(index++, arg));
        break;
      case '--scenarios':
        options.scenarios = valueAfter(index++, arg).split(
          ',',
        ) as PresetLabScenario[];
        break;
      case '--limit':
        options.limit = Number(valueAfter(index++, arg));
        break;
      case '--vars': {
        const value = valueAfter(index++, arg);
        if (value !== 'canonical' && value !== 'all') {
          throw new Error('--vars takes canonical or all');
        }
        options.variables = value;
        break;
      }
      case '--val':
        options.fractions.val = Number(valueAfter(index++, arg));
        break;
      case '--test':
        options.fractions.test = Number(valueAfter(index++, arg));
        break;
      case '--seed':
        options.seed = valueAfter(index++, arg);
        break;
      case '--shard': {
        const match = /^(\d+)\/(\d+)$/.exec(valueAfter(index++, arg));
        const shardIndex = Number(match?.[1]);
        const count = Number(match?.[2]);
        if (!match || count < 1 || shardIndex >= count) {
          throw new Error('--shard takes k/n with 0 <= k < n, e.g. 0/4');
        }
        options.shard = { index: shardIndex, count };
        break;
      }
      case '--only':
        while (argv[index + 1] && !argv[index + 1]?.startsWith('--')) {
          options.only.push(argv[++index] as string);
        }
        break;
      default:
        throw new Error(`Unknown flag ${arg}`);
    }
  }
  if (!Number.isInteger(options.frames) || options.frames < 2) {
    throw new Error('--frames must be an integer >= 2');
  }
  const known = new Set<string>([...PRESET_LAB_SCENARIOS, 'sweep']);
  for (const scenario of options.scenarios) {
    if (!known.has(scenario)) {
      throw new Error(
        `Unknown scenario "${scenario}" (known: ${[...known].join(', ')})`,
      );
    }
  }
  const { val, test } = options.fractions;
  if (!(val >= 0 && test >= 0 && val + test < 1)) {
    throw new Error('--val and --test must be >= 0 and sum to less than 1');
  }
  return options;
}

function safeFileStem(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const catalog = [...loadCatalogEntries(repoRoot).values()].map((entry) => ({
    ...entry,
    title: entry.title ?? entry.id,
  }));
  // Splits are computed over the whole catalog so a subset run assigns each
  // preset the same split a full run would.
  const splits = assignFamilySplits(catalog, options.fractions, options.seed);
  let selected = options.only.length
    ? catalog.filter((row) => options.only.includes(row.id))
    : catalog;
  if (options.only.length && selected.length !== options.only.length) {
    const found = new Set(selected.map((row) => row.id));
    const missing = options.only.filter((id) => !found.has(id));
    throw new Error(`Unknown preset id(s): ${missing.join(', ')}`);
  }
  if (options.limit !== null) {
    selected = selected.slice(0, options.limit);
  }
  const { shard } = options;
  if (shard) {
    selected = selected.filter(
      (_, position) => position % shard.count === shard.index,
    );
  }
  const suffix = shard ? `-${shard.index}-of-${shard.count}` : '';

  const outRoot = path.resolve(options.out);
  for (const dir of ['inputs', 'signals', 'states']) {
    fs.mkdirSync(path.join(outRoot, dir), { recursive: true });
  }

  const variables =
    options.variables === 'all' ? ('all' as const) : CANONICAL_VARIABLES;
  const inputsByScenario = new Map<PresetLabScenario, FrameInputs[]>();
  for (const scenario of options.scenarios) {
    const inputs = buildScenarioInputs(scenario, options.frames);
    inputsByScenario.set(scenario, inputs);
    fs.writeFileSync(
      path.join(outRoot, 'inputs', `${scenario}.npy`),
      encodeNpy(packInputs(inputs), [
        options.frames,
        PRESET_LAB_SPECTRUM_BINS * 2,
      ]),
    );
    fs.writeFileSync(
      path.join(outRoot, 'signals', `${scenario}.npy`),
      encodeNpy(computeSignals(inputs), [
        options.frames,
        SIGNAL_COLUMNS.length,
      ]),
    );
  }

  const indexLines: string[] = [];
  const statusCounts: Record<string, number> = {};
  const splitCounts: Record<DatasetSplit, number> = {
    train: 0,
    val: 0,
    test: 0,
  };
  const started = performance.now();
  selected.forEach((row, position) => {
    const raw = fs.readFileSync(
      path.join(repoRoot, 'public', row.file.replace(/^\//, '')),
      'latin1',
    );
    const assignment = splits.get(row.id) as {
      family: string;
      split: DatasetSplit;
    };
    splitCounts[assignment.split] += 1;
    for (const scenario of options.scenarios) {
      const run = runPresetForDataset(
        raw,
        row.id,
        inputsByScenario.get(scenario) as FrameInputs[],
        variables,
      );
      statusCounts[run.status] = (statusCounts[run.status] ?? 0) + 1;
      let file: string | null = null;
      if (run.states) {
        file = `states/${safeFileStem(row.id)}__${scenario}.npy`;
        fs.writeFileSync(
          path.join(outRoot, file),
          encodeNpy(run.states, [options.frames, run.columns.length]),
        );
      }
      indexLines.push(
        JSON.stringify({
          presetId: row.id,
          title: row.title,
          author: row.author ?? null,
          family: assignment.family,
          split: assignment.split,
          scenario,
          status: run.status,
          file,
          ...(options.variables === 'all' && run.states
            ? { columns: run.columns }
            : {}),
          ...(run.detail ? { detail: run.detail } : {}),
        }),
      );
    }
    if ((position + 1) % 100 === 0) {
      const elapsed = ((performance.now() - started) / 1000).toFixed(0);
      console.log(`  ${position + 1}/${selected.length} presets (${elapsed}s)`);
    }
  });

  fs.writeFileSync(
    path.join(outRoot, `index${suffix}.jsonl`),
    `${indexLines.join('\n')}\n`,
  );
  const manifest = {
    version: DATASET_VERSION,
    createdAt: new Date().toISOString(),
    fps: FPS,
    frames: options.frames,
    scenarios: options.scenarios,
    presets: selected.length,
    shard,
    splitSeed: options.seed,
    splitFractions: options.fractions,
    splitCounts,
    statusCounts,
    inputs: {
      dtype: 'uint8',
      shape: [options.frames, PRESET_LAB_SPECTRUM_BINS * 2],
      columns: `spectrum[0..${PRESET_LAB_SPECTRUM_BINS - 1}], waveform[0..${PRESET_LAB_SPECTRUM_BINS - 1}]`,
    },
    signals: { dtype: 'float32', columns: SIGNAL_COLUMNS },
    states: {
      dtype: 'float32',
      columns:
        options.variables === 'all'
          ? 'per index row (--vars all)'
          : CANONICAL_VARIABLES,
    },
  };
  fs.writeFileSync(
    path.join(outRoot, `manifest${suffix}.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `Wrote ${indexLines.length} rows for ${selected.length} presets to ${outRoot}`,
  );
  console.log(`  status: ${JSON.stringify(statusCounts)}`);
  console.log(`  split:  ${JSON.stringify(splitCounts)}`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
