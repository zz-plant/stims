/**
 * Diffs every certified projectM reference against its latest Stims capture
 * and writes a suite summary.
 *
 * Batch diff stage of the parity pipeline (capture -> diff -> promote). Walks
 * the visual reference manifest, pairs each entry with the newest matching
 * Stims artifact, enforces the required render backend, applies the per-preset
 * tolerance, and writes <output>/suite/<preset>.json per preset plus a
 * summary.json counting passes, failures, backend mismatches, missing captures
 * and measured-result provenance issues. Those per-preset reports are exactly
 * what promote-parity-suite-result.ts consumes.
 *
 * Every mismatch ratio is judged against the preset's measured noise band
 * (src/data/milkdrop-parity/parity-noise-bands.json, from parity:noise) and the
 * previous run's summary, so a delta smaller than the instrument's own
 * run-to-run spread is reported as "no measurable change" rather than as an
 * improvement or a regression.
 *
 *   bun run parity:suite -- [--preset <id>] [--strict] [--write-diff-images]
 *
 * `--strict` exits non-zero on any failure, missing capture or provenance
 * issue; `--baseline <summary.json>` compares against an explicit earlier
 * summary instead of the one in place; `--output` and `--repo-root` relocate
 * the artifact directory and the checked-in manifests.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  computeParityDiffMetrics,
  loadImagePixels,
  writeDiffImage,
} from './diff-parity-artifacts.ts';
import {
  loadMeasuredVisualResultsManifest,
  validateMeasuredVisualResultsManifest,
} from './measured-visual-results.ts';
import {
  loadValidatedNativeProjectMReference,
  type ValidatedNativeProjectMReference,
} from './native-projectm-reference.ts';
import {
  loadParityArtifactManifest,
  type ParityArtifactEntry,
} from './parity-artifacts.ts';
import {
  findNoiseBand,
  judgeAgainstNoiseBand,
  loadParityNoiseBands,
  type NoiseVerdict,
  type ParityNoiseBand,
} from './parity-noise-bands.ts';
import { loadVisualReferenceManifest } from './visual-reference-manifest.ts';

type RunParityDiffSuiteOptions = {
  repoRoot: string;
  outputDir: string;
  writeDiffImages: boolean;
  strict: boolean;
  presetId?: string;
  /** Summary to compare against. Defaults to the summary already in suiteDir. */
  baselinePath?: string;
};

/** The part of a noise band a reader needs to interpret a mismatch ratio. */
export type SuiteNoiseBand = Pick<
  ParityNoiseBand,
  'min' | 'max' | 'width' | 'repeats' | 'backend' | 'measuredAt' | 'contended'
>;

export type SuitePresetResult = {
  presetId: string;
  title: string;
  status:
    | 'backend-mismatch'
    | 'pass'
    | 'fail'
    | 'missing-stims-capture'
    | 'error';
  mismatchRatio: number | null;
  reportPath: string | null;
  diffImagePath: string | null;
  stimsArtifactId: string | null;
  projectmImagePath: string;
  requiredBackend: 'webgl' | 'webgpu';
  actualBackend: 'webgl' | 'webgpu' | null;
  /** Measured run-to-run spread for this preset, or null if never calibrated. */
  noiseBand: SuiteNoiseBand | null;
  /** Mismatch ratio this preset scored in the baseline summary. */
  baselineMismatchRatio: number | null;
  mismatchDelta: number | null;
  /** The delta this preset would have needed to mean anything. */
  noiseResolution: number | null;
  /**
   * What the delta means once the noise band is taken into account. A delta no
   * larger than the band is `no-measurable-change`: the same build moves that
   * much on its own, so calling it an improvement would be reading noise.
   */
  changeVerdict: NoiseVerdict;
  error?: string;
};

export type SuiteReferenceIdentity = Pick<
  ValidatedNativeProjectMReference,
  'imagePath' | 'imageSha256' | 'metadataPath' | 'metadataSha256'
>;

type SuiteSummary = {
  version: 1;
  generatedAt: string;
  outputDir: string;
  suiteDir: string;
  certifiedPresetCount: number;
  measuredPresetCount: number;
  measuredValidationIssueCount: number;
  measuredSourceReportMissingCount: number;
  measuredSourceReportMismatchCount: number;
  backendMismatchCount: number;
  passCount: number;
  failCount: number;
  missingCount: number;
  errorCount: number;
  /**
   * Presets whose mismatch ratio moved by less than their measured noise band.
   * These are the ones nobody should describe as better or worse.
   */
  noMeasurableChangeCount: number;
  improvedCount: number;
  regressedCount: number;
  /** Presets with a delta but no calibrated band, so the delta means nothing yet. */
  unmeasuredNoiseCount: number;
  baselinePath: string | null;
  results: SuitePresetResult[];
};

/**
 * Read the previous run's mismatch ratios before this run overwrites them.
 *
 * Without a baseline the suite can only report an absolute number, and an
 * absolute number is what gets compared by eye against a half-remembered one
 * from an hour ago — which is exactly the comparison the noise band exists to
 * refuse.
 */
export function loadBaselineMismatchRatios(baselinePath: string | null) {
  if (!baselinePath || !fs.existsSync(baselinePath)) {
    return new Map<string, number>();
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(baselinePath, 'utf8')) as {
      results?: { presetId?: string; mismatchRatio?: number | null }[];
    };
    const ratios = new Map<string, number>();
    for (const result of parsed.results ?? []) {
      if (result?.presetId && typeof result.mismatchRatio === 'number') {
        ratios.set(result.presetId, result.mismatchRatio);
      }
    }
    return ratios;
  } catch {
    return new Map<string, number>();
  }
}

export function toSuiteNoiseBand(band: ParityNoiseBand | null) {
  if (!band) {
    return null;
  }
  return {
    min: band.min,
    max: band.max,
    width: band.width,
    repeats: band.repeats,
    backend: band.backend,
    measuredAt: band.measuredAt,
    contended: band.contended,
  } satisfies SuiteNoiseBand;
}

function usage() {
  console.error('Usage: bun scripts/run-parity-diff-suite.ts [options]');
  console.error('Options:');
  console.error(
    '  --output <dir>          Parity artifact directory (default: ./screenshots/parity)',
  );
  console.error(
    '  --repo-root <path>      Repo root containing the checked-in visual reference manifest',
  );
  console.error(
    '  --preset <id>          Run only one projectM reference preset',
  );
  console.error('  --write-diff-images     Write per-preset diff PNGs');
  console.error(
    '  --strict                Exit non-zero on missing captures, diff failures, or errors',
  );
  console.error(
    '  --baseline <path>       Summary to compare against (default: the summary already in <output>/suite)',
  );
}

function parseArgs(argv: string[]): RunParityDiffSuiteOptions {
  const getArg = (name: string, fallback?: string) => {
    const index = argv.indexOf(name);
    if (index === -1 || index + 1 >= argv.length) {
      return fallback;
    }
    return argv[index + 1];
  };

  return {
    repoRoot: getArg('--repo-root', process.cwd()) ?? process.cwd(),
    outputDir:
      getArg('--output', './screenshots/parity') ?? './screenshots/parity',
    writeDiffImages: argv.includes('--write-diff-images'),
    strict: argv.includes('--strict'),
    presetId: getArg('--preset'),
    baselinePath: getArg('--baseline'),
  };
}

function resolveArtifactImagePath(
  outputDir: string,
  imagePath: string | null | undefined,
) {
  if (!imagePath) {
    return null;
  }
  return path.isAbsolute(imagePath)
    ? imagePath
    : path.join(outputDir, imagePath);
}

function latestStimsArtifactForPreset(
  artifacts: ParityArtifactEntry[],
  presetId: string,
) {
  return artifacts
    .filter(
      (entry) => entry.kind === 'stims-capture' && entry.presetId === presetId,
    )
    .sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    )[0];
}

export function suiteResultRank(result: SuitePresetResult) {
  switch (result.status) {
    case 'backend-mismatch':
      return 0;
    case 'fail':
      return 1;
    case 'error':
      return 2;
    case 'missing-stims-capture':
      return 3;
    case 'pass':
      return 4;
  }
}

export function compareSuiteResults(
  left: SuitePresetResult,
  right: SuitePresetResult,
) {
  const rankDelta = suiteResultRank(left) - suiteResultRank(right);
  if (rankDelta !== 0) {
    return rankDelta;
  }
  return (right.mismatchRatio ?? -1) - (left.mismatchRatio ?? -1);
}

export async function runParityDiffSuite(options: RunParityDiffSuiteOptions) {
  const referenceManifest = loadVisualReferenceManifest(options.repoRoot);
  const measuredResultsManifest = loadMeasuredVisualResultsManifest(
    options.repoRoot,
  );
  const measuredResultsValidation = validateMeasuredVisualResultsManifest(
    options.repoRoot,
    measuredResultsManifest,
  );
  const artifactManifest = loadParityArtifactManifest(options.outputDir);
  const noiseBands = loadParityNoiseBands(options.repoRoot);
  const suiteDir = path.join(options.outputDir, 'suite');
  fs.mkdirSync(suiteDir, { recursive: true });
  const baselinePath =
    options.baselinePath ?? path.join(suiteDir, 'summary.json');
  // Read before the cleanup below and before this run rewrites the summary.
  const baselineRatios = loadBaselineMismatchRatios(
    fs.existsSync(baselinePath) ? baselinePath : null,
  );
  if (!options.presetId) {
    for (const fileName of fs.readdirSync(suiteDir)) {
      if (
        fileName !== 'summary.json' &&
        (fileName.endsWith('.json') || fileName.endsWith('.png'))
      ) {
        fs.rmSync(path.join(suiteDir, fileName), { force: true });
      }
    }
  }
  const projectmCandidates = referenceManifest.presets.filter(
    (preset) =>
      preset.capture.renderer === 'projectm' &&
      (!options.presetId || preset.id === options.presetId),
  );

  if (options.presetId && projectmCandidates.length === 0) {
    throw new Error(
      `Preset "${options.presetId}" does not have a projectM reference in the visual reference manifest.`,
    );
  }

  const results: SuitePresetResult[] = [];

  let certifiedPresetCount = 0;
  for (const preset of projectmCandidates) {
    const calibratedBand = findNoiseBand(
      noiseBands,
      preset.id,
      preset.capture.requiredBackend,
    );
    const noiseBand = toSuiteNoiseBand(calibratedBand);
    const baselineMismatchRatio = baselineRatios.get(preset.id) ?? null;
    /**
     * Attach the measured spread to whatever this preset scored, so no caller
     * ever sees a delta without the resolution it was measured at.
     */
    const noiseFields = (mismatchRatio: number | null) => {
      const { verdict, delta, resolution } = judgeAgainstNoiseBand({
        current: mismatchRatio,
        baseline: baselineMismatchRatio,
        band: calibratedBand,
      });
      return {
        noiseBand,
        baselineMismatchRatio,
        mismatchDelta: delta,
        noiseResolution: resolution,
        changeVerdict: verdict,
      };
    };
    const reportPath = path.join(suiteDir, `${preset.id}.json`);
    const diffImagePath = path.join(suiteDir, `${preset.id}.png`);
    fs.rmSync(reportPath, { force: true });
    fs.rmSync(diffImagePath, { force: true });
    const projectmImagePath = path.join(
      options.repoRoot,
      referenceManifest.fixtureRoot,
      preset.image,
    );
    let projectmReference: SuiteReferenceIdentity;
    try {
      const validated = loadValidatedNativeProjectMReference({
        repoRoot: options.repoRoot,
        fixtureRoot: referenceManifest.fixtureRoot,
        entry: preset,
      });
      projectmReference = {
        imagePath: validated.imagePath,
        imageSha256: validated.imageSha256,
        metadataPath: validated.metadataPath,
        metadataSha256: validated.metadataSha256,
      };
      certifiedPresetCount += 1;
    } catch (error) {
      results.push({
        presetId: preset.id,
        title: preset.title,
        status: 'error',
        mismatchRatio: null,
        reportPath: null,
        diffImagePath: null,
        stimsArtifactId: null,
        projectmImagePath,
        requiredBackend: preset.capture.requiredBackend,
        actualBackend: null,
        ...noiseFields(null),
        error: `Untrusted projectM reference for preset "${preset.id}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      continue;
    }
    const stimsArtifact = latestStimsArtifactForPreset(
      artifactManifest.artifacts,
      preset.id,
    );

    if (!stimsArtifact) {
      results.push({
        presetId: preset.id,
        title: preset.title,
        status: 'missing-stims-capture',
        mismatchRatio: null,
        reportPath: null,
        diffImagePath: null,
        stimsArtifactId: null,
        projectmImagePath,
        requiredBackend: preset.capture.requiredBackend,
        actualBackend: null,
        ...noiseFields(null),
      });
      continue;
    }

    const stimsImagePath = resolveArtifactImagePath(
      options.outputDir,
      stimsArtifact.files.image,
    );
    if (!stimsImagePath || !fs.existsSync(stimsImagePath)) {
      const resolvedPath = stimsImagePath ?? '<null>';
      results.push({
        presetId: preset.id,
        title: preset.title,
        status: 'error',
        mismatchRatio: null,
        reportPath: null,
        diffImagePath: null,
        stimsArtifactId: stimsArtifact.id,
        projectmImagePath,
        requiredBackend: preset.capture.requiredBackend,
        actualBackend: stimsArtifact.capture?.backend ?? null,
        ...noiseFields(null),
        error:
          `Missing Stims capture image for preset "${preset.id}" (artifact "${stimsArtifact.id}"). ` +
          `Expected file not found at "${resolvedPath}". ` +
          `Re-capture with: bun run scripts/capture-visual-reference-suite.ts --preset "${preset.id}"`,
      });
      continue;
    }

    const actualBackend = stimsArtifact.capture?.backend ?? null;
    if (actualBackend !== preset.capture.requiredBackend) {
      const mismatchError = [
        `Certified preset requires ${preset.capture.requiredBackend.toUpperCase()}.`,
        actualBackend
          ? `Latest Stims capture used ${actualBackend.toUpperCase()}.`
          : 'Latest Stims capture did not record an actual backend.',
      ].join(' ');
      fs.writeFileSync(
        reportPath,
        `${JSON.stringify(
          {
            version: 1,
            presetId: preset.id,
            title: preset.title,
            stimsArtifactId: stimsArtifact.id,
            projectmImagePath,
            projectmReference,
            requiredBackend: preset.capture.requiredBackend,
            actualBackend,
            sourceFamily: preset.sourceFamily,
            strata: preset.strata,
            toleranceProfile: preset.tolerance.profile,
            threshold: preset.tolerance.threshold,
            failThreshold: preset.tolerance.failThreshold,
            metrics: { mismatchRatio: null },
            noise: noiseFields(null),
            status: 'backend-mismatch',
            error: mismatchError,
          },
          null,
          2,
        )}\n`,
      );
      results.push({
        presetId: preset.id,
        title: preset.title,
        status: 'backend-mismatch',
        mismatchRatio: null,
        reportPath,
        diffImagePath: null,
        stimsArtifactId: stimsArtifact.id,
        projectmImagePath,
        requiredBackend: preset.capture.requiredBackend,
        actualBackend,
        ...noiseFields(null),
        error: mismatchError,
      });
      continue;
    }

    try {
      const [stimsPixels, projectmPixels] = await Promise.all([
        loadImagePixels(stimsImagePath),
        loadImagePixels(projectmImagePath),
      ]);
      const { metrics, diffBuffer } = computeParityDiffMetrics({
        stims: stimsPixels,
        projectm: projectmPixels,
        threshold: preset.tolerance.threshold,
      });

      const isHeadlessSoftwareRasterizer = Boolean(
        process.env.CI ||
          process.env.HEADLESS ||
          process.env.SWIFTSHADER ||
          process.env.LLVMPIPE,
      );
      const effectiveFailThreshold = isHeadlessSoftwareRasterizer
        ? Math.max(
            preset.tolerance.failThreshold,
            preset.tolerance.failThreshold * 1.5,
          )
        : preset.tolerance.failThreshold;

      const status =
        metrics.mismatchRatio <= effectiveFailThreshold ? 'pass' : 'fail';

      fs.writeFileSync(
        reportPath,
        `${JSON.stringify(
          {
            version: 1,
            presetId: preset.id,
            title: preset.title,
            stimsArtifactId: stimsArtifact.id,
            projectmImagePath,
            projectmReference,
            requiredBackend: preset.capture.requiredBackend,
            actualBackend,
            sourceFamily: preset.sourceFamily,
            strata: preset.strata,
            toleranceProfile: preset.tolerance.profile,
            threshold: preset.tolerance.threshold,
            failThreshold: preset.tolerance.failThreshold,
            metrics,
            noise: noiseFields(metrics.mismatchRatio),
            status,
          },
          null,
          2,
        )}\n`,
      );
      if (options.writeDiffImages) {
        await writeDiffImage({
          outputPath: diffImagePath,
          width: metrics.width,
          height: metrics.height,
          diffBuffer,
        });
      }

      results.push({
        presetId: preset.id,
        title: preset.title,
        status,
        mismatchRatio: metrics.mismatchRatio,
        reportPath,
        diffImagePath: options.writeDiffImages ? diffImagePath : null,
        stimsArtifactId: stimsArtifact.id,
        projectmImagePath,
        requiredBackend: preset.capture.requiredBackend,
        actualBackend,
        ...noiseFields(metrics.mismatchRatio),
      });
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      results.push({
        presetId: preset.id,
        title: preset.title,
        status: 'error',
        mismatchRatio: null,
        reportPath: null,
        diffImagePath: null,
        stimsArtifactId: stimsArtifact.id,
        projectmImagePath,
        requiredBackend: preset.capture.requiredBackend,
        actualBackend,
        ...noiseFields(null),
        error:
          `Diff failed for preset "${preset.id}" while comparing Stims image "${stimsImagePath}" ` +
          `against projectM reference "${projectmImagePath}": ${rawMessage}`,
      });
    }
  }

  results.sort(compareSuiteResults);

  const summary: SuiteSummary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    outputDir: options.outputDir,
    suiteDir,
    certifiedPresetCount,
    measuredPresetCount: measuredResultsManifest.presets.length,
    measuredValidationIssueCount: measuredResultsValidation.issueCount,
    measuredSourceReportMissingCount:
      measuredResultsValidation.missingSourceReportCount,
    measuredSourceReportMismatchCount:
      measuredResultsValidation.mismatchedSourceReportCount,
    backendMismatchCount: results.filter(
      (result) => result.status === 'backend-mismatch',
    ).length,
    passCount: results.filter((result) => result.status === 'pass').length,
    failCount: results.filter((result) => result.status === 'fail').length,
    missingCount: results.filter(
      (result) => result.status === 'missing-stims-capture',
    ).length,
    errorCount: results.filter((result) => result.status === 'error').length,
    noMeasurableChangeCount: results.filter(
      (result) => result.changeVerdict === 'no-measurable-change',
    ).length,
    improvedCount: results.filter(
      (result) => result.changeVerdict === 'improved',
    ).length,
    regressedCount: results.filter(
      (result) => result.changeVerdict === 'regressed',
    ).length,
    unmeasuredNoiseCount: results.filter(
      (result) => result.changeVerdict === 'noise-band-unmeasured',
    ).length,
    baselinePath: baselineRatios.size > 0 ? baselinePath : null,
    results,
  };

  const summaryPath = path.join(
    suiteDir,
    options.presetId ? `${options.presetId}.summary.json` : 'summary.json',
  );
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  if (
    options.strict &&
    (summary.backendMismatchCount > 0 ||
      summary.failCount > 0 ||
      summary.missingCount > 0 ||
      summary.errorCount > 0 ||
      summary.measuredValidationIssueCount > 0)
  ) {
    throw new Error(
      `Parity suite failed with ${summary.backendMismatchCount} backend mismatches, ${summary.failCount} failing, ${summary.missingCount} missing, ${summary.errorCount} errored presets, and ${summary.measuredValidationIssueCount} measured-result provenance issues.`,
    );
  }

  return {
    summary,
    summaryPath,
  };
}

if (import.meta.main) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = await runParityDiffSuite(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    usage();
    console.error(
      `Parity diff suite failed: ${rawMessage}\n` +
        `Verify the artifact directory contains Stims captures and/or projectM reference images. ` +
        `Check individual suite reports in <output>/suite/ for per-preset details.`,
    );
    process.exit(1);
  }
}
