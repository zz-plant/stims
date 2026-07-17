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
import { loadVisualReferenceManifest } from './visual-reference-manifest.ts';

type RunParityDiffSuiteOptions = {
  repoRoot: string;
  outputDir: string;
  writeDiffImages: boolean;
  strict: boolean;
  presetId?: string;
};

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
  results: SuitePresetResult[];
};

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
  const suiteDir = path.join(options.outputDir, 'suite');
  fs.mkdirSync(suiteDir, { recursive: true });
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

      const status =
        metrics.mismatchRatio <= preset.tolerance.failThreshold
          ? 'pass'
          : 'fail';

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
