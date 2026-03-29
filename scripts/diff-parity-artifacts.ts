import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  appendParityArtifactEntry,
  buildParityArtifactStem,
  loadParityArtifactManifest,
  type ParityArtifactEntry,
} from './parity-artifacts.ts';

type DiffParityOptions = {
  outputDir: string;
  presetId?: string;
  stimsId?: string;
  projectmId?: string;
  threshold: number;
  failThreshold?: number;
  writeDiff: boolean;
};

type ImagePixels = {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array;
};

type ParityDiffMetrics = {
  width: number;
  height: number;
  totalPixels: number;
  mismatchedPixels: number;
  mismatchRatio: number;
  maxChannelDelta: number;
  meanAbsoluteError: number;
  rmse: number;
  exactMatch: boolean;
  threshold: number;
};

type ResolvedPair = {
  stims: ParityArtifactEntry;
  projectm: ParityArtifactEntry;
};

function usage() {
  console.error('Usage: bun scripts/diff-parity-artifacts.ts [options]');
  console.error('Options:');
  console.error(
    '  --output <dir>         Artifact directory (default: ./screenshots/parity)',
  );
  console.error(
    '  --preset <id>          Resolve the latest Stims/projectM pair for a preset',
  );
  console.error(
    '  --stims-id <id>        Explicit manifest entry id for the Stims capture',
  );
  console.error(
    '  --projectm-id <id>     Explicit manifest entry id for the projectM reference',
  );
  console.error(
    '  --threshold <0-255>    Per-channel mismatch threshold (default: 16)',
  );
  console.error(
    '  --fail-threshold <n>   Exit non-zero if mismatch ratio exceeds n (0..1)',
  );
  console.error('  --no-diff-image        Skip writing a visual diff PNG');
}

function parseArgs(argv: string[]): DiffParityOptions | null {
  const getArg = (name: string, fallback?: string) => {
    const index = argv.indexOf(name);
    if (index === -1 || index + 1 >= argv.length) {
      return fallback;
    }
    return argv[index + 1];
  };

  const outputDir =
    getArg('--output', './screenshots/parity') ?? './screenshots/parity';
  const presetId = getArg('--preset');
  const stimsId = getArg('--stims-id');
  const projectmId = getArg('--projectm-id');
  const thresholdValue = Number.parseFloat(getArg('--threshold', '16') ?? '16');
  const failThresholdValue = getArg('--fail-threshold');

  if (!presetId && !(stimsId && projectmId)) {
    return null;
  }

  return {
    outputDir,
    presetId,
    stimsId,
    projectmId,
    threshold: Number.isFinite(thresholdValue) ? thresholdValue : 16,
    failThreshold:
      failThresholdValue !== undefined
        ? Number.parseFloat(failThresholdValue)
        : undefined,
    writeDiff: !argv.includes('--no-diff-image'),
  };
}

function artifactCreatedAtValue(entry: ParityArtifactEntry) {
  return Date.parse(entry.createdAt) || 0;
}

function resolveImagePath(
  outputDir: string,
  imagePath: string | null | undefined,
) {
  if (!imagePath) {
    throw new Error(`Artifact in ${outputDir} is missing an image path.`);
  }

  return path.isAbsolute(imagePath)
    ? imagePath
    : path.join(outputDir, imagePath);
}

function resolvePair(
  manifest: ReturnType<typeof loadParityArtifactManifest>,
  options: DiffParityOptions,
): ResolvedPair {
  const artifacts = manifest.artifacts;
  const findById = (id: string, kind: ParityArtifactEntry['kind']) => {
    const match = artifacts.find(
      (entry) => entry.id === id && entry.kind === kind,
    );
    if (!match) {
      throw new Error(`No ${kind} artifact found for id "${id}".`);
    }
    return match;
  };

  if (options.stimsId && options.projectmId) {
    return {
      stims: findById(options.stimsId, 'stims-capture'),
      projectm: findById(options.projectmId, 'projectm-reference'),
    };
  }

  if (!options.presetId) {
    throw new Error('A preset id or explicit artifact ids are required.');
  }

  const byPreset = (kind: ParityArtifactEntry['kind']) =>
    artifacts
      .filter(
        (entry) => entry.kind === kind && entry.presetId === options.presetId,
      )
      .sort(
        (left, right) =>
          artifactCreatedAtValue(right) - artifactCreatedAtValue(left),
      );

  const stims = byPreset('stims-capture')[0];
  const projectm = byPreset('projectm-reference')[0];

  if (!stims || !projectm) {
    throw new Error(
      `Could not resolve both a Stims capture and a projectM reference for preset "${options.presetId}".`,
    );
  }

  return { stims, projectm };
}

export async function loadImagePixels(filePath: string): Promise<ImagePixels> {
  const image = sharp(filePath).ensureAlpha();
  const metadata = await image.metadata();
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!metadata.width || !metadata.height) {
    throw new Error(`Unable to determine image dimensions for ${filePath}.`);
  }

  return {
    width: metadata.width,
    height: metadata.height,
    channels: info.channels,
    data,
  };
}

export function computeParityDiffMetrics({
  stims,
  projectm,
  threshold,
}: {
  stims: ImagePixels;
  projectm: ImagePixels;
  threshold: number;
}) {
  if (stims.width !== projectm.width || stims.height !== projectm.height) {
    throw new Error(
      `Image dimensions differ: Stims ${stims.width}x${stims.height}, projectM ${projectm.width}x${projectm.height}.`,
    );
  }

  const totalPixels = stims.width * stims.height;
  const diffBuffer = new Uint8ClampedArray(totalPixels * 4);
  let mismatchedPixels = 0;
  let absoluteDeltaSum = 0;
  let squaredDeltaSum = 0;
  let maxChannelDelta = 0;

  for (let pixelIndex = 0; pixelIndex < totalPixels; pixelIndex += 1) {
    const offset = pixelIndex * 4;
    const deltaR = Math.abs(stims.data[offset] - projectm.data[offset]);
    const deltaG = Math.abs(stims.data[offset + 1] - projectm.data[offset + 1]);
    const deltaB = Math.abs(stims.data[offset + 2] - projectm.data[offset + 2]);
    const maxDelta = Math.max(deltaR, deltaG, deltaB);
    const meanDelta = (deltaR + deltaG + deltaB) / 3;

    absoluteDeltaSum += deltaR + deltaG + deltaB;
    squaredDeltaSum += deltaR ** 2 + deltaG ** 2 + deltaB ** 2;
    maxChannelDelta = Math.max(maxChannelDelta, maxDelta);

    const mismatched = maxDelta > threshold;
    if (mismatched) {
      mismatchedPixels += 1;
      diffBuffer[offset] = 255;
      diffBuffer[offset + 1] = Math.min(255, meanDelta * 4);
      diffBuffer[offset + 2] = Math.min(255, meanDelta * 2);
      diffBuffer[offset + 3] = 255;
    } else {
      const neutral = Math.round(meanDelta);
      diffBuffer[offset] = neutral;
      diffBuffer[offset + 1] = neutral;
      diffBuffer[offset + 2] = neutral;
      diffBuffer[offset + 3] = 255;
    }
  }

  const channelSampleCount = totalPixels * 3;
  const metrics: ParityDiffMetrics = {
    width: stims.width,
    height: stims.height,
    totalPixels,
    mismatchedPixels,
    mismatchRatio: totalPixels === 0 ? 0 : mismatchedPixels / totalPixels,
    maxChannelDelta,
    meanAbsoluteError:
      channelSampleCount === 0
        ? 0
        : absoluteDeltaSum / channelSampleCount / 255,
    rmse:
      channelSampleCount === 0
        ? 0
        : Math.sqrt(squaredDeltaSum / channelSampleCount) / 255,
    exactMatch: mismatchedPixels === 0,
    threshold,
  };

  return {
    metrics,
    diffBuffer,
  };
}

export async function writeDiffImage({
  outputPath,
  width,
  height,
  diffBuffer,
}: {
  outputPath: string;
  width: number;
  height: number;
  diffBuffer: Uint8ClampedArray;
}) {
  await sharp(diffBuffer, {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png()
    .toFile(outputPath);
}

export async function diffParityArtifacts(options: DiffParityOptions) {
  const manifest = loadParityArtifactManifest(options.outputDir);
  const pair = resolvePair(manifest, options);
  const stimsImagePath = resolveImagePath(
    options.outputDir,
    pair.stims.files.image,
  );
  const projectmImagePath = resolveImagePath(
    options.outputDir,
    pair.projectm.files.image,
  );

  const [stimsPixels, projectmPixels] = await Promise.all([
    loadImagePixels(stimsImagePath),
    loadImagePixels(projectmImagePath),
  ]);
  const { metrics, diffBuffer } = computeParityDiffMetrics({
    stims: stimsPixels,
    projectm: projectmPixels,
    threshold: options.threshold,
  });

  const createdAt = new Date().toISOString();
  const outputStem = buildParityArtifactStem({
    kind: 'parity-diff',
    slug: pair.stims.slug,
    presetId: pair.stims.presetId,
  });
  const timeSegment = createdAt.replace(/[^0-9]/g, '').slice(0, 14) || '0';
  const reportPath = path.join(
    options.outputDir,
    `${outputStem}--${timeSegment}.json`,
  );
  const diffImagePath = path.join(
    options.outputDir,
    `${outputStem}--${timeSegment}.png`,
  );

  const report = {
    version: 1,
    createdAt,
    stimsArtifactId: pair.stims.id,
    projectmArtifactId: pair.projectm.id,
    presetId: pair.stims.presetId,
    metrics,
  };

  fs.mkdirSync(options.outputDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  if (options.writeDiff) {
    await writeDiffImage({
      outputPath: diffImagePath,
      width: metrics.width,
      height: metrics.height,
      diffBuffer,
    });
  }

  const manifestWrite = appendParityArtifactEntry(options.outputDir, {
    kind: 'parity-diff',
    slug: pair.stims.slug,
    presetId: pair.stims.presetId,
    title: pair.stims.title ?? pair.projectm.title ?? null,
    createdAt,
    files: {
      image: options.writeDiff ? diffImagePath : null,
      metadata: reportPath,
    },
    provenance: {
      label: 'stims vs projectM diff',
      importedFrom: `${pair.stims.id}:${pair.projectm.id}`,
    },
  });

  if (
    options.failThreshold !== undefined &&
    metrics.mismatchRatio > options.failThreshold
  ) {
    const error = new Error(
      `Mismatch ratio ${metrics.mismatchRatio.toFixed(6)} exceeded fail threshold ${options.failThreshold.toFixed(6)}.`,
    );
    Object.assign(error, {
      reportPath,
      diffImagePath: options.writeDiff ? diffImagePath : null,
      manifestPath: manifestWrite.manifestPath,
    });
    throw error;
  }

  return {
    reportPath,
    diffImagePath: options.writeDiff ? diffImagePath : null,
    manifestPath: manifestWrite.manifestPath,
    metrics,
    stimsArtifactId: pair.stims.id,
    projectmArtifactId: pair.projectm.id,
  };
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    usage();
    process.exit(1);
  }

  try {
    const result = await diffParityArtifacts(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
