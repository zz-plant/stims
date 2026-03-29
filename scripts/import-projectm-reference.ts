import fs from 'node:fs';
import path from 'node:path';
import {
  appendParityArtifactEntry,
  buildParityArtifactStem,
  hashFileSha256,
} from './parity-artifacts.ts';

type ImportProjectMReferenceOptions = {
  slug: string;
  presetId: string;
  imagePath: string;
  metadataPath?: string;
  outputDir: string;
  title?: string;
  label?: string;
};

function usage() {
  console.error(
    'Usage: bun scripts/import-projectm-reference.ts --preset <id> --image <path> [options]',
  );
  console.error('Options:');
  console.error('  --slug <slug>       Toy slug (default: milkdrop)');
  console.error('  --image <path>      Path to a projectM reference image');
  console.error('  --meta <path>       Optional metadata JSON sidecar');
  console.error(
    '  --output <dir>      Output directory (default: ./screenshots/parity)',
  );
  console.error('  --title <title>     Optional human-readable title');
  console.error('  --label <label>     Optional provenance label');
}

function parseArgs(argv: string[]): ImportProjectMReferenceOptions | null {
  const getArg = (name: string, fallback?: string) => {
    const index = argv.indexOf(name);
    if (index === -1 || index + 1 >= argv.length) {
      return fallback;
    }
    return argv[index + 1];
  };

  const presetId = getArg('--preset');
  const imagePath = getArg('--image');

  if (!presetId || !imagePath) {
    return null;
  }

  return {
    slug: getArg('--slug', 'milkdrop') ?? 'milkdrop',
    presetId,
    imagePath,
    metadataPath: getArg('--meta'),
    outputDir:
      getArg('--output', './screenshots/parity') ?? './screenshots/parity',
    title: getArg('--title'),
    label: getArg('--label'),
  };
}

function ensureFileExists(filePath: string, flag: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${flag} file not found: ${filePath}`);
  }
}

function copyIntoOutputDir({
  sourcePath,
  outputDir,
  destinationName,
}: {
  sourcePath: string;
  outputDir: string;
  destinationName: string;
}) {
  fs.mkdirSync(outputDir, { recursive: true });
  const destinationPath = path.join(outputDir, destinationName);
  fs.copyFileSync(sourcePath, destinationPath);
  return destinationPath;
}

export function buildProjectMReferenceDestinationNames({
  slug,
  presetId,
  createdAt,
  imagePath,
  metadataPath,
}: {
  slug: string;
  presetId: string;
  createdAt: string;
  imagePath: string;
  metadataPath?: string;
}) {
  const stem = buildParityArtifactStem({
    kind: 'projectm-reference',
    slug,
    presetId,
  });
  const timeSegment = createdAt.replace(/[^0-9]/g, '').slice(0, 14) || '0';
  const imageExt = path.extname(imagePath) || '.png';
  const metadataExt = metadataPath
    ? path.extname(metadataPath) || '.json'
    : '.json';

  return {
    imageName: `${stem}--${timeSegment}${imageExt}`,
    metadataName: `${stem}--${timeSegment}${metadataExt}`,
  };
}

export function importProjectMReference(
  options: ImportProjectMReferenceOptions,
) {
  ensureFileExists(options.imagePath, '--image');
  if (options.metadataPath) {
    ensureFileExists(options.metadataPath, '--meta');
  }

  const createdAt = new Date().toISOString();
  const destinationNames = buildProjectMReferenceDestinationNames({
    slug: options.slug,
    presetId: options.presetId,
    createdAt,
    imagePath: options.imagePath,
    metadataPath: options.metadataPath,
  });

  const copiedImagePath = copyIntoOutputDir({
    sourcePath: options.imagePath,
    outputDir: options.outputDir,
    destinationName: destinationNames.imageName,
  });
  const copiedMetadataPath = options.metadataPath
    ? copyIntoOutputDir({
        sourcePath: options.metadataPath,
        outputDir: options.outputDir,
        destinationName: destinationNames.metadataName,
      })
    : undefined;

  const manifestWrite = appendParityArtifactEntry(options.outputDir, {
    kind: 'projectm-reference',
    slug: options.slug,
    presetId: options.presetId,
    title: options.title ?? null,
    createdAt,
    files: {
      image: copiedImagePath,
      metadata: copiedMetadataPath,
    },
    provenance: {
      label: options.label ?? 'projectM reference import',
      importedFrom: path.resolve(options.imagePath),
      imageSha256: hashFileSha256(copiedImagePath),
      metadataSha256: copiedMetadataPath
        ? hashFileSha256(copiedMetadataPath)
        : null,
    },
  });

  return {
    image: copiedImagePath,
    metadata: copiedMetadataPath ?? null,
    manifest: manifestWrite.manifestPath,
    entryId: manifestWrite.entry.id,
  };
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    usage();
    process.exit(1);
  }

  try {
    const result = importProjectMReference(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
