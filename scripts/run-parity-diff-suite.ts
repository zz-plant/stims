import fs from 'node:fs';
import path from 'node:path';
import {
  computeParityDiffMetrics,
  loadImagePixels,
  writeDiffImage,
} from './diff-parity-artifacts.ts';
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
};

type SuitePresetResult = {
  presetId: string;
  title: string;
  status: 'pass' | 'fail' | 'missing-stims-capture' | 'error';
  mismatchRatio: number | null;
  reportPath: string | null;
  diffImagePath: string | null;
  stimsArtifactId: string | null;
  projectmImagePath: string;
  error?: string;
};

type SuiteSummary = {
  version: 1;
  generatedAt: string;
  outputDir: string;
  suiteDir: string;
  certifiedPresetCount: number;
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

function suiteResultRank(result: SuitePresetResult) {
  switch (result.status) {
    case 'fail':
      return 0;
    case 'error':
      return 1;
    case 'missing-stims-capture':
      return 2;
    case 'pass':
      return 3;
  }
}

function compareSuiteResults(
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
  const artifactManifest = loadParityArtifactManifest(options.outputDir);
  const suiteDir = path.join(options.outputDir, 'suite');
  fs.mkdirSync(suiteDir, { recursive: true });

  const results: SuitePresetResult[] = [];

  for (const preset of referenceManifest.presets) {
    const projectmImagePath = path.join(
      options.repoRoot,
      referenceManifest.fixtureRoot,
      preset.image,
    );
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
      });
      continue;
    }

    const stimsImagePath = resolveArtifactImagePath(
      options.outputDir,
      stimsArtifact.files.image,
    );
    if (!stimsImagePath || !fs.existsSync(stimsImagePath)) {
      results.push({
        presetId: preset.id,
        title: preset.title,
        status: 'error',
        mismatchRatio: null,
        reportPath: null,
        diffImagePath: null,
        stimsArtifactId: stimsArtifact.id,
        projectmImagePath,
        error: `Missing Stims image for artifact "${stimsArtifact.id}".`,
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

      const reportPath = path.join(suiteDir, `${preset.id}.json`);
      const diffImagePath = path.join(suiteDir, `${preset.id}.png`);
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
      });
    } catch (error) {
      results.push({
        presetId: preset.id,
        title: preset.title,
        status: 'error',
        mismatchRatio: null,
        reportPath: null,
        diffImagePath: null,
        stimsArtifactId: stimsArtifact.id,
        projectmImagePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  results.sort(compareSuiteResults);

  const summary: SuiteSummary = {
    version: 1,
    generatedAt: new Date().toISOString(),
    outputDir: options.outputDir,
    suiteDir,
    certifiedPresetCount: referenceManifest.presets.length,
    passCount: results.filter((result) => result.status === 'pass').length,
    failCount: results.filter((result) => result.status === 'fail').length,
    missingCount: results.filter(
      (result) => result.status === 'missing-stims-capture',
    ).length,
    errorCount: results.filter((result) => result.status === 'error').length,
    results,
  };

  const summaryPath = path.join(suiteDir, 'summary.json');
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

  if (
    options.strict &&
    (summary.failCount > 0 ||
      summary.missingCount > 0 ||
      summary.errorCount > 0)
  ) {
    throw new Error(
      `Parity suite failed with ${summary.failCount} failing, ${summary.missingCount} missing, and ${summary.errorCount} errored presets.`,
    );
  }

  return {
    summary,
    summaryPath,
  };
}

if (import.meta.main) {
  try {
    const result = await runParityDiffSuite(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    usage();
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
