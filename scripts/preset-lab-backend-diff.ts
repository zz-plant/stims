/**
 * Preset lab — cross-backend frame differ: renders one preset on WebGL and on
 * native WebGPU under matched deterministic conditions and reports where the
 * two backends disagree.
 *
 * The two backends are each other's oracle, so this needs no external
 * reference (unlike `parity:*`, which needs a certified projectM capture and
 * only covers a handful of presets). It exists because every rendering defect
 * fixed on 2026-08-21 — WebGPU sampling its own render targets with the rows
 * inverted, no-shader presets coming back ACES tone-mapped, branching shader
 * bodies silently approximated by a uniform-only path — was a disagreement
 * between the backends that no harness looked at. The differential harnesses
 * we already had compare VM execution tiers, not rendered frames.
 *
 * Determinism is the whole game. Every capture runs through `playToy` in agent
 * mode with audio silenced, autoplay off, quality pinned, and a fixed count of
 * simulation frames pumped after the entry transition settles — so both sides
 * render identical work rather than "whatever was on screen after N ms".
 * Presets are chaotic feedback loops, so each backend is ALSO captured twice
 * and diffed against itself: that same-backend noise floor is what every
 * cross-backend number is reported against. Captures are serial on purpose —
 * the parity suite's concurrent capture pool causes GPU contention that
 * produces black and over-bright frames.
 *
 * Beyond a raw mismatch ratio it reports the diff against the vertically and
 * horizontally FLIPPED comparison (a mirrored frame reads as one obvious
 * line), the diff after subtracting the mean signed per-channel offset (a
 * tone-mapping or colour shift likewise), and a grid breakdown saying where on
 * screen the disagreement lives.
 *
 *   bun run lab:backend-diff -- --preset <id>          # one preset
 *   bun run lab:backend-diff -- --sample 24            # corpus sweep
 *   bun run lab:backend-diff -- --sample 24 --diff-image
 *   bun run lab:backend-diff -- --preset <id> --frames 240 --keep-captures
 *
 * Expected divergences (WebGL lacks per-pixel warp lowering, for one) live in
 * `src/data/milkdrop-parity/backend-divergence-allowlist.json` with a reason
 * each, so unexplained divergence is the thing that stands out.
 *
 * WHAT IT CANNOT SEE, measured over a 24-preset sample at 120 frames:
 *
 * - Native WebGPU is roughly eight times less reproducible run-to-run than
 *   WebGL under identical conditions — median same-backend mismatch 48.9% on
 *   WebGPU against 6.0% on WebGL. The cause is in the runtime, not here:
 *   `renderer-adapter-core.ts` answers a `resetHistory` frame with
 *   `this.feedback.clearHistory?.()`, and only `SharedMilkdropFeedbackManager`
 *   (WebGL) implements it. `WebGPUMilkdropFeedbackManager` does not, so the
 *   deterministic frame pump never clears the WebGPU feedback buffer and every
 *   capture starts from whatever the wall-clock warmup left behind. Until that
 *   is implemented, any WebGPU disagreement smaller than its preset's noise
 *   floor is invisible to this harness — which for chaotic feedback presets is
 *   most of the interesting range.
 * - Anything both backends get wrong the same way. This measures agreement,
 *   not correctness; `parity:*` against a certified projectM reference is
 *   still the only thing that measures correctness.
 * - Audio-reactive behaviour. Captures run silent, because the frame pump
 *   refuses to run while audio drives the pipeline.
 * - Motion. One frame per backend per run is compared, so two backends that
 *   agree on frame 120 and diverge in how they got there read as a match.
 */

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ensureDevServer } from './dev-server.ts';
import {
  computeParityDiffMetrics,
  loadImagePixels,
  writeDiffImage,
} from './diff-parity-artifacts.ts';
import {
  closePlayToyBrowserSession,
  createPlayToyBrowserSession,
  type PlayToyBrowserSession,
  playToy,
} from './play-toy.ts';
import { loadCatalogEntries } from './preset-lab-reactivity.ts';

type Backend = 'webgl' | 'webgpu';

type ImagePixels = Awaited<ReturnType<typeof loadImagePixels>>;

type DiffMetrics = ReturnType<typeof computeParityDiffMetrics>['metrics'];

export const ALLOWLIST_PATH =
  'src/data/milkdrop-parity/backend-divergence-allowlist.json';

/**
 * Cross-backend mismatch counts as noise when it is under whichever is larger:
 * this multiple of the worse same-backend run-to-run mismatch, or the absolute
 * floor below. Feedback presets are chaotic — two runs of the SAME backend do
 * not land on identical pixels — so a fixed threshold either drowns in their
 * noise or fails every one of them.
 */
const NOISE_MULTIPLIER = 3;
const NOISE_ABSOLUTE_FLOOR = 0.005;
/** A flipped comparison has to beat the upright one by this much to be called. */
const FLIP_ADVANTAGE = 0.25;
/**
 * Subtracting a constant per-channel offset has to remove this share of the
 * mismatch before the divergence is called a colour shift rather than
 * structural.
 */
const OFFSET_ADVANTAGE = 0.5;
/** Standard deviation under which a capture is treated as a blank frame. */
const BLANK_STDDEV = 0.75;
/** `playToy` reports a refused blank capture through its error string. */
const BLANK_CAPTURE_PATTERN = /blank|unable to capture the active toy canvas/i;
const GRID_ROWS = 3;
const GRID_COLS = 3;

const DEFAULTS = {
  frames: 180,
  width: 640,
  height: 360,
  port: 5406,
  threshold: 16,
  qualityStep: 0,
  sample: 0,
  seed: 0,
  /**
   * Pins the page's `Math.random`, which MilkDrop's per-preset random
   * constants are drawn from. Any fixed value works; it only has to be the
   * same on both sides of every comparison.
   */
  randomSeed: 1,
};

export type BackendDiffAllowlist = {
  notes?: string;
  presets?: Record<string, { reason: string; maxMismatchRatio?: number }>;
  patterns?: Array<{
    test: string;
    reason: string;
    maxMismatchRatio?: number;
  }>;
};

export type AllowlistMatch = { reason: string; maxMismatchRatio: number };

export function loadBackendDivergenceAllowlist(
  repoRoot: string,
): BackendDiffAllowlist {
  const file = path.join(repoRoot, ALLOWLIST_PATH);
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8')) as BackendDiffAllowlist;
}

export function matchAllowlist(
  allowlist: BackendDiffAllowlist,
  presetId: string,
): AllowlistMatch | null {
  const direct = allowlist.presets?.[presetId];
  if (direct) {
    return {
      reason: direct.reason,
      maxMismatchRatio: direct.maxMismatchRatio ?? 1,
    };
  }
  for (const pattern of allowlist.patterns ?? []) {
    if (new RegExp(pattern.test).test(presetId)) {
      return {
        reason: pattern.reason,
        maxMismatchRatio: pattern.maxMismatchRatio ?? 1,
      };
    }
  }
  return null;
}

/**
 * Even-stride sample across the sorted corpus rather than a random draw, so a
 * `--sample n --seed s` pair names the same presets on every machine and the
 * sample spreads across libraries instead of clustering on one prefix.
 */
export function samplePresetIds(
  ids: string[],
  count: number,
  seed: number,
): string[] {
  const sorted = [...ids].sort();
  if (count <= 0 || count >= sorted.length) return sorted;
  const stride = sorted.length / count;
  const picked: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const position =
      Math.floor(index * stride + (seed % Math.max(1, Math.floor(stride)))) %
      sorted.length;
    picked.push(sorted[position]);
  }
  return [...new Set(picked)];
}

export function flipPixels(
  pixels: ImagePixels,
  axis: 'vertical' | 'horizontal',
): ImagePixels {
  const { width, height } = pixels;
  const out = new Uint8Array(pixels.data.length);
  for (let y = 0; y < height; y += 1) {
    const sourceY = axis === 'vertical' ? height - 1 - y : y;
    for (let x = 0; x < width; x += 1) {
      const sourceX = axis === 'horizontal' ? width - 1 - x : x;
      const to = (y * width + x) * 4;
      const from = (sourceY * width + sourceX) * 4;
      out[to] = pixels.data[from];
      out[to + 1] = pixels.data[from + 1];
      out[to + 2] = pixels.data[from + 2];
      out[to + 3] = pixels.data[from + 3];
    }
  }
  return { ...pixels, data: out };
}

/** Mean signed per-channel delta (a - b), in 0..255 units. */
export function signedChannelOffsets(
  a: ImagePixels,
  b: ImagePixels,
): [number, number, number] {
  const totalPixels = a.width * a.height;
  let r = 0;
  let g = 0;
  let bl = 0;
  for (let index = 0; index < totalPixels; index += 1) {
    const offset = index * 4;
    r += a.data[offset] - b.data[offset];
    g += a.data[offset + 1] - b.data[offset + 1];
    bl += a.data[offset + 2] - b.data[offset + 2];
  }
  return [r / totalPixels, g / totalPixels, bl / totalPixels];
}

export function shiftPixels(
  pixels: ImagePixels,
  offsets: [number, number, number],
): ImagePixels {
  const out = new Uint8Array(pixels.data.length);
  const totalPixels = pixels.width * pixels.height;
  for (let index = 0; index < totalPixels; index += 1) {
    const offset = index * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      out[offset + channel] = Math.max(
        0,
        Math.min(
          255,
          Math.round(pixels.data[offset + channel] - offsets[channel]),
        ),
      );
    }
    out[offset + 3] = pixels.data[offset + 3];
  }
  return { ...pixels, data: out };
}

export type GridCell = { row: number; col: number; mismatchRatio: number };

export function gridMismatch(
  a: ImagePixels,
  b: ImagePixels,
  threshold: number,
): GridCell[] {
  const cells: GridCell[] = [];
  const cellWidth = Math.floor(a.width / GRID_COLS);
  const cellHeight = Math.floor(a.height / GRID_ROWS);
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const x0 = col * cellWidth;
      const y0 = row * cellHeight;
      const x1 = col === GRID_COLS - 1 ? a.width : x0 + cellWidth;
      const y1 = row === GRID_ROWS - 1 ? a.height : y0 + cellHeight;
      let mismatched = 0;
      let total = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * a.width + x) * 4;
          const delta = Math.max(
            Math.abs(a.data[offset] - b.data[offset]),
            Math.abs(a.data[offset + 1] - b.data[offset + 1]),
            Math.abs(a.data[offset + 2] - b.data[offset + 2]),
          );
          total += 1;
          if (delta > threshold) mismatched += 1;
        }
      }
      cells.push({
        row,
        col,
        mismatchRatio: total === 0 ? 0 : mismatched / total,
      });
    }
  }
  return cells;
}

export function noiseCeiling(noiseFloor: number): number {
  return Math.max(noiseFloor * NOISE_MULTIPLIER, NOISE_ABSOLUTE_FLOOR);
}

export type PresetDiagnosis =
  | 'blank-on-webgl'
  | 'blank-on-webgpu'
  | 'within-noise'
  | 'mirrored-vertical'
  | 'mirrored-horizontal'
  | 'uniform-colour-offset'
  | 'structural';

export function diagnose({
  cross,
  flipVertical,
  flipHorizontal,
  offsetCorrected,
  noiseFloor,
}: {
  cross: number;
  flipVertical: number;
  flipHorizontal: number;
  offsetCorrected: number;
  noiseFloor: number;
}): PresetDiagnosis {
  if (cross <= noiseCeiling(noiseFloor)) return 'within-noise';
  if (flipVertical < cross * FLIP_ADVANTAGE) return 'mirrored-vertical';
  if (flipHorizontal < cross * FLIP_ADVANTAGE) return 'mirrored-horizontal';
  if (offsetCorrected < cross * OFFSET_ADVANTAGE)
    return 'uniform-colour-offset';
  return 'structural';
}

type CaptureRecord = {
  backend: Backend;
  run: number;
  /** Null when the backend rendered nothing and no frame was written. */
  path: string | null;
  stddev: number;
  blank: boolean;
};

type PresetReport = {
  presetId: string;
  title?: string;
  status: 'match' | 'expected' | 'suspect' | 'error';
  diagnosis?: PresetDiagnosis;
  error?: string;
  expectedReason?: string;
  frames: number;
  noise: Partial<Record<Backend, number>>;
  noiseFloor?: number;
  noiseCeiling?: number;
  cross?: DiffMetrics;
  crossFlipVertical?: number;
  crossFlipHorizontal?: number;
  crossOffsetCorrected?: number;
  channelOffsets?: [number, number, number];
  signalOverNoise?: number;
  worstRegions?: Array<{ cell: string; mismatchRatio: number }>;
  diffImage?: string;
  captures?: CaptureRecord[];
};

async function captureStddev(file: string): Promise<number> {
  const stats = await sharp(file).stats();
  return Math.max(...stats.channels.slice(0, 3).map((c) => c.stdev));
}

type CaptureOptions = {
  presetId: string;
  backend: Backend;
  run: number;
  port: number;
  frames: number;
  width: number;
  height: number;
  qualityStep: number;
  randomSeed: number;
  outputDir: string;
  session: PlayToyBrowserSession;
};

async function capture({
  presetId,
  backend,
  run,
  port,
  frames,
  width,
  height,
  qualityStep,
  randomSeed,
  outputDir,
  session,
}: CaptureOptions): Promise<CaptureRecord> {
  const result = await playToy({
    slug: 'milkdrop',
    presetId,
    port,
    // Silence is what makes the two sides comparable: demo audio is a real
    // media element whose position depends on wall clock, and the frame pump
    // refuses to run while audio drives the pipeline.
    audioMode: 'none',
    deterministicFrames: frames,
    lockedQualityStep: qualityStep,
    viewportWidth: width,
    viewportHeight: height,
    screenshot: true,
    screenshotSurface: 'canvas',
    outputDir,
    headless: true,
    rendererProfile: backend === 'webgpu' ? 'webgpu' : 'compatibility',
    // Removes one identified source of run-to-run difference: MilkDrop draws
    // its per-preset random constants from `Math.random` at preset load and
    // feeds them straight into the shaders. Measured, it is not the dominant
    // one — see the docblock — but a comparison should not carry a source it
    // can cheaply remove.
    randomSeed: randomSeed,
    recordParityArtifact: false,
    browserSession: session,
  });
  if (!result.success || !result.screenshot) {
    const message = result.error ?? 'no screenshot';
    // `playToy` refuses to write a flat frame as evidence, so a preset that
    // renders NOTHING on one backend arrives here as a failure. That is the
    // loudest disagreement there is, not a harness error, so it is reported
    // rather than thrown.
    if (BLANK_CAPTURE_PATTERN.test(message)) {
      return { backend, run, path: null, stddev: 0, blank: true };
    }
    throw new Error(`${backend} run ${run} failed for ${presetId}: ${message}`);
  }
  if (result.fallbackOccurred && backend === 'webgpu') {
    throw new Error(
      `${presetId} fell back to WebGL while capturing WebGPU — the comparison would be a backend against itself.`,
    );
  }
  const stddev = await captureStddev(result.screenshot);
  return {
    backend,
    run,
    path: result.screenshot,
    stddev,
    blank: stddev < BLANK_STDDEV,
  };
}

/**
 * Two runs per backend, plus one retry each for a blank frame. A capture that
 * comes back blank ONCE can be a mid-resize race; one that comes back blank
 * every time is the backend saying it rendered nothing.
 */
async function captureBackendRuns(
  options: Omit<CaptureOptions, 'run'>,
): Promise<CaptureRecord[]> {
  const records: CaptureRecord[] = [];
  for (let run = 0; run < 2; run += 1) {
    let record = await capture({ ...options, run });
    if (record.blank) {
      record = await capture({ ...options, run });
    }
    records.push(record);
  }
  return records;
}

async function diffFiles(
  a: ImagePixels,
  b: ImagePixels,
  threshold: number,
): Promise<{ metrics: DiffMetrics; diffBuffer: Uint8ClampedArray }> {
  return computeParityDiffMetrics({ stims: a, projectm: b, threshold });
}

async function analysePreset({
  presetId,
  title,
  options,
  sessions,
  allowlist,
}: {
  presetId: string;
  title?: string;
  options: ReturnType<typeof parseArgs>;
  sessions: Record<Backend, PlayToyBrowserSession>;
  allowlist: BackendDiffAllowlist;
}): Promise<PresetReport> {
  const report: PresetReport = {
    presetId,
    title,
    status: 'error',
    frames: options.frames,
    noise: {},
  };
  const captures: CaptureRecord[] = [];
  try {
    // Serial, and WebGPU first: it is the fast side, so a preset that cannot
    // render at all fails before the slow software-WebGL runs are spent on it.
    for (const backend of ['webgpu', 'webgl'] as Backend[]) {
      captures.push(
        ...(await captureBackendRuns({
          presetId,
          backend,
          port: options.port,
          frames: options.frames,
          width: options.width,
          height: options.height,
          qualityStep: options.qualityStep,
          randomSeed: options.randomSeed,
          outputDir: options.captureDir,
          session: sessions[backend],
        })),
      );
    }
    report.captures = captures;

    const byBackend = (backend: Backend) =>
      captures.filter((entry) => entry.backend === backend);
    const blankBackends = (['webgl', 'webgpu'] as Backend[]).filter((backend) =>
      byBackend(backend).every((entry) => entry.blank),
    );

    if (blankBackends.length === 2) {
      report.error =
        'both backends rendered a blank frame — nothing to compare (preset or harness problem, not a disagreement).';
      return report;
    }
    if (blankBackends.length === 1) {
      // One backend painting nothing while the other paints a picture is the
      // single largest disagreement the harness can find, so it is a suspect
      // with a named diagnosis rather than a skipped run.
      const blank = blankBackends[0];
      report.diagnosis =
        blank === 'webgl' ? 'blank-on-webgl' : 'blank-on-webgpu';
      const allowed = matchAllowlist(allowlist, presetId);
      report.status = allowed ? 'expected' : 'suspect';
      report.expectedReason = allowed?.reason;
      report.error = `${blank} rendered nothing across both runs while ${
        blank === 'webgl' ? 'webgpu' : 'webgl'
      } rendered a picture.`;
      return report;
    }
    if (captures.some((entry) => entry.blank)) {
      report.error =
        'a capture came back blank on only one of two runs — too flaky to compare; re-run this preset alone.';
      return report;
    }

    const pixels = new Map<string, ImagePixels>();
    for (const entry of captures) {
      if (!entry.path) continue;
      pixels.set(
        `${entry.backend}:${entry.run}`,
        await loadImagePixels(entry.path),
      );
    }

    const requirePixels = (key: string) => {
      const found = pixels.get(key);
      if (!found) throw new Error(`missing capture ${key} for ${presetId}`);
      return found;
    };

    for (const backend of ['webgl', 'webgpu'] as Backend[]) {
      const { metrics } = await diffFiles(
        requirePixels(`${backend}:0`),
        requirePixels(`${backend}:1`),
        options.threshold,
      );
      report.noise[backend] = metrics.mismatchRatio;
    }

    const noiseFloor = Math.max(
      report.noise.webgl ?? 0,
      report.noise.webgpu ?? 0,
    );
    report.noiseFloor = noiseFloor;
    report.noiseCeiling = noiseCeiling(noiseFloor);

    const left = requirePixels('webgl:0');
    const right = requirePixels('webgpu:0');
    if (left.width !== right.width || left.height !== right.height) {
      report.error = `capture sizes differ: webgl ${left.width}x${left.height}, webgpu ${right.width}x${right.height}`;
      return report;
    }

    const { metrics: cross, diffBuffer } = await diffFiles(
      left,
      right,
      options.threshold,
    );
    report.cross = cross;
    report.crossFlipVertical = (
      await diffFiles(left, flipPixels(right, 'vertical'), options.threshold)
    ).metrics.mismatchRatio;
    report.crossFlipHorizontal = (
      await diffFiles(left, flipPixels(right, 'horizontal'), options.threshold)
    ).metrics.mismatchRatio;

    const offsets = signedChannelOffsets(left, right);
    report.channelOffsets = offsets.map((value) =>
      Number(value.toFixed(2)),
    ) as [number, number, number];
    report.crossOffsetCorrected = (
      await diffFiles(shiftPixels(left, offsets), right, options.threshold)
    ).metrics.mismatchRatio;

    report.signalOverNoise =
      cross.mismatchRatio / Math.max(noiseFloor, NOISE_ABSOLUTE_FLOOR);
    report.worstRegions = gridMismatch(left, right, options.threshold)
      .sort((a, b) => b.mismatchRatio - a.mismatchRatio)
      .slice(0, 3)
      .map((cell) => ({
        cell: `r${cell.row}c${cell.col}`,
        mismatchRatio: cell.mismatchRatio,
      }));

    report.diagnosis = diagnose({
      cross: cross.mismatchRatio,
      flipVertical: report.crossFlipVertical,
      flipHorizontal: report.crossFlipHorizontal,
      offsetCorrected: report.crossOffsetCorrected,
      noiseFloor,
    });

    if (options.diffImage) {
      const diffPath = path.join(
        options.outputDir,
        `${presetId.replace(/[^a-z0-9-]+/gi, '_')}.diff.png`,
      );
      await writeDiffImage({
        outputPath: diffPath,
        width: cross.width,
        height: cross.height,
        diffBuffer,
      });
      report.diffImage = diffPath;
    }

    if (report.diagnosis === 'within-noise') {
      report.status = 'match';
      return report;
    }
    const allowed = matchAllowlist(allowlist, presetId);
    if (allowed && cross.mismatchRatio <= allowed.maxMismatchRatio) {
      report.status = 'expected';
      report.expectedReason = allowed.reason;
      return report;
    }
    report.status = 'suspect';
    return report;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    report.captures = captures;
    return report;
  } finally {
    if (!options.keepCaptures) {
      for (const entry of captures) {
        if (entry.path) fs.rmSync(entry.path, { force: true });
      }
    }
  }
}

function parseArgs(argv: string[] = process.argv.slice(2)) {
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  const numeric = (name: string, fallback: number) => {
    const raw = value(name);
    const parsed = Number(raw);
    return raw !== undefined && Number.isFinite(parsed) ? parsed : fallback;
  };
  const presets: string[] = [];
  argv.forEach((token, index) => {
    if (token === '--preset' && argv[index + 1]) presets.push(argv[index + 1]);
  });
  const outputDir = value('output') ?? './screenshots/backend-diff';
  return {
    presets,
    sample: numeric('sample', DEFAULTS.sample),
    seed: numeric('seed', DEFAULTS.seed),
    frames: numeric('frames', DEFAULTS.frames),
    width: numeric('width', DEFAULTS.width),
    height: numeric('height', DEFAULTS.height),
    port: numeric('port', DEFAULTS.port),
    threshold: numeric('threshold', DEFAULTS.threshold),
    qualityStep: numeric('quality-step', DEFAULTS.qualityStep),
    randomSeed: numeric('random-seed', DEFAULTS.randomSeed),
    failThreshold: numeric('fail-on-suspects', Number.POSITIVE_INFINITY),
    outputDir,
    captureDir: path.join(outputDir, 'captures'),
    diffImage: flag('diff-image'),
    keepCaptures: flag('keep-captures'),
    json: flag('json'),
  };
}

function formatPercent(value: number | undefined): string {
  return value === undefined ? '—' : `${(value * 100).toFixed(2)}%`;
}

function printSummary(reports: PresetReport[]) {
  // A backend that rendered nothing has no mismatch ratio but is the worst
  // possible result, so it sorts above every measured one.
  const rank = (report: PresetReport) =>
    report.cross?.mismatchRatio ?? (report.status === 'error' ? -1 : 2);
  const ranked = [...reports].sort((a, b) => rank(b) - rank(a));
  console.log('\n=== lab:backend-diff — WebGL vs native WebGPU ===');
  console.log(
    'preset'.padEnd(42),
    'cross'.padStart(8),
    'noise'.padStart(8),
    'x-noise'.padStart(8),
    'flipV'.padStart(8),
    'status/diagnosis',
  );
  for (const report of ranked) {
    if (report.status === 'error') {
      console.log(
        report.presetId.slice(0, 40).padEnd(42),
        'ERROR'.padStart(8),
        ''.padStart(8),
        ''.padStart(8),
        ''.padStart(8),
        report.error,
      );
      continue;
    }
    console.log(
      report.presetId.slice(0, 40).padEnd(42),
      formatPercent(report.cross?.mismatchRatio).padStart(8),
      formatPercent(report.noiseFloor).padStart(8),
      (report.signalOverNoise?.toFixed(1) ?? '—').padStart(8),
      formatPercent(report.crossFlipVertical).padStart(8),
      `${report.status}${report.diagnosis ? `/${report.diagnosis}` : ''}${
        report.expectedReason ? ` (${report.expectedReason})` : ''
      }`,
    );
  }
  const counts = reports.reduce<Record<string, number>>((acc, report) => {
    acc[report.status] = (acc[report.status] ?? 0) + 1;
    return acc;
  }, {});
  const noiseFloors = reports
    .map((report) => report.noiseFloor)
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b);
  console.log(
    `\n${reports.length} presets — ` +
      Object.entries(counts)
        .map(([status, count]) => `${count} ${status}`)
        .join(', '),
  );
  if (noiseFloors.length > 0) {
    console.log(
      `same-backend noise floor: median ${formatPercent(
        noiseFloors[Math.floor(noiseFloors.length / 2)],
      )}, max ${formatPercent(noiseFloors[noiseFloors.length - 1])}`,
    );
  }
  const suspects = ranked.filter((report) => report.status === 'suspect');
  if (suspects.length > 0) {
    console.log('\nUnexplained divergence, worst first:');
    for (const report of suspects.slice(0, 15)) {
      if (!report.cross) {
        console.log(
          `  ${report.presetId} — ${report.diagnosis}: ${report.error}`,
        );
        continue;
      }
      console.log(
        `  ${report.presetId} — ${formatPercent(
          report.cross.mismatchRatio,
        )} (${report.diagnosis}, ${report.signalOverNoise?.toFixed(
          1,
        )}x noise, rmse ${report.cross.rmse.toFixed(3)}, worst cell ${
          report.worstRegions?.[0]?.cell
        } ${formatPercent(report.worstRegions?.[0]?.mismatchRatio)})`,
      );
    }
  }
}

async function main() {
  const options = parseArgs();
  const repoRoot = process.cwd();
  const allowlist = loadBackendDivergenceAllowlist(repoRoot);
  const catalog = loadCatalogEntries(repoRoot);

  let presetIds = options.presets;
  if (presetIds.length === 0) {
    presetIds = samplePresetIds(
      [...catalog.keys()],
      options.sample > 0 ? options.sample : 8,
      options.seed,
    );
  }

  fs.mkdirSync(options.outputDir, { recursive: true });
  fs.mkdirSync(options.captureDir, { recursive: true });

  const server = await ensureDevServer(options.port);
  const sessions: Record<Backend, PlayToyBrowserSession> = {
    webgl: await createPlayToyBrowserSession({
      headless: true,
      rendererProfile: 'compatibility',
    }),
    webgpu: await createPlayToyBrowserSession({
      headless: true,
      rendererProfile: 'webgpu',
    }),
  };

  const reports: PresetReport[] = [];
  try {
    for (const [index, presetId] of presetIds.entries()) {
      console.log(
        `\n[${index + 1}/${presetIds.length}] ${presetId} — 4 captures (2 per backend, serial)`,
      );
      const report = await analysePreset({
        presetId,
        title: catalog.get(presetId)?.title,
        options,
        sessions,
        allowlist,
      });
      reports.push(report);
      console.log(
        `  ${report.status}${report.diagnosis ? `/${report.diagnosis}` : ''} — cross ${formatPercent(
          report.cross?.mismatchRatio,
        )} vs noise ${formatPercent(report.noiseFloor)}${
          report.error ? ` — ${report.error}` : ''
        }`,
      );
    }
  } finally {
    await closePlayToyBrowserSession(sessions.webgl);
    await closePlayToyBrowserSession(sessions.webgpu);
    server.close();
  }

  const reportPath = path.join(options.outputDir, 'backend-diff-report.json');
  fs.writeFileSync(
    reportPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        options: {
          frames: options.frames,
          width: options.width,
          height: options.height,
          threshold: options.threshold,
          qualityStep: options.qualityStep,
          randomSeed: options.randomSeed,
          sample: options.sample,
          seed: options.seed,
        },
        reports,
      },
      null,
      2,
    )}\n`,
  );

  if (options.json) {
    console.log(JSON.stringify(reports, null, 2));
  } else {
    printSummary(reports);
  }
  console.log(`\nReport written to ${reportPath}`);

  const suspects = reports.filter((report) => report.status === 'suspect');
  if (suspects.length > options.failThreshold) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
