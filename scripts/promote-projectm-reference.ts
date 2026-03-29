import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { loadParityArtifactManifest } from './parity-artifacts.ts';
import {
  loadVisualReferenceManifest,
  upsertVisualReferencePreset,
  VISUAL_REFERENCE_FIXTURE_ROOT,
  type VisualReferencePresetEntry,
} from './visual-reference-manifest.ts';

type PromoteProjectMReferenceOptions = {
  repoRoot: string;
  outputDir: string;
  presetId?: string;
  projectmId?: string;
  strata: string[];
  title?: string;
};

function usage() {
  console.error(
    'Usage: bun scripts/promote-projectm-reference.ts [--preset <id> | --projectm-id <id>] [options]',
  );
  console.error('Options:');
  console.error(
    '  --output <dir>      Parity artifact directory (default: ./screenshots/parity)',
  );
  console.error(
    '  --strata <a,b,c>    Optional comma-separated strata for the certified reference',
  );
  console.error('  --title <title>     Optional explicit title override');
}

function parseArgs(argv: string[]): PromoteProjectMReferenceOptions | null {
  const getArg = (name: string, fallback?: string) => {
    const index = argv.indexOf(name);
    if (index === -1 || index + 1 >= argv.length) {
      return fallback;
    }
    return argv[index + 1];
  };

  const presetId = getArg('--preset');
  const projectmId = getArg('--projectm-id');
  if (!presetId && !projectmId) {
    return null;
  }

  return {
    repoRoot: process.cwd(),
    outputDir:
      getArg('--output', './screenshots/parity') ?? './screenshots/parity',
    presetId,
    projectmId,
    strata: (getArg('--strata', '') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    title: getArg('--title'),
  };
}

function resolveArtifact(
  manifest: ReturnType<typeof loadParityArtifactManifest>,
  options: PromoteProjectMReferenceOptions,
) {
  const projectmArtifacts = manifest.artifacts
    .filter((entry) => entry.kind === 'projectm-reference')
    .sort(
      (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
    );

  const artifact = options.projectmId
    ? projectmArtifacts.find((entry) => entry.id === options.projectmId)
    : projectmArtifacts.find((entry) => entry.presetId === options.presetId);

  if (!artifact) {
    throw new Error(
      options.projectmId
        ? `No projectM artifact found for id "${options.projectmId}".`
        : `No projectM artifact found for preset "${options.presetId}".`,
    );
  }

  return artifact;
}

function resolveArtifactFile(
  outputDir: string,
  filePath: string | null | undefined,
) {
  if (!filePath) {
    return null;
  }
  return path.isAbsolute(filePath) ? filePath : path.join(outputDir, filePath);
}

function sanitizeFileStem(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function readImageSize(filePath: string) {
  const metadata = await sharp(filePath).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error(`Unable to determine image size for ${filePath}.`);
  }
  return {
    width: metadata.width,
    height: metadata.height,
  };
}

function buildFixturePaths({
  repoRoot,
  presetId,
  imagePath,
  metadataPath,
}: {
  repoRoot: string;
  presetId: string;
  imagePath: string;
  metadataPath?: string | null;
}) {
  const fileStem = sanitizeFileStem(presetId) || 'preset';
  const fixtureRoot = path.join(repoRoot, VISUAL_REFERENCE_FIXTURE_ROOT);
  const imageExt = path.extname(imagePath) || '.png';
  const metadataExt = metadataPath
    ? path.extname(metadataPath) || '.json'
    : '.json';

  return {
    fixtureRoot,
    absoluteImagePath: path.join(fixtureRoot, `${fileStem}${imageExt}`),
    relativeImagePath: `${fileStem}${imageExt}`,
    absoluteMetadataPath: metadataPath
      ? path.join(fixtureRoot, `${fileStem}.meta${metadataExt}`)
      : null,
    relativeMetadataPath: metadataPath
      ? `${fileStem}.meta${metadataExt}`
      : null,
  };
}

export async function promoteProjectMReference(
  options: PromoteProjectMReferenceOptions,
) {
  const artifactManifest = loadParityArtifactManifest(options.outputDir);
  const artifact = resolveArtifact(artifactManifest, options);
  const presetId = artifact.presetId?.trim();
  if (!presetId) {
    throw new Error(`Artifact "${artifact.id}" is missing a preset id.`);
  }

  const sourceImagePath = resolveArtifactFile(
    options.outputDir,
    artifact.files.image,
  );
  if (!sourceImagePath || !fs.existsSync(sourceImagePath)) {
    throw new Error(
      `Artifact "${artifact.id}" is missing a readable image file.`,
    );
  }
  const sourceMetadataPath = resolveArtifactFile(
    options.outputDir,
    artifact.files.metadata,
  );

  const fixturePaths = buildFixturePaths({
    repoRoot: options.repoRoot,
    presetId,
    imagePath: sourceImagePath,
    metadataPath: sourceMetadataPath,
  });
  fs.mkdirSync(fixturePaths.fixtureRoot, { recursive: true });
  fs.copyFileSync(sourceImagePath, fixturePaths.absoluteImagePath);
  if (sourceMetadataPath && fixturePaths.absoluteMetadataPath) {
    fs.copyFileSync(sourceMetadataPath, fixturePaths.absoluteMetadataPath);
  }

  const manifest = loadVisualReferenceManifest(options.repoRoot);
  const size = await readImageSize(fixturePaths.absoluteImagePath);
  const existingEntry = manifest.presets.find((entry) => entry.id === presetId);
  const entry: VisualReferencePresetEntry = {
    id: presetId,
    title: options.title ?? artifact.title ?? existingEntry?.title ?? presetId,
    image: fixturePaths.relativeImagePath,
    metadata: fixturePaths.relativeMetadataPath,
    sourceFamily: existingEntry?.sourceFamily ?? 'ad-hoc',
    strata:
      options.strata.length > 0
        ? options.strata
        : (existingEntry?.strata ?? []),
    tolerance: existingEntry?.tolerance ?? {
      profile: manifest.defaults.toleranceProfile,
      threshold: manifest.defaults.threshold,
      failThreshold: manifest.defaults.failThreshold,
    },
    capture: {
      renderer: 'projectm',
      requiredBackend:
        existingEntry?.capture.requiredBackend ??
        manifest.defaults.requiredBackend,
      width: size.width,
      height: size.height,
      warmupMs: existingEntry?.capture.warmupMs ?? manifest.defaults.warmupMs,
      captureOffsetMs:
        existingEntry?.capture.captureOffsetMs ??
        manifest.defaults.captureOffsetMs,
    },
    provenance: {
      label:
        artifact.provenance?.label ??
        existingEntry?.provenance.label ??
        'projectM reference import',
      importedAt: new Date().toISOString(),
      sourceArtifactId: artifact.id,
    },
  };

  const manifestWrite = upsertVisualReferencePreset(options.repoRoot, entry);
  return {
    entry,
    manifestPath: manifestWrite.manifestPath,
    image: fixturePaths.absoluteImagePath,
    metadata: fixturePaths.absoluteMetadataPath,
  };
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    usage();
    process.exit(1);
  }

  try {
    const result = await promoteProjectMReference(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
