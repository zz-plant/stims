import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  buildNativeProjectMReferenceMetadata,
  extractPpmPixels,
  parseNativeProjectMCaptureArgs,
  parseProjectMGlMetadata,
  resolveNativeProjectMFixture,
  withTemporaryDirectory,
} from './native-projectm-reference.ts';
import { hashFileSha256 } from './parity-artifacts.ts';

function usage() {
  console.error(
    'Usage: bun scripts/capture-native-projectm-reference.ts --preset <id> [options]',
  );
  console.error('Options:');
  console.error(
    '  --fixture-root <dir>    Upstream fixture root (default: tests/fixtures/milkdrop/projectm-upstream)',
  );
  console.error(
    '  --output <dir>          Review-only output directory (default: screenshots/parity/native-projectm)',
  );
  console.error('  --width <pixels>       Default: 1280');
  console.error('  --height <pixels>      Default: 720');
  console.error('  --fps <frames/sec>     Default: 60');
  console.error('  --frames <count>       Default: 300');
  console.error(
    '  --projectm-prefix <dir> Homebrew projectM prefix (default: /opt/homebrew/opt/projectm)',
  );
  console.error(
    '  --sdl-prefix <dir>      Homebrew SDL2 prefix (default: /opt/homebrew/opt/sdl2)',
  );
}

function run(command: string, args: string[], label: string) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();
    const termination =
      result.status === null
        ? `signal ${result.signal ?? 'unknown'}`
        : `exit ${result.status}`;
    throw new Error(
      `${label} failed (${termination})${detail ? `:\n${detail}` : '.'}`,
    );
  }
  return result;
}

function homebrewVersion(prefix: string) {
  const receiptPath = path.join(prefix, 'INSTALL_RECEIPT.json');
  const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as {
    source?: { versions?: { stable?: string } };
  };
  const version = receipt.source?.versions?.stable;
  if (!version) {
    throw new Error(`Unable to resolve Homebrew version from ${receiptPath}.`);
  }
  return version;
}

export async function captureNativeProjectMReference(
  options: ReturnType<typeof parseNativeProjectMCaptureArgs>,
) {
  if (process.platform !== 'darwin') {
    throw new Error(
      'The checked-in native capture harness currently supports macOS only.',
    );
  }
  const presetPath = resolveNativeProjectMFixture({
    repoRoot: options.repoRoot,
    fixtureRoot: options.fixtureRoot,
    presetId: options.presetId,
  });
  if (!fs.existsSync(presetPath)) {
    throw new Error(`Upstream fixture not found: ${presetPath}`);
  }

  const projectmPrefix = path.resolve(options.projectmPrefix);
  const sdlPrefix = path.resolve(options.sdlPrefix);
  const projectmHeader = path.join(
    projectmPrefix,
    'include/libprojectM/projectM.hpp',
  );
  const libraryPath = path.join(projectmPrefix, 'lib/libprojectM.dylib');
  const sdlLibraryPath = path.join(sdlPrefix, 'lib/libSDL2.dylib');
  const sdlHeader = path.join(sdlPrefix, 'include/SDL2/SDL.h');
  for (const dependency of [
    projectmHeader,
    libraryPath,
    sdlHeader,
    sdlLibraryPath,
  ]) {
    if (!fs.existsSync(dependency)) {
      throw new Error(
        `Native projectM capture dependency not found: ${dependency}`,
      );
    }
  }

  const harnessSource = path.join(
    options.repoRoot,
    'scripts/native-projectm-capture.cpp',
  );
  const outputDir = path.resolve(options.outputDir);
  const imagePath = path.join(
    outputDir,
    `${options.presetId}.native-projectm.png`,
  );
  const metadataPath = path.join(
    outputDir,
    `${options.presetId}.native-projectm.json`,
  );
  if (fs.existsSync(imagePath) || fs.existsSync(metadataPath)) {
    throw new Error(
      `Review output already exists for "${options.presetId}"; choose an empty output directory.`,
    );
  }

  return withTemporaryDirectory('stims-projectm-native-', async (workDir) => {
    const isolatedFixtureDir = path.join(workDir, 'fixture');
    const harnessBinary = path.join(workDir, 'native-projectm-capture');
    const ppmPath = path.join(workDir, `${options.presetId}.ppm`);
    const stagedImagePath = path.join(workDir, 'reference.png');
    const stagedMetadataPath = path.join(workDir, 'reference.json');
    fs.mkdirSync(isolatedFixtureDir);
    fs.copyFileSync(
      presetPath,
      path.join(isolatedFixtureDir, path.basename(presetPath)),
    );

    run(
      'clang++',
      [
        '-std=c++17',
        harnessSource,
        '-o',
        harnessBinary,
        `-I${path.join(projectmPrefix, 'include')}`,
        `-I${path.join(sdlPrefix, 'include/SDL2')}`,
        `-L${path.join(projectmPrefix, 'lib')}`,
        `-L${path.join(sdlPrefix, 'lib')}`,
        '-lprojectM',
        '-lSDL2',
        '-framework',
        'OpenGL',
      ],
      'Native projectM harness compilation',
    );

    const capture = run(
      harnessBinary,
      [
        isolatedFixtureDir,
        options.presetId,
        ppmPath,
        String(options.width),
        String(options.height),
        String(options.fps),
        String(options.frameCount),
      ],
      'Native projectM render and teardown',
    );
    const gl = parseProjectMGlMetadata(capture.stderr);
    const pixels = extractPpmPixels(
      fs.readFileSync(ppmPath),
      options.width,
      options.height,
    );
    await sharp(pixels, {
      raw: {
        width: options.width,
        height: options.height,
        channels: 3,
      },
    })
      .png()
      .toFile(stagedImagePath);

    const macosVersion = run(
      'sw_vers',
      ['-productVersion'],
      'macOS version lookup',
    ).stdout.trim();
    const metadata = buildNativeProjectMReferenceMetadata({
      presetId: options.presetId,
      presetPath,
      presetSha256: hashFileSha256(presetPath),
      imageSha256: hashFileSha256(stagedImagePath),
      width: options.width,
      height: options.height,
      fps: options.fps,
      frameCount: options.frameCount,
      projectmVersion: homebrewVersion(projectmPrefix),
      projectmPrefix,
      libraryPath,
      librarySha256: hashFileSha256(libraryPath),
      harnessSha256: hashFileSha256(harnessSource),
      sdlVersion: homebrewVersion(sdlPrefix),
      sdlPrefix,
      sdlLibraryPath,
      sdlLibrarySha256: hashFileSha256(sdlLibraryPath),
      macosVersion,
      openGlVendor: gl.vendor,
      openGlRenderer: gl.renderer,
      openGlVersion: gl.version,
      createdAt: new Date().toISOString(),
      platform: process.platform,
      arch: process.arch,
    });
    fs.writeFileSync(
      stagedMetadataPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
    );

    fs.mkdirSync(outputDir, { recursive: true });
    try {
      fs.copyFileSync(stagedImagePath, imagePath, fs.constants.COPYFILE_EXCL);
      fs.copyFileSync(
        stagedMetadataPath,
        metadataPath,
        fs.constants.COPYFILE_EXCL,
      );
    } catch (error) {
      fs.rmSync(imagePath, { force: true });
      fs.rmSync(metadataPath, { force: true });
      throw error;
    }

    return {
      image: imagePath,
      metadata: metadataPath,
      imageSha256: metadata.capture.imageSha256,
      projectmVersion: metadata.externalRuntime.projectM.version,
      captureLog: capture.stderr.trim(),
      promotionStatus: 'review-required' as const,
    };
  });
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  if (argv.includes('--help')) {
    usage();
    process.exit(0);
  }
  try {
    const options = parseNativeProjectMCaptureArgs(argv);
    const result = await captureNativeProjectMReference(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
