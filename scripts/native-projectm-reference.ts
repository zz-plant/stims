import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashFileSha256 } from './parity-artifacts.ts';
import type { VisualReferencePresetEntry } from './visual-reference-manifest.ts';

export type NativeProjectMCaptureOptions = {
  repoRoot: string;
  presetId: string;
  fixtureRoot: string;
  outputDir: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  projectmPrefix: string;
  sdlPrefix: string;
};

export type NativeProjectMReferenceMetadata = {
  schemaVersion: 1;
  kind: 'native-projectm-reference';
  preset: {
    id: string;
    path: string;
    sha256: string;
  };
  renderer: {
    name: 'projectM';
    native: true;
    harnessSha256: string;
  };
  externalRuntime: {
    provenanceScope: 'capture-host-only';
    projectM: {
      version: string;
      prefix: string;
      libraryPath: string;
      librarySha256: string;
    };
    sdl: {
      version: string | null;
      prefix: string | null;
      libraryPath: string | null;
      librarySha256: string | null;
    };
    macOSVersion: string | null;
    openGL: {
      vendor: string | null;
      renderer: string | null;
      version: string | null;
    };
  };
  capture: {
    width: number;
    height: number;
    fps: number;
    frameCount: number;
    nominalDurationMs: number;
    timingPolicy: 'projectM-renderFrame-no-external-throttle';
    audio: 'silence';
    framebuffer: 'GL_BACK';
    imageSha256: string;
  };
  host: {
    platform: string;
    arch: string;
  };
  createdAt: string;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export const PROJECTM_UPSTREAM_FIXTURE_ROOT =
  'tests/fixtures/milkdrop/projectm-upstream';
export const BUNDLED_PRESET_FIXTURE_ROOT = 'public/milkdrop-presets';
export const NATIVE_PROJECTM_HARNESS_PATH =
  'scripts/native-projectm-capture.cpp';

export type ValidatedNativeProjectMReference = {
  imagePath: string;
  imageSha256: string;
  metadataPath: string;
  metadataSha256: string;
  metadata: NativeProjectMReferenceMetadata;
};

export function extractPpmPixels(ppm: Buffer, width: number, height: number) {
  let headerEnd = -1;
  let newlineCount = 0;
  for (let index = 0; index < ppm.length; index += 1) {
    if (ppm[index] === 10) {
      newlineCount += 1;
      if (newlineCount === 3) {
        headerEnd = index + 1;
        break;
      }
    }
  }
  const expectedHeader = `P6\n${width} ${height}\n255\n`;
  if (
    headerEnd === -1 ||
    ppm.subarray(0, headerEnd).toString('ascii') !== expectedHeader
  ) {
    throw new Error('Native projectM harness returned an invalid PPM header.');
  }
  const pixels = ppm.subarray(headerEnd);
  if (pixels.length !== width * height * 3) {
    throw new Error(
      'Native projectM harness returned an invalid RGB payload size.',
    );
  }
  return Buffer.from(pixels);
}

function assertSafePresetId(presetId: string) {
  if (!SAFE_PRESET_ID_PATTERN.test(presetId)) {
    throw new Error(
      `Preset "${presetId}" is not a safe fixture id; use lowercase letters, numbers, dots, underscores, or hyphens.`,
    );
  }
}

function isPathInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

export function resolveNativeProjectMFixture({
  repoRoot,
  fixtureRoot,
  presetId,
}: {
  repoRoot: string;
  fixtureRoot: string;
  presetId: string;
}) {
  assertSafePresetId(presetId);
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedFixtureRoot = path.resolve(resolvedRepoRoot, fixtureRoot);
  const realRepoRoot = fs.realpathSync(resolvedRepoRoot);
  if (!isPathInside(resolvedRepoRoot, resolvedFixtureRoot)) {
    throw new Error(
      'Native projectM fixture root must stay inside the repository.',
    );
  }
  if (!fs.existsSync(resolvedFixtureRoot)) {
    throw new Error(
      `Native projectM fixture root is missing: ${resolvedFixtureRoot}`,
    );
  }
  const realFixtureRoot = fs.realpathSync(resolvedFixtureRoot);
  if (!isPathInside(realRepoRoot, realFixtureRoot)) {
    throw new Error(
      'Native projectM fixture root must stay inside the repository.',
    );
  }
  const presetPath = path.resolve(realFixtureRoot, `${presetId}.milk`);
  const containedPresetPath = fs.existsSync(presetPath)
    ? fs.realpathSync(presetPath)
    : presetPath;
  if (!isPathInside(realFixtureRoot, containedPresetPath)) {
    throw new Error('Native projectM preset path escaped the fixture root.');
  }
  return containedPresetPath;
}

export function resolveProjectMReferenceFixture({
  repoRoot,
  presetId,
  fixtureRoot = PROJECTM_UPSTREAM_FIXTURE_ROOT,
}: {
  repoRoot: string;
  presetId: string;
  fixtureRoot?: string;
}) {
  const requestedPath = resolveNativeProjectMFixture({
    repoRoot,
    fixtureRoot,
    presetId,
  });
  if (fs.existsSync(requestedPath)) {
    return requestedPath;
  }

  // Shipped presets are valid projectM inputs but are not duplicated into the
  // smaller upstream compatibility fixture corpus.
  if (fixtureRoot === PROJECTM_UPSTREAM_FIXTURE_ROOT) {
    return resolveNativeProjectMFixture({
      repoRoot,
      fixtureRoot: BUNDLED_PRESET_FIXTURE_ROOT,
      presetId,
    });
  }
  return requestedPath;
}

export async function withTemporaryDirectory<T>(
  prefix: string,
  callback: (directory: string) => Promise<T> | T,
) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return await callback(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export function parseProjectMGlMetadata(log: string) {
  const line = log
    .split(/\r?\n/g)
    .find((candidate) => candidate.startsWith('PROJECTM_GL_INFO\t'));
  const [, vendor, renderer, version] = line?.split('\t') ?? [];
  if (!vendor || !renderer || !version) {
    throw new Error('Native projectM harness did not report OpenGL metadata.');
  }
  return { vendor, renderer, version };
}

function readArg(argv: string[], name: string, fallback?: string) {
  const index = argv.indexOf(name);
  if (index === -1 || index + 1 >= argv.length) {
    return fallback;
  }
  return argv[index + 1];
}

function readPositiveInteger(argv: string[], name: string, fallback: number) {
  const raw = readArg(argv, name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export function parseNativeProjectMCaptureArgs(
  argv: string[],
): NativeProjectMCaptureOptions {
  const presetId = readArg(argv, '--preset');
  if (!presetId?.trim()) {
    throw new Error('--preset is required.');
  }
  assertSafePresetId(presetId.trim());

  return {
    repoRoot: process.cwd(),
    presetId: presetId.trim(),
    fixtureRoot:
      readArg(argv, '--fixture-root', PROJECTM_UPSTREAM_FIXTURE_ROOT) ??
      PROJECTM_UPSTREAM_FIXTURE_ROOT,
    outputDir:
      readArg(argv, '--output', './screenshots/parity/native-projectm') ??
      './screenshots/parity/native-projectm',
    width: readPositiveInteger(argv, '--width', 1280),
    height: readPositiveInteger(argv, '--height', 720),
    fps: readPositiveInteger(argv, '--fps', 60),
    frameCount: readPositiveInteger(argv, '--frames', 300),
    projectmPrefix:
      readArg(argv, '--projectm-prefix', '/opt/homebrew/opt/projectm') ??
      '/opt/homebrew/opt/projectm',
    sdlPrefix:
      readArg(argv, '--sdl-prefix', '/opt/homebrew/opt/sdl2') ??
      '/opt/homebrew/opt/sdl2',
  };
}

export function buildNativeProjectMReferenceMetadata(input: {
  presetId: string;
  presetPath: string;
  presetSha256: string;
  imageSha256: string;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  projectmVersion: string;
  projectmPrefix: string;
  libraryPath: string;
  librarySha256: string;
  harnessSha256: string;
  sdlVersion?: string;
  sdlPrefix?: string;
  sdlLibraryPath?: string;
  sdlLibrarySha256?: string;
  macosVersion?: string;
  openGlVendor?: string;
  openGlRenderer?: string;
  openGlVersion?: string;
  createdAt: string;
  platform: string;
  arch: string;
}): NativeProjectMReferenceMetadata {
  return {
    schemaVersion: 1,
    kind: 'native-projectm-reference',
    preset: {
      id: input.presetId,
      path: path.resolve(input.presetPath),
      sha256: input.presetSha256,
    },
    renderer: {
      name: 'projectM',
      native: true,
      harnessSha256: input.harnessSha256,
    },
    externalRuntime: {
      provenanceScope: 'capture-host-only',
      projectM: {
        version: input.projectmVersion,
        prefix: path.resolve(input.projectmPrefix),
        libraryPath: path.resolve(input.libraryPath),
        librarySha256: input.librarySha256,
      },
      sdl: {
        version: input.sdlVersion ?? null,
        prefix: input.sdlPrefix ? path.resolve(input.sdlPrefix) : null,
        libraryPath: input.sdlLibraryPath
          ? path.resolve(input.sdlLibraryPath)
          : null,
        librarySha256: input.sdlLibrarySha256 ?? null,
      },
      macOSVersion: input.macosVersion ?? null,
      openGL: {
        vendor: input.openGlVendor ?? null,
        renderer: input.openGlRenderer ?? null,
        version: input.openGlVersion ?? null,
      },
    },
    capture: {
      width: input.width,
      height: input.height,
      fps: input.fps,
      frameCount: input.frameCount,
      nominalDurationMs: Math.round((input.frameCount / input.fps) * 1000),
      timingPolicy: 'projectM-renderFrame-no-external-throttle',
      audio: 'silence',
      framebuffer: 'GL_BACK',
      imageSha256: input.imageSha256,
    },
    host: {
      platform: input.platform,
      arch: input.arch,
    },
    createdAt: input.createdAt,
  };
}

export function validateNativeProjectMReferenceMetadata(
  value: unknown,
  expected: {
    presetId: string;
    imageSha256: string;
    width: number;
    height: number;
    presetSha256: string;
    harnessSha256: string;
  },
): asserts value is NativeProjectMReferenceMetadata {
  if (!value || typeof value !== 'object') {
    throw new Error(
      'Native projectM reference metadata must be a JSON object.',
    );
  }
  const metadata = value as Partial<NativeProjectMReferenceMetadata>;
  if (
    metadata.schemaVersion !== 1 ||
    metadata.kind !== 'native-projectm-reference' ||
    metadata.renderer?.name !== 'projectM' ||
    metadata.renderer.native !== true
  ) {
    throw new Error(
      'Reference metadata does not identify a native projectM capture.',
    );
  }
  if (metadata.preset?.id !== expected.presetId) {
    throw new Error(
      `Native projectM preset id mismatch: expected "${expected.presetId}".`,
    );
  }
  if (!SHA256_PATTERN.test(metadata.preset.sha256 ?? '')) {
    throw new Error('Native projectM metadata is missing the preset SHA-256.');
  }
  if (metadata.preset.sha256 !== expected.presetSha256) {
    throw new Error(
      'Native projectM metadata does not match the current upstream fixture.',
    );
  }
  if (!SHA256_PATTERN.test(metadata.renderer.harnessSha256 ?? '')) {
    throw new Error('Native projectM renderer provenance is incomplete.');
  }
  if (metadata.renderer.harnessSha256 !== expected.harnessSha256) {
    throw new Error(
      'Native projectM metadata does not match the checked-in capture harness.',
    );
  }
  if (
    metadata.externalRuntime?.provenanceScope !== 'capture-host-only' ||
    !metadata.externalRuntime.projectM.version ||
    !SHA256_PATTERN.test(metadata.externalRuntime.projectM.librarySha256 ?? '')
  ) {
    throw new Error(
      'Native projectM external runtime provenance is incomplete.',
    );
  }
  if (metadata.capture?.imageSha256 !== expected.imageSha256) {
    throw new Error(
      'Native projectM image SHA-256 does not match its sidecar.',
    );
  }
  if (
    metadata.capture.width !== expected.width ||
    metadata.capture.height !== expected.height
  ) {
    throw new Error(
      'Native projectM image dimensions do not match its sidecar.',
    );
  }
  if (
    metadata.capture.audio !== 'silence' ||
    metadata.capture.framebuffer !== 'GL_BACK' ||
    !Number.isSafeInteger(metadata.capture.fps) ||
    !Number.isSafeInteger(metadata.capture.frameCount)
  ) {
    throw new Error('Native projectM capture parameters are incomplete.');
  }
}

export function loadValidatedNativeProjectMReference({
  repoRoot,
  fixtureRoot,
  entry,
}: {
  repoRoot: string;
  fixtureRoot: string;
  entry: VisualReferencePresetEntry;
}): ValidatedNativeProjectMReference {
  if (entry.capture.renderer !== 'projectm') {
    throw new Error(`Reference "${entry.id}" is not marked as projectM.`);
  }
  if (!entry.metadata?.trim()) {
    throw new Error(
      `Reference "${entry.id}" is missing native projectM metadata.`,
    );
  }
  const imagePath = path.resolve(repoRoot, fixtureRoot, entry.image);
  const metadataPath = path.resolve(repoRoot, fixtureRoot, entry.metadata);
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Reference image is missing at "${imagePath}".`);
  }
  if (!fs.existsSync(metadataPath)) {
    throw new Error(`Reference metadata is missing at "${metadataPath}".`);
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `Reference metadata is unreadable at "${metadataPath}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const imageSha256 = hashFileSha256(imagePath);
  const presetPath = resolveProjectMReferenceFixture({
    repoRoot,
    fixtureRoot: PROJECTM_UPSTREAM_FIXTURE_ROOT,
    presetId: entry.id,
  });
  const harnessPath = path.join(repoRoot, NATIVE_PROJECTM_HARNESS_PATH);
  if (!fs.existsSync(presetPath) || !fs.existsSync(harnessPath)) {
    throw new Error(
      `Reference "${entry.id}" cannot be bound to the checked-in fixture and harness.`,
    );
  }
  validateNativeProjectMReferenceMetadata(metadata, {
    presetId: entry.id,
    imageSha256,
    width: entry.capture.width,
    height: entry.capture.height,
    presetSha256: hashFileSha256(presetPath),
    harnessSha256: hashFileSha256(harnessPath),
  });
  return {
    imagePath,
    imageSha256,
    metadataPath,
    metadataSha256: hashFileSha256(metadataPath),
    metadata,
  };
}
