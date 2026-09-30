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
 *   bun run lab:dataset -- --audio song.wav [--audio more/] [--start 30]
 *   bun run lab:dataset -- --dtype float16 --every 2      # half the bytes, then half the rows
 *
 * --audio replaces the synthetic scenarios with real music (add --scenarios
 * to keep both). Each WAV, or each .wav in a directory, runs through the live
 * audio stack offline (scripts/audio-file-inputs.ts) from --start for
 * --frames frames and becomes a scenario named `audio-<file stem>`. Its
 * inputs carry the live analyser's shape (512 spectrum bins, 1024 waveform
 * samples) and its signals are the merged signals the visualizer would have
 * stepped with; the manifest records each scenario's shape.
 *
 * Layout written under --out:
 *   manifest.json            schema, scenarios, variable columns, split counts
 *   index.jsonl              one row per (preset, scenario): id, family, split, status, file
 *                            (index-<k>-of-<n>.jsonl and manifest-<k>-of-<n>.json with --shard)
 *   inputs/<scenario>.npy    uint8   [frames, B+W]  spectrum bins then waveform samples
 *                                                   (128+128 synthetic, 512+1024 audio files)
 *   signals/<scenario>.npy   float32 [frames, S]    the band levels the VM stepped with
 *   states/<id>__<scenario>.npy float32 [frames, V] per-frame variables (columns in the manifest,
 *                                                   or in the index row with --vars all)
 *
 * Storage: --dtype float16 writes signals and states as <f2 (inputs stay
 * uint8): half the size at ~3 significant digits. float16 tops out at
 * ±65504; larger values are clamped and counted per row (`float16Clamped`)
 * rather than silently becoming infinity. --every N keeps every Nth frame of
 * inputs, signals and states. The VM still steps every frame, so presets
 * with feedback or accumulators evolve exactly as at full rate; only
 * storage is thinned. The manifest records both.
 *
 * Splits are assigned per remix family (src/js/milkdrop/preset-lineage.ts),
 * never per preset: a remix and its parent differ by a few lines, so a random
 * per-preset split puts near-copies on both sides and inflates every score.
 *
 * Presets whose compile or VM step throws, or whose output goes non-finite,
 * are listed in the index with that status and no states file. Presets whose
 * every column stays constant are kept and marked `static`.
 *
 * Determinism: the VM seeds its RNG from the preset id, the scenarios are
 * pure functions of frame time and audio files are analysed deterministically,
 * so the same flags and files always write the same bytes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileMilkdropPresetSource } from '../src/js/milkdrop/compiler.ts';
import {
  buildPresetFamilies,
  type LineageCatalogEntry,
} from '../src/js/milkdrop/preset-lineage.ts';
import { fnv1a } from '../src/js/milkdrop/trace-capture.ts';
import type { MilkdropRuntimeSignals } from '../src/js/milkdrop/types.ts';
import { createMilkdropVM } from '../src/js/milkdrop/vm.ts';
import { buildAudioFileInputs, decodeWav } from './audio-file-inputs.ts';
import {
  PRESET_LAB_SCENARIOS,
  type PresetLabScenario,
} from './preset-lab-metrics.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';
import {
  buildScenarioInputs,
  createFrameSignalReader,
  type FrameInputs,
} from './preset-lab-replay.ts';

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
  data: Float32Array | Uint8Array | Uint16Array,
  shape: readonly number[],
  /** Overrides the dtype inferred from the array, e.g. '<f2' for float16 bits. */
  descrOverride?: string,
): Uint8Array {
  const expected = shape.reduce((product, size) => product * size, 1);
  if (expected !== data.length) {
    throw new Error(
      `encodeNpy: shape [${shape.join(', ')}] needs ${expected} values, got ${data.length}`,
    );
  }
  const descr =
    descrOverride ??
    (data instanceof Float32Array
      ? '<f4'
      : data instanceof Uint16Array
        ? '<u2'
        : '|u1');
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

/** Largest finite float16. */
const FLOAT16_MAX = 65504;

/**
 * IEEE 754 binary16 bit patterns for `values`, rounded to nearest even.
 * Finite values beyond ±65504 are clamped to it (counted in `clamped`)
 * instead of overflowing to infinity; NaN stays NaN.
 */
export function float32ToFloat16Bits(values: Float32Array): {
  bits: Uint16Array;
  clamped: number;
} {
  const bits = new Uint16Array(values.length);
  const scratch = new Float32Array(1);
  const view = new Uint32Array(scratch.buffer);
  let clamped = 0;
  for (let index = 0; index < values.length; index += 1) {
    let value = values[index] as number;
    if (Number.isFinite(value) && Math.abs(value) > FLOAT16_MAX) {
      value = Math.sign(value) * FLOAT16_MAX;
      clamped += 1;
    }
    scratch[0] = value;
    const x = view[0] as number;
    const sign = (x >>> 16) & 0x8000;
    const exponent = (x >>> 23) & 0xff;
    const mantissa = x & 0x7fffff;
    let half: number;
    if (exponent === 0xff) {
      half = sign | 0x7c00 | (mantissa ? 0x200 : 0); // Inf / NaN
    } else {
      const e = exponent - 127 + 15;
      if (e >= 0x1f) {
        half = sign | 0x7c00;
      } else if (e <= 0) {
        // Subnormal (or zero): shift the implicit-1 mantissa into place.
        if (e < -10) {
          half = sign;
        } else {
          const m = mantissa | 0x800000;
          const shift = 14 - e;
          let h = m >>> shift;
          const rest = m & ((1 << shift) - 1);
          const halfway = 1 << (shift - 1);
          if (rest > halfway || (rest === halfway && h & 1)) h += 1;
          half = sign | h;
        }
      } else {
        let h = (e << 10) | (mantissa >>> 13);
        const rest = mantissa & 0x1fff;
        // Round to nearest even; a carry correctly bumps the exponent.
        if (rest > 0x1000 || (rest === 0x1000 && h & 1)) h += 1;
        half = sign | h;
      }
    }
    bits[index] = half;
  }
  return { bits, clamped };
}

/** Rows 0, every, 2·every, … of a row-major [frames, width] array. */
export function keepEvery<T extends Float32Array | Uint8Array>(
  rows: T,
  width: number,
  every: number,
): T {
  if (every === 1) return rows;
  const frames = Math.floor(rows.length / width);
  const kept = Math.ceil(frames / every);
  const out = new (rows.constructor as new (length: number) => T)(kept * width);
  for (let row = 0; row < kept; row += 1) {
    out.set(
      rows.subarray(row * every * width, (row * every + 1) * width),
      row * width,
    );
  }
  return out;
}

export type StorageDtype = 'float32' | 'float16';

/** .npy bytes for float data in the requested dtype, plus clamp count. */
export function encodeFloats(
  values: Float32Array,
  shape: readonly number[],
  dtype: StorageDtype,
): { bytes: Uint8Array; clamped: number } {
  if (dtype === 'float32') {
    return { bytes: encodeNpy(values, shape), clamped: 0 };
  }
  const { bits, clamped } = float32ToFloat16Bits(values);
  return { bytes: encodeNpy(bits, shape, '<f2'), clamped };
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
  const readSignals = createFrameSignalReader();

  let columns: string[] | null = variables === 'all' ? null : [...variables];
  let states: Float32Array | null =
    columns === null ? null : new Float32Array(inputs.length * columns.length);
  let moved = false;

  for (let frame = 0; frame < inputs.length; frame += 1) {
    const signals = readSignals(inputs[frame] as FrameInputs);
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
      // Check the value as stored: a finite float64 beyond ±3.4e38 becomes
      // Infinity in the Float32Array.
      if (!Number.isFinite(Math.fround(numeric))) {
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

/** Spectrum bin and waveform sample counts of a scenario's inputs. */
export function inputShape(inputs: readonly FrameInputs[]): {
  spectrumBins: number;
  waveformSamples: number;
} {
  return {
    spectrumBins: inputs[0]?.frequencyData.length ?? 0,
    waveformSamples: inputs[0]?.waveformData.length ?? 0,
  };
}

/**
 * Packs a scenario's inputs as uint8 [frames, bins + samples]: spectrum then
 * waveform, at whatever size the scenario produced (see inputShape).
 */
export function packInputs(inputs: readonly FrameInputs[]): Uint8Array {
  const { spectrumBins, waveformSamples } = inputShape(inputs);
  const width = spectrumBins + waveformSamples;
  const packed = new Uint8Array(inputs.length * width);
  inputs.forEach((input, frame) => {
    if (
      input.frequencyData.length !== spectrumBins ||
      input.waveformData.length !== waveformSamples
    ) {
      throw new Error(`packInputs: frame ${frame} changes the input shape`);
    }
    packed.set(input.frequencyData, frame * width);
    packed.set(input.waveformData, frame * width + spectrumBins);
  });
  return packed;
}

/**
 * The signals the VM steps with for `inputs` (recorded ones for audio-file
 * frames, the signal tracker's for synthetic ones), as [frames, SIGNAL_COLUMNS].
 */
export function computeSignals(inputs: readonly FrameInputs[]): Float32Array {
  const readSignals = createFrameSignalReader();
  const out = new Float32Array(inputs.length * SIGNAL_COLUMNS.length);
  inputs.forEach((input, frame) => {
    const signals = readSignals(input) as unknown as Record<
      keyof MilkdropRuntimeSignals,
      unknown
    >;
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
  audio: string[];
  startSeconds: number;
  dtype: StorageDtype;
  every: number;
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
    audio: [],
    startSeconds: 0,
    dtype: 'float32',
    every: 1,
  };
  let scenariosGiven = false;
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
        scenariosGiven = true;
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
      case '--audio':
        options.audio.push(valueAfter(index++, arg));
        break;
      case '--dtype': {
        const value = valueAfter(index++, arg);
        if (value !== 'float32' && value !== 'float16') {
          throw new Error('--dtype takes float32 or float16');
        }
        options.dtype = value;
        break;
      }
      case '--every':
        options.every = Number(valueAfter(index++, arg));
        break;
      case '--start':
        options.startSeconds = Number(valueAfter(index++, arg));
        break;
      case '--only':
        while (argv[index + 1] && !argv[index + 1]?.startsWith('--')) {
          options.only.push(argv[++index] as string);
        }
        break;
      default:
        throw new Error(`Unknown flag ${arg}`);
    }
  }
  if (options.audio.length && !scenariosGiven) {
    options.scenarios = [];
  }
  if (!Number.isInteger(options.every) || options.every < 1) {
    throw new Error('--every must be an integer >= 1');
  }
  if (!(options.startSeconds >= 0)) {
    throw new Error('--start must be a number of seconds >= 0');
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

type DatasetScenario = {
  name: string;
  source: 'synthetic' | 'audio-file';
  file?: string;
  inputs: FrameInputs[];
};

/** Expands --audio arguments (files or directories) into .wav paths. */
export function resolveAudioPaths(args: readonly string[]): string[] {
  const paths: string[] = [];
  for (const arg of args) {
    const resolved = path.resolve(arg);
    if (fs.statSync(resolved).isDirectory()) {
      const wavs = fs
        .readdirSync(resolved)
        .filter((name) => /\.wav$/i.test(name))
        .sort()
        .map((name) => path.join(resolved, name));
      if (wavs.length === 0) {
        throw new Error(`No .wav files in ${arg}`);
      }
      paths.push(...wavs);
    } else {
      paths.push(resolved);
    }
  }
  return paths;
}

/**
 * Scenario name for an audio file: `audio-<stem>`, made file-safe, with a
 * numeric suffix when two files share a stem.
 */
export function audioScenarioName(file: string, taken: Set<string>): string {
  const stem = path
    .basename(file)
    .replace(/\.wav$/i, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
  let name = `audio-${stem}`;
  for (let copy = 2; taken.has(name); copy += 1) {
    name = `audio-${stem}-${copy}`;
  }
  taken.add(name);
  return name;
}

async function buildScenarios(options: CliOptions): Promise<DatasetScenario[]> {
  const scenarios: DatasetScenario[] = options.scenarios.map((name) => ({
    name,
    source: 'synthetic',
    inputs: buildScenarioInputs(name, options.frames),
  }));
  const taken = new Set(scenarios.map((scenario) => scenario.name));
  for (const file of resolveAudioPaths(options.audio)) {
    const audio = decodeWav(new Uint8Array(fs.readFileSync(file)));
    // A track shorter than --frames yields fewer frames, not trailing silence.
    const available = Math.floor(
      (Math.max(
        0,
        (audio.channels[0]?.length ?? 0) -
          options.startSeconds * audio.sampleRate,
      ) /
        audio.sampleRate) *
        FPS,
    );
    const inputs = await buildAudioFileInputs(audio, {
      fps: FPS,
      frames: Math.min(options.frames, available),
      startSeconds: options.startSeconds,
    });
    if (inputs.length < 2) {
      throw new Error(
        `${file} has no audio after --start ${options.startSeconds}s`,
      );
    }
    scenarios.push({
      name: audioScenarioName(file, taken),
      source: 'audio-file',
      file: path.basename(file),
      inputs,
    });
  }
  return scenarios;
}

function storedFrames(frames: number, every: number): number {
  return Math.ceil(frames / every);
}

function safeFileStem(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function main() {
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
  const scenarios = await buildScenarios(options);
  for (const scenario of scenarios) {
    const { spectrumBins, waveformSamples } = inputShape(scenario.inputs);
    const width = spectrumBins + waveformSamples;
    const stored = storedFrames(scenario.inputs.length, options.every);
    fs.writeFileSync(
      path.join(outRoot, 'inputs', `${scenario.name}.npy`),
      encodeNpy(keepEvery(packInputs(scenario.inputs), width, options.every), [
        stored,
        width,
      ]),
    );
    fs.writeFileSync(
      path.join(outRoot, 'signals', `${scenario.name}.npy`),
      encodeFloats(
        keepEvery(
          computeSignals(scenario.inputs),
          SIGNAL_COLUMNS.length,
          options.every,
        ),
        [stored, SIGNAL_COLUMNS.length],
        options.dtype,
      ).bytes,
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
    for (const scenario of scenarios) {
      const run = runPresetForDataset(raw, row.id, scenario.inputs, variables);
      statusCounts[run.status] = (statusCounts[run.status] ?? 0) + 1;
      let file: string | null = null;
      let clamped = 0;
      if (run.states) {
        file = `states/${safeFileStem(row.id)}__${scenario.name}.npy`;
        const encoded = encodeFloats(
          keepEvery(run.states, run.columns.length, options.every),
          [
            storedFrames(scenario.inputs.length, options.every),
            run.columns.length,
          ],
          options.dtype,
        );
        clamped = encoded.clamped;
        fs.writeFileSync(path.join(outRoot, file), encoded.bytes);
      }
      indexLines.push(
        JSON.stringify({
          presetId: row.id,
          title: row.title,
          author: row.author ?? null,
          family: assignment.family,
          split: assignment.split,
          scenario: scenario.name,
          status: run.status,
          file,
          ...(options.variables === 'all' && run.states
            ? { columns: run.columns }
            : {}),
          ...(run.detail ? { detail: run.detail } : {}),
          ...(clamped ? { float16Clamped: clamped } : {}),
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
    every: options.every,
    dtype: options.dtype,
    scenarios: scenarios.map((scenario) => ({
      name: scenario.name,
      source: scenario.source,
      ...(scenario.file ? { file: scenario.file } : {}),
      frames: scenario.inputs.length,
      storedFrames: storedFrames(scenario.inputs.length, options.every),
      ...inputShape(scenario.inputs),
    })),
    presets: selected.length,
    shard,
    splitSeed: options.seed,
    splitFractions: options.fractions,
    splitCounts,
    statusCounts,
    inputs: {
      dtype: 'uint8',
      columns:
        'spectrum bins then waveform samples; per-scenario sizes under scenarios',
    },
    signals: { dtype: options.dtype, columns: SIGNAL_COLUMNS },
    states: {
      dtype: options.dtype,
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
    await main();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
