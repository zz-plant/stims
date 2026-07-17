import fs from 'node:fs';
import path from 'node:path';
import {
  type CertificationCorpusEntry,
  type CertificationCorpusGroup,
  loadCertificationCorpusManifest,
  type WebGpuCertificationStatus,
} from './certification-corpus.ts';
import {
  computeParityDiffMetrics,
  loadImagePixels,
  writeDiffImage,
} from './diff-parity-artifacts.ts';
import { loadValidatedNativeProjectMReference } from './native-projectm-reference.ts';
import {
  buildParityArtifactStem,
  loadParityArtifactManifest,
  type ParityArtifactEntry,
} from './parity-artifacts.ts';
import {
  loadVisualReferenceManifest,
  type VisualReferenceManifest,
  type VisualReferencePresetEntry,
} from './visual-reference-manifest.ts';

export const WEBGPU_CERTIFICATION_REPORT_PATH =
  'assets/data/milkdrop-parity/webgpu-certification-report.json';

export type ComparatorDiffStatus =
  | 'unmeasured'
  | 'pass'
  | 'fail'
  | 'error'
  | 'missing-capture';

export type ComparatorDiffResult = {
  stimsArtifactId: string | null;
  capturePath: string | null;
  mismatchRatio: number | null;
  status: ComparatorDiffStatus;
  error: string | null;
};

export type ComparatorPresetResult = {
  presetId: string;
  title: string;
  corpusGroup: CertificationCorpusGroup;
  hasProjectmReference: boolean;
  projectmReferenceImage: string | null;
  failThreshold: number;
  webglDiff: ComparatorDiffResult;
  webgpuDiff: ComparatorDiffResult;
  webgpuCertificationStatus: WebGpuCertificationStatus;
};

export type WebGpuCertificationReport = {
  version: 1;
  generatedAt: string;
  parityTarget: 'webgpu-certification-comparator';
  tolerance: {
    threshold: number;
    failThreshold: number;
  };
  presetCount: number;
  certifiedBothCount: number;
  certifiedNativeCount: number;
  certifiedWebglCount: number;
  uncertifiedCount: number;
  unmeasuredCount: number;
  presets: ComparatorPresetResult[];
};

export const DEFAULT_WEBGPU_CERTIFICATION_FAIL_THRESHOLD = 0.04;

export const CERTIFICATION_GROUP_ORDER: readonly CertificationCorpusGroup[] = [
  'bundled-shipped',
  'local-custom-shape',
  'parity-corpus',
  'projectm-upstream',
];

function groupRank(group: CertificationCorpusGroup) {
  const index = CERTIFICATION_GROUP_ORDER.indexOf(group);
  return index === -1 ? CERTIFICATION_GROUP_ORDER.length : index;
}

export function comparePresetResults(
  left: ComparatorPresetResult,
  right: ComparatorPresetResult,
) {
  const groupDelta = groupRank(left.corpusGroup) - groupRank(right.corpusGroup);
  if (groupDelta !== 0) {
    return groupDelta;
  }
  return left.presetId.localeCompare(right.presetId);
}

export function createEmptyDiffResult(): ComparatorDiffResult {
  return {
    stimsArtifactId: null,
    capturePath: null,
    mismatchRatio: null,
    status: 'unmeasured',
    error: null,
  };
}

export function createMissingCaptureDiffResult(
  backend: 'webgl' | 'webgpu',
  captureCommand: string,
): ComparatorDiffResult {
  return {
    stimsArtifactId: null,
    capturePath: null,
    mismatchRatio: null,
    status: 'missing-capture',
    error: `No ${backend.toUpperCase()} capture exists. Run: ${captureCommand}`,
  };
}

export function computeWebGpuCertificationStatus({
  webglDiff,
  webgpuDiff,
  failThreshold,
}: {
  webglDiff: ComparatorDiffResult;
  webgpuDiff: ComparatorDiffResult;
  failThreshold: number;
}): WebGpuCertificationStatus {
  const webglPass =
    webglDiff.status === 'pass' &&
    webglDiff.mismatchRatio !== null &&
    webglDiff.mismatchRatio <= failThreshold;
  const webgpuPass =
    webgpuDiff.status === 'pass' &&
    webgpuDiff.mismatchRatio !== null &&
    webgpuDiff.mismatchRatio <= failThreshold;

  if (webglPass && webgpuPass) {
    return 'certified-both';
  }
  if (webgpuPass) {
    return 'certified-native';
  }
  if (webglPass) {
    return 'certified-webgl';
  }
  if (
    [webglDiff.status, webgpuDiff.status].some((status) =>
      ['pass', 'fail', 'error'].includes(status),
    )
  ) {
    return 'uncertified';
  }
  return 'unmeasured';
}

export function buildCaptureCommand(
  presetId: string,
  backend: 'webgl' | 'webgpu',
) {
  const flag = backend === 'webgl' ? '--force-webgl' : '--force-webgpu';
  return `bun run scripts/capture-visual-reference-suite.ts --preset "${presetId}" ${flag}`;
}

export function findProjectmReference(
  referenceManifest: VisualReferenceManifest,
  presetId: string,
): VisualReferencePresetEntry | null {
  return (
    referenceManifest.presets.find(
      (preset) =>
        preset.id === presetId && preset.capture.renderer === 'projectm',
    ) ?? null
  );
}

export function buildComparatorPresetResult({
  corpusEntry,
  referenceEntry,
  failThreshold,
  webglDiff,
  webgpuDiff,
}: {
  corpusEntry: CertificationCorpusEntry;
  referenceEntry: VisualReferencePresetEntry | null;
  failThreshold: number;
  webglDiff?: ComparatorDiffResult;
  webgpuDiff?: ComparatorDiffResult;
}): ComparatorPresetResult {
  const hasReference = referenceEntry !== null;
  const projectmReferenceImage = hasReference
    ? path.join(referenceEntry.image)
    : null;

  const webglCaptureCmd = buildCaptureCommand(corpusEntry.id, 'webgl');
  const webgpuCaptureCmd = buildCaptureCommand(corpusEntry.id, 'webgpu');

  const resolvedWebglDiff =
    webglDiff ??
    (hasReference
      ? createMissingCaptureDiffResult('webgl', webglCaptureCmd)
      : createEmptyDiffResult());

  const resolvedWebgpuDiff =
    webgpuDiff ??
    (hasReference
      ? createMissingCaptureDiffResult('webgpu', webgpuCaptureCmd)
      : createEmptyDiffResult());

  const certificationStatus = computeWebGpuCertificationStatus({
    webglDiff: resolvedWebglDiff,
    webgpuDiff: resolvedWebgpuDiff,
    failThreshold,
  });

  return {
    presetId: corpusEntry.id,
    title: corpusEntry.title,
    corpusGroup: corpusEntry.corpusGroup,
    hasProjectmReference: hasReference,
    projectmReferenceImage,
    failThreshold,
    webglDiff: resolvedWebglDiff,
    webgpuDiff: resolvedWebgpuDiff,
    webgpuCertificationStatus: certificationStatus,
  };
}

function artifactCreatedAtValue(entry: ParityArtifactEntry) {
  return Date.parse(entry.createdAt) || 0;
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

export async function latestStimsArtifactForBackend({
  artifacts,
  outputDir,
  presetId,
  backend,
  expectedSize,
}: {
  artifacts: readonly ParityArtifactEntry[];
  outputDir: string;
  presetId: string;
  backend: 'webgl' | 'webgpu';
  expectedSize?: { width: number; height: number };
}) {
  const candidates = artifacts
    .filter(
      (entry) =>
        entry.kind === 'stims-capture' &&
        entry.presetId === presetId &&
        entry.capture?.backend === backend,
    )
    .sort(
      (left, right) =>
        artifactCreatedAtValue(right) - artifactCreatedAtValue(left),
    );

  if (!expectedSize) {
    return candidates[0];
  }

  for (const entry of candidates) {
    const imagePath = resolveArtifactImagePath(outputDir, entry.files.image);
    if (!imagePath || !fs.existsSync(imagePath)) {
      continue;
    }
    try {
      const pixels = await loadImagePixels(imagePath);
      if (
        pixels.width === expectedSize.width &&
        pixels.height === expectedSize.height
      ) {
        return entry;
      }
    } catch {}
  }

  return undefined;
}

async function diffBackendCapture({
  artifact,
  backend,
  outputDir,
  projectmImagePath,
  presetId,
  title,
  threshold,
  failThreshold,
  writeDiffImages,
}: {
  artifact: ParityArtifactEntry | undefined;
  backend: 'webgl' | 'webgpu';
  outputDir: string;
  projectmImagePath: string;
  presetId: string;
  title: string;
  threshold: number;
  failThreshold: number;
  writeDiffImages: boolean;
}): Promise<ComparatorDiffResult> {
  if (!artifact) {
    return createMissingCaptureDiffResult(
      backend,
      buildCaptureCommand(presetId, backend),
    );
  }

  const capturePath = resolveArtifactImagePath(outputDir, artifact.files.image);
  if (!capturePath || !fs.existsSync(capturePath)) {
    return {
      stimsArtifactId: artifact.id,
      capturePath,
      mismatchRatio: null,
      status: 'error',
      error: `Missing ${backend.toUpperCase()} capture image for preset "${presetId}" at "${capturePath ?? '<null>'}".`,
    };
  }

  try {
    const [stimsPixels, projectmPixels] = await Promise.all([
      loadImagePixels(capturePath),
      loadImagePixels(projectmImagePath),
    ]);
    const { metrics, diffBuffer } = computeParityDiffMetrics({
      stims: stimsPixels,
      projectm: projectmPixels,
      threshold,
    });

    if (writeDiffImages) {
      const outputStem = buildParityArtifactStem({
        kind: 'parity-diff',
        slug: artifact.slug,
        presetId,
      });
      const diffImagePath = path.join(
        outputDir,
        `${outputStem}--${backend}.png`,
      );
      await writeDiffImage({
        outputPath: diffImagePath,
        width: metrics.width,
        height: metrics.height,
        diffBuffer,
      });
    }

    return {
      stimsArtifactId: artifact.id,
      capturePath,
      mismatchRatio: metrics.mismatchRatio,
      status: metrics.mismatchRatio <= failThreshold ? 'pass' : 'fail',
      error: null,
    };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    return {
      stimsArtifactId: artifact.id,
      capturePath,
      mismatchRatio: null,
      status: 'error',
      error: `${title} ${backend.toUpperCase()} diff failed: ${rawMessage}`,
    };
  }
}

export async function buildWebGpuCertificationReport({
  repoRoot,
  outputDir,
  failThreshold,
  writeDiffImages,
}: {
  repoRoot: string;
  outputDir: string;
  failThreshold: number;
  writeDiffImages: boolean;
}): Promise<WebGpuCertificationReport> {
  const corpus = loadCertificationCorpusManifest(repoRoot);
  const referenceManifest = loadVisualReferenceManifest(repoRoot);
  const artifactManifest = loadParityArtifactManifest(outputDir);

  const results = await Promise.all(
    corpus.presets.map(async (corpusEntry) => {
      const referenceEntry = findProjectmReference(
        referenceManifest,
        corpusEntry.id,
      );
      let trustedReferenceEntry = referenceEntry;
      let referenceError: string | null = null;
      let projectmImagePath: string | null = null;
      if (referenceEntry) {
        try {
          projectmImagePath = loadValidatedNativeProjectMReference({
            repoRoot,
            fixtureRoot: referenceManifest.fixtureRoot,
            entry: referenceEntry,
          }).imagePath;
        } catch (error) {
          trustedReferenceEntry = null;
          referenceError = `Untrusted projectM reference: ${
            error instanceof Error ? error.message : String(error)
          }`;
        }
      }
      const expectedSize = trustedReferenceEntry
        ? {
            width: trustedReferenceEntry.capture.width,
            height: trustedReferenceEntry.capture.height,
          }
        : undefined;
      const threshold = trustedReferenceEntry?.tolerance.threshold ?? 16;
      const presetFailThreshold =
        trustedReferenceEntry?.tolerance.failThreshold ?? failThreshold;
      const webglDiff = projectmImagePath
        ? await diffBackendCapture({
            artifact: await latestStimsArtifactForBackend({
              artifacts: artifactManifest.artifacts,
              outputDir,
              presetId: corpusEntry.id,
              backend: 'webgl',
              expectedSize,
            }),
            backend: 'webgl',
            outputDir,
            projectmImagePath,
            presetId: corpusEntry.id,
            title: corpusEntry.title,
            threshold,
            failThreshold: presetFailThreshold,
            writeDiffImages,
          })
        : referenceError
          ? {
              ...createEmptyDiffResult(),
              status: 'error' as const,
              error: referenceError,
            }
          : undefined;
      const webgpuDiff = projectmImagePath
        ? await diffBackendCapture({
            artifact: await latestStimsArtifactForBackend({
              artifacts: artifactManifest.artifacts,
              outputDir,
              presetId: corpusEntry.id,
              backend: 'webgpu',
              expectedSize,
            }),
            backend: 'webgpu',
            outputDir,
            projectmImagePath,
            presetId: corpusEntry.id,
            title: corpusEntry.title,
            threshold,
            failThreshold: presetFailThreshold,
            writeDiffImages,
          })
        : referenceError
          ? {
              ...createEmptyDiffResult(),
              status: 'error' as const,
              error: referenceError,
            }
          : undefined;
      return buildComparatorPresetResult({
        corpusEntry,
        referenceEntry: trustedReferenceEntry,
        failThreshold: presetFailThreshold,
        webglDiff,
        webgpuDiff,
      });
    }),
  );

  results.sort(comparePresetResults);

  const countByStatus = (status: WebGpuCertificationStatus) =>
    results.filter((r) => r.webgpuCertificationStatus === status).length;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    parityTarget: 'webgpu-certification-comparator',
    tolerance: {
      threshold: 16,
      failThreshold,
    },
    presetCount: results.length,
    certifiedBothCount: countByStatus('certified-both'),
    certifiedNativeCount: countByStatus('certified-native'),
    certifiedWebglCount: countByStatus('certified-webgl'),
    uncertifiedCount: countByStatus('uncertified'),
    unmeasuredCount: countByStatus('unmeasured'),
    presets: results,
  };
}

export function saveWebGpuCertificationReport(
  repoRoot: string,
  report: WebGpuCertificationReport,
) {
  const reportPath = path.join(repoRoot, WEBGPU_CERTIFICATION_REPORT_PATH);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}

export function loadWebGpuCertificationReport(
  repoRoot: string,
): WebGpuCertificationReport | null {
  const reportPath = path.join(repoRoot, WEBGPU_CERTIFICATION_REPORT_PATH);
  if (!fs.existsSync(reportPath)) {
    return null;
  }
  const raw = fs.readFileSync(reportPath, 'utf8');
  return JSON.parse(raw) as WebGpuCertificationReport;
}

export function validateCertificationReport(
  report: unknown,
): report is WebGpuCertificationReport {
  if (!report || typeof report !== 'object') {
    return false;
  }

  const r = report as Record<string, unknown>;

  if (r.version !== 1) return false;
  if (r.parityTarget !== 'webgpu-certification-comparator') return false;
  if (r.generatedAt !== null && typeof r.generatedAt !== 'string') return false;

  const tolerance = r.tolerance as Record<string, unknown> | undefined;
  if (!tolerance || typeof tolerance.threshold !== 'number') return false;
  if (typeof tolerance.failThreshold !== 'number') return false;

  if (typeof r.presetCount !== 'number') return false;
  if (!Array.isArray(r.presets)) return false;

  const validStatuses = new Set([
    'unmeasured',
    'pass',
    'fail',
    'error',
    'missing-capture',
  ]);

  const validCertStatuses = new Set([
    'unmeasured',
    'uncertified',
    'certified-webgl',
    'certified-native',
    'certified-both',
  ]);

  for (const preset of r.presets) {
    if (!preset || typeof preset !== 'object') return false;
    const p = preset as Record<string, unknown>;

    if (typeof p.presetId !== 'string') return false;
    if (typeof p.title !== 'string') return false;
    if (typeof p.hasProjectmReference !== 'boolean') return false;
    if (typeof p.failThreshold !== 'number') return false;

    for (const diffKey of ['webglDiff', 'webgpuDiff']) {
      const diff = p[diffKey] as Record<string, unknown> | undefined;
      if (!diff) return false;
      if (!validStatuses.has(diff.status as string)) return false;
      if (
        diff.mismatchRatio !== null &&
        typeof diff.mismatchRatio !== 'number'
      ) {
        return false;
      }
      if (diff.error !== null && typeof diff.error !== 'string') return false;
    }

    if (!validCertStatuses.has(p.webgpuCertificationStatus as string)) {
      return false;
    }
  }

  return true;
}

export function assertCertificationSemantics(
  report: WebGpuCertificationReport,
) {
  const violations: string[] = [];

  for (const preset of report.presets) {
    const status = preset.webgpuCertificationStatus;
    const webglPass =
      preset.webglDiff.status === 'pass' &&
      preset.webglDiff.mismatchRatio !== null &&
      preset.webglDiff.mismatchRatio <= preset.failThreshold;
    const webgpuPass =
      preset.webgpuDiff.status === 'pass' &&
      preset.webgpuDiff.mismatchRatio !== null &&
      preset.webgpuDiff.mismatchRatio <= preset.failThreshold;

    if (status === 'certified-both') {
      if (!webglPass) {
        violations.push(
          `Preset "${preset.presetId}" is certified-both but WebGL mismatch ratio (${preset.webglDiff.mismatchRatio}) exceeds fail threshold (${preset.failThreshold})`,
        );
      }
      if (!webgpuPass) {
        violations.push(
          `Preset "${preset.presetId}" is certified-both but WebGPU mismatch ratio (${preset.webgpuDiff.mismatchRatio}) exceeds fail threshold (${preset.failThreshold})`,
        );
      }
    }

    if (status === 'certified-native' && !webgpuPass) {
      violations.push(
        `Preset "${preset.presetId}" is certified-native but WebGPU mismatch ratio (${preset.webgpuDiff.mismatchRatio}) exceeds fail threshold (${preset.failThreshold})`,
      );
    }

    if (status === 'certified-webgl' && !webglPass) {
      violations.push(
        `Preset "${preset.presetId}" is certified-webgl but WebGL mismatch ratio (${preset.webglDiff.mismatchRatio}) exceeds fail threshold (${preset.failThreshold})`,
      );
    }

    if (status === 'certified-native' && webglPass) {
      violations.push(
        `Preset "${preset.presetId}" is certified-native but WebGL compatibility also passes — should be certified-both`,
      );
    }

    if (status === 'certified-webgl' && webgpuPass) {
      violations.push(
        `Preset "${preset.presetId}" is certified-webgl but WebGPU also passes — should be certified-both`,
      );
    }

    if (status === 'uncertified' && (webglPass || webgpuPass)) {
      violations.push(
        `Preset "${preset.presetId}" is uncertified but at least one backend passes — should be certified-webgl or certified-native`,
      );
    }
  }

  return violations;
}

export type RunWebGpuCertificationComparatorOptions = {
  repoRoot: string;
  outputDir: string;
  failThreshold: number;
  writeDiffImages: boolean;
  strict: boolean;
};

function usage() {
  console.error(
    'Usage: bun scripts/run-webgpu-certification-comparator.ts [options]',
  );
  console.error('Options:');
  console.error('  --repo-root <path>      Repo root (default: cwd)');
  console.error(
    '  --output <dir>          Parity capture artifact directory (default: ./screenshots/parity)',
  );
  console.error(
    '  --fail-threshold <n>    Mismatch ratio fail threshold (default: 0.04)',
  );
  console.error(
    '  --write-diff-images     Write per-preset diff PNGs (requires browser capture)',
  );
  console.error(
    '  --strict                Exit non-zero on missing captures or diffs',
  );
}

function parseArgs(argv: string[]): RunWebGpuCertificationComparatorOptions {
  const getArg = (name: string, fallback?: string) => {
    const index = argv.indexOf(name);
    if (index === -1 || index + 1 >= argv.length) {
      return fallback;
    }
    return argv[index + 1];
  };

  const failThresholdValue = Number.parseFloat(
    getArg(
      '--fail-threshold',
      String(DEFAULT_WEBGPU_CERTIFICATION_FAIL_THRESHOLD),
    ) ?? String(DEFAULT_WEBGPU_CERTIFICATION_FAIL_THRESHOLD),
  );

  return {
    repoRoot: getArg('--repo-root', process.cwd()) ?? process.cwd(),
    outputDir:
      getArg('--output', './screenshots/parity') ?? './screenshots/parity',
    failThreshold: Number.isFinite(failThresholdValue)
      ? failThresholdValue
      : DEFAULT_WEBGPU_CERTIFICATION_FAIL_THRESHOLD,
    writeDiffImages: argv.includes('--write-diff-images'),
    strict: argv.includes('--strict'),
  };
}

export async function runWebGpuCertificationComparator(
  options: RunWebGpuCertificationComparatorOptions,
) {
  const report = await buildWebGpuCertificationReport({
    repoRoot: options.repoRoot,
    outputDir: options.outputDir,
    failThreshold: options.failThreshold,
    writeDiffImages: options.writeDiffImages,
  });

  const reportPath = saveWebGpuCertificationReport(options.repoRoot, report);
  const semanticsViolations = assertCertificationSemantics(report);

  const presetsWithReferences = report.presets.filter(
    (p) => p.hasProjectmReference,
  );
  const missingWebglCaptures = presetsWithReferences.filter(
    (p) => p.webglDiff.status === 'missing-capture',
  );
  const missingWebgpuCaptures = presetsWithReferences.filter(
    (p) => p.webgpuDiff.status === 'missing-capture',
  );
  const referenceValidationErrors = report.presets.filter(
    (preset) =>
      preset.webglDiff.status === 'error' &&
      preset.webglDiff.error?.startsWith('Untrusted projectM reference:'),
  );

  if (missingWebglCaptures.length > 0 || missingWebgpuCaptures.length > 0) {
    const commands: string[] = [];
    if (missingWebglCaptures.length > 0) {
      commands.push(
        ...missingWebglCaptures.map(
          (p) =>
            `  bun run scripts/capture-visual-reference-suite.ts --preset "${p.presetId}" --force-webgl`,
        ),
      );
    }
    if (missingWebgpuCaptures.length > 0) {
      commands.push(
        ...missingWebgpuCaptures.map(
          (p) =>
            `  bun run scripts/capture-visual-reference-suite.ts --preset "${p.presetId}" --force-webgpu`,
        ),
      );
    }

    console.error(
      `\nWebGPU certification comparator requires browser/GPU captures for ${missingWebglCaptures.length + missingWebgpuCaptures.length} diffs.\n` +
        `Run these capture commands to populate the comparators:\n${commands.join('\n')}\n` +
        `Then re-run: bun scripts/run-webgpu-certification-comparator.ts\n`,
    );
  }

  if (semanticsViolations.length > 0) {
    console.error(
      `\nCertification semantics violations detected:\n${semanticsViolations.map((v) => `  - ${v}`).join('\n')}\n`,
    );
  }

  return {
    report,
    reportPath,
    missingWebglCaptures: missingWebglCaptures.length,
    missingWebgpuCaptures: missingWebgpuCaptures.length,
    semanticsViolations: semanticsViolations.length,
    referenceValidationErrors: referenceValidationErrors.length,
    strictExitCode:
      options.strict &&
      (missingWebglCaptures.length > 0 ||
        missingWebgpuCaptures.length > 0 ||
        semanticsViolations.length > 0 ||
        referenceValidationErrors.length > 0)
        ? 1
        : 0,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    usage();
    process.exit(0);
  }

  try {
    const options = parseArgs(args);
    const result = await runWebGpuCertificationComparator(options);
    console.log(
      JSON.stringify(
        {
          reportPath: result.reportPath,
          certifiedBothCount: result.report.certifiedBothCount,
          certifiedNativeCount: result.report.certifiedNativeCount,
          certifiedWebglCount: result.report.certifiedWebglCount,
          uncertifiedCount: result.report.uncertifiedCount,
          unmeasuredCount: result.report.unmeasuredCount,
          missingWebglCaptures: result.missingWebglCaptures,
          missingWebgpuCaptures: result.missingWebgpuCaptures,
          semanticsViolations: result.semanticsViolations,
          referenceValidationErrors: result.referenceValidationErrors,
        },
        null,
        2,
      ),
    );
    if (result.strictExitCode) {
      process.exitCode = result.strictExitCode;
    }
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    usage();
    console.error(
      `WebGPU certification comparator failed: ${rawMessage}\n` +
        `Verify that assets/data/milkdrop-parity/certification-corpus.json ` +
        `and assets/data/milkdrop-parity/visual-reference-manifest.json are present.`,
    );
    process.exit(1);
  }
}
