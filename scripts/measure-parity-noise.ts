/**
 * Measures how much a parity mismatch ratio moves run to run and records the
 * per-preset noise band.
 *
 * Calibration stage of the parity pipeline (capture -> diff -> promote). Captures
 * the same preset N times serially on its certified backend, diffs each capture
 * against the checked-in projectM reference, and reports min/median/max spread.
 * `--write` stores the band in src/data/milkdrop-parity/parity-noise-bands.json,
 * which run-parity-diff-suite.ts then uses to refuse to call a sub-noise delta
 * an improvement or a regression.
 *
 *   bun run parity:noise -- --preset <id> [--repeats 5] [--write]
 *
 * `--all` calibrates every certified preset, `--concurrency <n>` reproduces a
 * contended capture on purpose (and marks the band `contended`), `--port` and
 * `--output` relocate the dev server and the scratch artifact directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { captureVisualReferenceSuite } from './capture-visual-reference-suite.ts';
import {
  computeParityDiffMetrics,
  loadImagePixels,
} from './diff-parity-artifacts.ts';
import { loadParityArtifactManifest } from './parity-artifacts.ts';
import {
  type ParityNoiseBand,
  summarizeNoiseSamples,
  upsertParityNoiseBands,
} from './parity-noise-bands.ts';
import { loadVisualReferenceManifest } from './visual-reference-manifest.ts';

type MeasureParityNoiseOptions = {
  repoRoot: string;
  outputDir: string;
  port: number;
  repeats: number;
  presetIds: string[];
  all: boolean;
  write: boolean;
  concurrency: number;
  headless: boolean;
};

export type NoiseSample = {
  repeat: number;
  /** Null when the run produced no frame at all — see measureOneCapture. */
  mismatchRatio: number | null;
  backend: 'webgl' | 'webgpu' | null;
  imagePath: string | null;
  /** Non-null when the capture errored or produced nothing. */
  captureError: string | null;
};

function usage() {
  console.error('Usage: bun scripts/measure-parity-noise.ts [options]');
  console.error('Options:');
  console.error('  --preset <id>       Preset to calibrate (repeatable)');
  console.error('  --all               Calibrate every certified preset');
  console.error('  --repeats <n>       Captures per preset (default: 5)');
  console.error('  --write             Record the bands in the repo manifest');
  console.error(
    '  --concurrency <n>   Capture pool size (default 1; >1 measures a contended host on purpose)',
  );
  console.error('  --port <n>          Dev server port (default: 5173)');
  console.error(
    '  --output <dir>      Scratch artifact directory (default: ./screenshots/parity-noise)',
  );
}

function parseArgs(argv: string[]): MeasureParityNoiseOptions {
  const getArg = (name: string, fallback: string) => {
    const index = argv.indexOf(name);
    return index !== -1 && index + 1 < argv.length
      ? (argv[index + 1] ?? fallback)
      : fallback;
  };
  const presetIds = argv.flatMap((arg, index) =>
    arg === '--preset' && argv[index + 1] ? [argv[index + 1] as string] : [],
  );
  return {
    repoRoot: process.cwd(),
    outputDir: getArg('--output', './screenshots/parity-noise'),
    port: Number.parseInt(getArg('--port', '5173'), 10),
    repeats: Math.max(2, Number.parseInt(getArg('--repeats', '5'), 10)),
    presetIds,
    all: argv.includes('--all'),
    write: argv.includes('--write'),
    concurrency: Math.max(1, Number.parseInt(getArg('--concurrency', '1'), 10)),
    headless: !argv.includes('--no-headless'),
  };
}

async function measureOneCapture({
  options,
  presetId,
  repeat,
}: {
  options: MeasureParityNoiseOptions;
  presetId: string;
  repeat: number;
}): Promise<NoiseSample> {
  const manifest = loadVisualReferenceManifest(options.repoRoot);
  const preset = manifest.presets.find((entry) => entry.id === presetId);
  if (!preset) {
    throw new Error(`Preset "${presetId}" is not in the reference manifest.`);
  }
  const runDir = path.join(options.outputDir, `${presetId}--run-${repeat}`);
  fs.rmSync(runDir, { recursive: true, force: true });
  fs.mkdirSync(runDir, { recursive: true });

  // A capture that reported console errors still wrote a frame, and the
  // frame-to-frame spread of an erroring preset is exactly the thing a human
  // needs to see before trusting a number from it. Diff what landed and let
  // the band carry the note.
  let captureError: string | null = null;
  try {
    await captureVisualReferenceSuite({
      repoRoot: options.repoRoot,
      outputDir: runDir,
      port: options.port,
      headless: options.headless,
      vibeMode: false,
      presetIds: [presetId],
      concurrency: options.concurrency,
    });
  } catch (error) {
    captureError = error instanceof Error ? error.message : String(error);
  }

  const artifacts = loadParityArtifactManifest(runDir).artifacts.filter(
    (entry) => entry.kind === 'stims-capture' && entry.presetId === presetId,
  );
  const artifact = artifacts[artifacts.length - 1];
  if (!artifact?.files.image) {
    // A capture that produced nothing is a measurement, not a crash. Presets
    // exist that intermittently render a completely black frame — the
    // blank-frame guard refuses to record those, and aborting here threw away
    // the run instead of reporting it. eos-glowsticks-v2-03-music does this
    // often enough that its band could never be measured, while the runs that
    // did land scored 3.01/3.65/5.48% against a 5.00% fail threshold: the
    // instability straddles the verdict, which is precisely what a noise band
    // is for.
    return {
      repeat,
      mismatchRatio: null,
      backend: null,
      imagePath: null,
      captureError:
        captureError ?? `no image artifact was written in ${runDir}`,
    };
  }
  const imagePath = path.isAbsolute(artifact.files.image)
    ? artifact.files.image
    : path.join(runDir, artifact.files.image);
  const referencePath = path.join(
    options.repoRoot,
    manifest.fixtureRoot,
    preset.image,
  );
  const [stims, projectm] = await Promise.all([
    loadImagePixels(imagePath),
    loadImagePixels(referencePath),
  ]);
  const { metrics } = computeParityDiffMetrics({
    stims,
    projectm,
    threshold: preset.tolerance.threshold,
  });
  return {
    repeat,
    mismatchRatio: metrics.mismatchRatio,
    backend: artifact.capture?.backend ?? null,
    imagePath,
    captureError,
  };
}

export async function measureParityNoise(options: MeasureParityNoiseOptions) {
  const manifest = loadVisualReferenceManifest(options.repoRoot);
  const certified = manifest.presets.filter((preset) =>
    fs.existsSync(
      path.join(options.repoRoot, manifest.fixtureRoot, preset.image),
    ),
  );
  const targets = options.all
    ? certified
    : certified.filter((preset) => options.presetIds.includes(preset.id));
  if (targets.length === 0) {
    throw new Error(
      'No certified presets selected. Pass --preset <id> or --all.',
    );
  }

  const bands: ParityNoiseBand[] = [];
  for (const preset of targets) {
    const samples: NoiseSample[] = [];
    for (let repeat = 1; repeat <= options.repeats; repeat += 1) {
      const sample = await measureOneCapture({
        options,
        presetId: preset.id,
        repeat,
      });
      samples.push(sample);
      console.error(
        sample.mismatchRatio === null
          ? `[noise] ${preset.id} run ${repeat}/${options.repeats}: NO FRAME (${sample.captureError})`
          : `[noise] ${preset.id} run ${repeat}/${options.repeats}: ${(
              sample.mismatchRatio * 100
            ).toFixed(3)}% (${sample.backend ?? 'unknown backend'})`,
      );
    }
    const ratios = samples
      .map((sample) => sample.mismatchRatio)
      .filter((ratio): ratio is number => ratio !== null);
    const blankRuns = samples.length - ratios.length;
    if (ratios.length === 0) {
      throw new Error(
        `Every capture of "${preset.id}" failed to produce a frame; there is ` +
          `nothing to band. Last error: ${samples[samples.length - 1]?.captureError}`,
      );
    }
    const stats = summarizeNoiseSamples(ratios);
    bands.push({
      presetId: preset.id,
      backend: samples[0].backend ?? preset.capture.requiredBackend,
      repeats: options.repeats,
      threshold: preset.tolerance.threshold,
      warmupFrames: preset.capture.warmupFrames,
      samples: ratios,
      ...(blankRuns > 0 ? { blankRuns } : {}),
      ...stats,
      contended: options.concurrency > 1,
      measuredAt: new Date().toISOString(),
      ...(samples.some((sample) => sample.captureError)
        ? {
            note:
              blankRuns > 0
                ? `${blankRuns}/${samples.length} runs produced NO frame at all ` +
                  `(the blank-frame guard refused them); the band describes ` +
                  `only the runs that rendered something.`
                : `Capture reported console errors on ${
                    samples.filter((sample) => sample.captureError).length
                  }/${samples.length} runs; the band describes an erroring capture.`,
          }
        : {}),
    });
  }

  if (options.write) {
    const { filePath } = upsertParityNoiseBands(options.repoRoot, bands);
    console.error(`[noise] wrote ${bands.length} band(s) to ${filePath}`);
  }

  return { bands };
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    usage();
    process.exit(0);
  }
  try {
    const result = await measureParityNoise(parseArgs(argv));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    usage();
    console.error(
      `Noise measurement failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}
