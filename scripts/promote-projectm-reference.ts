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
  sourceImagePath?: string;
  sourceMetadataPath?: string;
  strata: string[];
  title?: string;
  label?: string;
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
    '  --source-image <path>  Promote directly from a local projectM image if no parity artifact exists',
  );
  console.error(
    '  --source-meta <path>   Optional metadata sidecar when promoting directly from a local image',
  );
  console.error(
    '  --strata <a,b,c>    Optional comma-separated strata for the certified reference',
  );
  console.error('  --title <title>     Optional explicit title override');
  console.error('  --label <label>     Optional provenance label override');
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
    sourceImagePath: getArg('--source-image'),
    sourceMetadataPath: getArg('--source-meta'),
    strata: (getArg('--strata', '') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    title: getArg('--title'),
    label: getArg('--label'),
  };
}

function resolveSource(
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

  if (artifact) {
    return {
      artifactId: artifact.id,
      title: artifact.title ?? null,
      imagePath: resolveArtifactFile(options.outputDir, artifact.files.image),
      metadataPath: resolveArtifactFile(
        options.outputDir,
        artifact.files.metadata,
      ),
      provenanceLabel: artifact.provenance?.label ?? null,
    };
  }

  if (!options.sourceImagePath) {
    throw new Error(
      options.projectmId
        ? `No projectM artifact found for id "${options.projectmId}".`
        : `No projectM artifact found for preset "${options.presetId}".`,
    );
  }

  return {
    artifactId: null,
    title: options.title ?? null,
    imagePath: path.resolve(options.sourceImagePath),
    metadataPath: options.sourceMetadataPath
      ? path.resolve(options.sourceMetadataPath)
      : null,
    provenanceLabel: options.label ?? 'existing repo artifact',
  };
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

function formatPresetTitle(value: string) {
  return value
    .trim()
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'projectm') {
        return 'ProjectM';
      }
      if (part.length <= 3) {
        return part.toUpperCase();
      }
      return `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`;
    })
    .join(' ');
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
  const source = resolveSource(artifactManifest, options);
  const presetId = options.presetId?.trim() ?? options.projectmId?.trim();
  if (!presetId) {
    throw new Error(
      source.artifactId
        ? `Artifact "${source.artifactId}" is missing a preset id.`
        : `Direct projectM source for preset "${options.presetId}" is missing a preset id.`,
    );
  }

  const sourceImagePath = source.imagePath;
  if (!sourceImagePath || !fs.existsSync(sourceImagePath)) {
    throw new Error(
      source.artifactId
        ? `Artifact "${source.artifactId}" is missing a readable image file.`
        : `Direct projectM source image is missing or unreadable.`,
    );
  }
  const sourceMetadataPath = source.metadataPath;

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
    title:
      options.title ??
      source.title ??
      existingEntry?.title ??
      formatPresetTitle(presetId),
    image: fixturePaths.relativeImagePath,
    metadata: fixturePaths.relativeMetadataPath,
    sourceFamily: existingEntry?.sourceFamily ?? 'projectm-fixture',
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
        options.label ??
        source.provenanceLabel ??
        existingEntry?.provenance.label ??
        'projectM reference import',
      importedAt: new Date().toISOString(),
      sourceArtifactId: source.artifactId,
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
