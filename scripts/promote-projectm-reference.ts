/**
 * Promotes a reviewed native projectM capture into the checked-in visual
 * reference manifest.
 *
 * Promote stage of the parity pipeline (capture -> diff -> promote). Takes the
 * latest `projectm-reference` parity artifact for a preset (or an explicit
 * image via `--source-image`/`--source-meta`), re-validates its provenance
 * metadata against the upstream preset fixture, copies the image and sidecar
 * into the visual reference fixture root, and upserts the preset entry — size,
 * tolerance, required backend, strata, provenance — so parity:suite starts
 * diffing against it.
 *
 *   bun run parity:promote-reference -- --preset <id> [--strata a,b,c]
 *
 * Alternatives and overrides: `--projectm-id` selects an exact artifact,
 * `--output` points at the parity artifact directory, `--fixture-root` changes
 * the preset root used for provenance checks, and `--title`/`--label` override
 * the recorded title and provenance label.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  DEFAULT_MIN_SIGNAL_HEADROOM,
  scoreReferenceSignal,
} from './check-parity-reference-signal.ts';
import {
  hashNativeProjectMHarness,
  NATIVE_PROJECTM_HARNESS_PATH,
  PROJECTM_UPSTREAM_FIXTURE_ROOT,
  resolveProjectMReferenceFixture,
  validateNativeProjectMReferenceMetadata,
} from './native-projectm-reference.ts';
import {
  hashFileSha256,
  loadParityArtifactManifest,
} from './parity-artifacts.ts';
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
  fixtureRoot?: string;
  /** Certify a reference that a blank frame would pass. Needs a stated reason. */
  allowWeakReference?: boolean;
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
  console.error(
    '  --fixture-root <dir>  Preset root used to validate provenance (default: tests/fixtures/milkdrop/projectm-upstream)',
  );
  console.error(
    '  --allow-weak-reference  Certify even if a solid-black frame would pass the reference',
  );
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
    fixtureRoot:
      getArg('--fixture-root', PROJECTM_UPSTREAM_FIXTURE_ROOT) ??
      PROJECTM_UPSTREAM_FIXTURE_ROOT,
    allowWeakReference: argv.includes('--allow-weak-reference'),
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

async function validateNativeSource({
  presetId,
  imagePath,
  metadataPath,
  repoRoot,
  fixtureRoot,
}: {
  presetId: string;
  imagePath: string;
  metadataPath: string | null;
  repoRoot: string;
  fixtureRoot: string;
}) {
  if (!metadataPath || !fs.existsSync(metadataPath)) {
    throw new Error(
      `Reference "${presetId}" requires a native projectM metadata sidecar before promotion.`,
    );
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Reference "${presetId}" has an unreadable native projectM metadata sidecar: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const size = await readImageSize(imagePath);
  const presetPath = resolveProjectMReferenceFixture({
    repoRoot,
    fixtureRoot,
    presetId,
  });
  const harnessPath = path.join(repoRoot, NATIVE_PROJECTM_HARNESS_PATH);
  if (!fs.existsSync(presetPath)) {
    throw new Error(`Current upstream fixture is missing: ${presetPath}`);
  }
  if (!fs.existsSync(harnessPath)) {
    throw new Error(`Checked-in capture harness is missing: ${harnessPath}`);
  }
  validateNativeProjectMReferenceMetadata(metadata, {
    presetId,
    imageSha256: hashFileSha256(imagePath),
    width: size.width,
    height: size.height,
    presetSha256: hashFileSha256(presetPath),
    harnessSha256: hashNativeProjectMHarness(repoRoot),
  });
  return size;
}

/**
 * The audio the capture was rendered against, read from its own sidecar.
 *
 * A reference and the capture it is diffed against have to hear the same
 * thing, so this travels with the reference rather than being a flag someone
 * remembers to pass.
 */
function readFrameCountFromSidecar(
  metadataPath: string | null | undefined,
): number | null {
  if (!metadataPath || !fs.existsSync(metadataPath)) {
    return null;
  }
  try {
    const sidecar = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as {
      capture?: { frameCount?: number };
    };
    const frames = sidecar.capture?.frameCount;
    return typeof frames === 'number' &&
      Number.isSafeInteger(frames) &&
      frames > 0
      ? frames
      : null;
  } catch {
    return null;
  }
}

function readReferenceAudioFromSidecar(
  metadataPath: string | null | undefined,
): 'silence' | 'tones' {
  if (!metadataPath || !fs.existsSync(metadataPath)) {
    return 'silence';
  }
  try {
    const sidecar = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as {
      capture?: { audio?: string };
    };
    const audio = sidecar.capture?.audio;
    return audio === 'tones' ? 'tones' : 'silence';
  } catch {
    return 'silence';
  }
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
  const size = await validateNativeSource({
    presetId,
    imagePath: sourceImagePath,
    metadataPath: sourceMetadataPath,
    repoRoot: options.repoRoot,
    fixtureRoot: options.fixtureRoot ?? PROJECTM_UPSTREAM_FIXTURE_ROOT,
  });

  const manifest = loadVisualReferenceManifest(options.repoRoot);
  const existingEntry = manifest.presets.find((entry) => entry.id === presetId);
  const tolerance = existingEntry?.tolerance ?? {
    profile: manifest.defaults.toleranceProfile,
    threshold: manifest.defaults.threshold,
    failThreshold: manifest.defaults.failThreshold,
  };

  // A reference that a blank frame already passes certifies nothing. Catch it
  // here rather than after it has been diffed against for months: parity:suite
  // will report it green whatever the renderer does.
  const signal = await scoreReferenceSignal({
    presetId,
    imagePath: sourceImagePath,
    threshold: tolerance.threshold,
    failThreshold: tolerance.failThreshold,
    minHeadroom: DEFAULT_MIN_SIGNAL_HEADROOM,
  });
  if (signal.status === 'no-signal' && !options.allowWeakReference) {
    throw new Error(
      `Refusing to certify "${presetId}": ${signal.reason} ` +
        `Capture a frame with something on it (a later warmup frame, or a preset that draws under silence), ` +
        `tighten the fail threshold, or pass --allow-weak-reference if this really is the intended reference.`,
    );
  }
  if (signal.status !== 'ok') {
    console.warn(
      `[parity:promote-reference] ${presetId}: ${signal.reason}` +
        (options.allowWeakReference
          ? ' Certifying anyway (--allow-weak-reference).'
          : ''),
    );
  }

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
    tolerance,
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
      // Read from the reference's own sidecar rather than carried over: the
      // capture has to land on the same frame projectM stopped at, and a
      // manifest value that outlives a re-capture at a different frame count
      // silently diffs two different moments.
      warmupFrames:
        readFrameCountFromSidecar(sourceMetadataPath) ??
        existingEntry?.capture.warmupFrames ??
        manifest.defaults.warmupFrames,
      // Recorded from the capture's own sidecar: the audio the reference was
      // rendered against is the audio our capture has to feed back.
      referenceAudio: readReferenceAudioFromSidecar(sourceMetadataPath),
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
    referenceSignal: signal,
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
