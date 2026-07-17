import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildNativeProjectMReferenceMetadata,
  extractPpmPixels,
  parseNativeProjectMCaptureArgs,
  parseProjectMGlMetadata,
  resolveNativeProjectMFixture,
  validateNativeProjectMReferenceMetadata,
  withTemporaryDirectory,
} from '../scripts/native-projectm-reference.ts';

const SHA = 'a'.repeat(64);

test('parseNativeProjectMCaptureArgs targets one upstream fixture with review-safe defaults', () => {
  expect(
    parseNativeProjectMCaptureArgs([
      '--preset',
      '100-square',
      '--output',
      '/tmp/projectm-review',
    ]),
  ).toEqual({
    repoRoot: process.cwd(),
    presetId: '100-square',
    fixtureRoot: 'tests/fixtures/milkdrop/projectm-upstream',
    outputDir: '/tmp/projectm-review',
    width: 1280,
    height: 720,
    fps: 60,
    frameCount: 300,
    projectmPrefix: '/opt/homebrew/opt/projectm',
    sdlPrefix: '/opt/homebrew/opt/sdl2',
  });
});

test('parseNativeProjectMCaptureArgs rejects traversal and path-like preset ids', () => {
  for (const presetId of ['../100-square', '/tmp/100-square', 'a/b', 'a\\b']) {
    expect(() =>
      parseNativeProjectMCaptureArgs(['--preset', presetId]),
    ).toThrow('safe fixture id');
  }
});

test('resolveNativeProjectMFixture keeps fixture roots and presets inside the repository', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-native-fixture-root-'),
  );
  const fixtureRoot = path.join(
    repoRoot,
    'tests/fixtures/milkdrop/projectm-upstream',
  );
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.writeFileSync(path.join(fixtureRoot, '100-square.milk'), 'fixture');

  expect(
    resolveNativeProjectMFixture({
      repoRoot,
      fixtureRoot: 'tests/fixtures/milkdrop/projectm-upstream',
      presetId: '100-square',
    }),
  ).toBe(fs.realpathSync(path.join(fixtureRoot, '100-square.milk')));
  expect(() =>
    resolveNativeProjectMFixture({
      repoRoot,
      fixtureRoot: '../outside',
      presetId: '100-square',
    }),
  ).toThrow('inside the repository');

  const outsideRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-native-fixture-outside-'),
  );
  fs.writeFileSync(path.join(outsideRoot, '100-square.milk'), 'outside');
  fs.symlinkSync(outsideRoot, path.join(repoRoot, 'linked-fixtures'));
  expect(() =>
    resolveNativeProjectMFixture({
      repoRoot,
      fixtureRoot: 'linked-fixtures',
      presetId: '100-square',
    }),
  ).toThrow('inside the repository');
});

test('buildNativeProjectMReferenceMetadata records the native renderer and deterministic inputs', () => {
  const metadata = buildNativeProjectMReferenceMetadata({
    presetId: '100-square',
    presetPath: '/repo/tests/fixtures/100-square.milk',
    presetSha256: SHA,
    imageSha256: 'b'.repeat(64),
    width: 1280,
    height: 720,
    fps: 60,
    frameCount: 300,
    projectmVersion: '3.1.12',
    projectmPrefix: '/opt/homebrew/opt/projectm',
    libraryPath: '/opt/homebrew/opt/projectm/lib/libprojectM.dylib',
    librarySha256: 'c'.repeat(64),
    harnessSha256: 'd'.repeat(64),
    sdlVersion: '2.32.70',
    sdlPrefix: '/opt/homebrew/opt/sdl2',
    sdlLibraryPath: '/opt/homebrew/opt/sdl2/lib/libSDL2.dylib',
    sdlLibrarySha256: 'e'.repeat(64),
    macosVersion: '26.0',
    openGlVendor: 'Apple',
    openGlRenderer: 'Apple M1 Max',
    openGlVersion: '4.1 Metal',
    createdAt: '2026-07-16T00:00:00.000Z',
    platform: 'darwin',
    arch: 'arm64',
  });

  expect(metadata).toEqual(
    expect.objectContaining({
      schemaVersion: 1,
      kind: 'native-projectm-reference',
      preset: expect.objectContaining({ id: '100-square', sha256: SHA }),
      renderer: expect.objectContaining({
        name: 'projectM',
        native: true,
      }),
      externalRuntime: expect.objectContaining({
        provenanceScope: 'capture-host-only',
        projectM: expect.objectContaining({ version: '3.1.12' }),
        sdl: expect.objectContaining({ version: '2.32.70' }),
        macOSVersion: '26.0',
        openGL: {
          vendor: 'Apple',
          renderer: 'Apple M1 Max',
          version: '4.1 Metal',
        },
      }),
      capture: expect.objectContaining({
        width: 1280,
        height: 720,
        fps: 60,
        frameCount: 300,
        nominalDurationMs: 5000,
        timingPolicy: 'projectM-renderFrame-no-external-throttle',
        audio: 'silence',
        framebuffer: 'GL_BACK',
        imageSha256: 'b'.repeat(64),
      }),
    }),
  );
});

test('native harness relies on projectM timing and bypasses unstable SDL teardown after capture', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'scripts/native-projectm-capture.cpp'),
    'utf8',
  );
  expect(source).not.toContain('sleep_for');
  expect(source).not.toContain('SDL_Delay');
  expect(
    source.slice(source.indexOf('PROJECTM_TEARDOWN\\tprojectM-complete')),
  ).not.toContain('SDL_DestroyWindow(window)');
  const successfulTeardown = source.slice(
    source.indexOf('PROJECTM_TEARDOWN\\tprojectM-complete'),
  );
  expect(successfulTeardown).not.toContain('SDL_Quit();');
  expect(successfulTeardown).toContain('std::_Exit(0);');
});

test('validateNativeProjectMReferenceMetadata rejects an image not covered by its sidecar', () => {
  const metadata = buildNativeProjectMReferenceMetadata({
    presetId: '100-square',
    presetPath: '/repo/100-square.milk',
    presetSha256: SHA,
    imageSha256: 'b'.repeat(64),
    width: 1280,
    height: 720,
    fps: 60,
    frameCount: 300,
    projectmVersion: '3.1.12',
    projectmPrefix: '/opt/homebrew/opt/projectm',
    libraryPath: '/opt/homebrew/opt/projectm/lib/libprojectM.dylib',
    librarySha256: 'c'.repeat(64),
    harnessSha256: 'd'.repeat(64),
    createdAt: '2026-07-16T00:00:00.000Z',
    platform: 'darwin',
    arch: 'arm64',
  });

  expect(() =>
    validateNativeProjectMReferenceMetadata(metadata, {
      presetId: '100-square',
      imageSha256: 'e'.repeat(64),
      width: 1280,
      height: 720,
      presetSha256: SHA,
      harnessSha256: 'd'.repeat(64),
    }),
  ).toThrow('image SHA-256');
});

test('validateNativeProjectMReferenceMetadata binds checked-in preset and harness hashes', () => {
  const metadata = buildNativeProjectMReferenceMetadata({
    presetId: '100-square',
    presetPath: '/repo/100-square.milk',
    presetSha256: SHA,
    imageSha256: 'b'.repeat(64),
    width: 1280,
    height: 720,
    fps: 60,
    frameCount: 300,
    projectmVersion: '3.1.12',
    projectmPrefix: '/opt/homebrew/opt/projectm',
    libraryPath: '/opt/homebrew/opt/projectm/lib/libprojectM.dylib',
    librarySha256: 'c'.repeat(64),
    harnessSha256: 'd'.repeat(64),
    createdAt: '2026-07-16T00:00:00.000Z',
    platform: 'darwin',
    arch: 'arm64',
  });

  expect(() =>
    validateNativeProjectMReferenceMetadata(metadata, {
      presetId: '100-square',
      imageSha256: 'b'.repeat(64),
      width: 1280,
      height: 720,
      presetSha256: 'f'.repeat(64),
      harnessSha256: 'd'.repeat(64),
    }),
  ).toThrow('current upstream fixture');
  expect(() =>
    validateNativeProjectMReferenceMetadata(metadata, {
      presetId: '100-square',
      imageSha256: 'b'.repeat(64),
      width: 1280,
      height: 720,
      presetSha256: SHA,
      harnessSha256: 'f'.repeat(64),
    }),
  ).toThrow('checked-in capture harness');
});

test('withTemporaryDirectory removes work files after a failed capture', async () => {
  let workDir = '';
  await expect(
    withTemporaryDirectory('stims-native-cleanup-', async (directory) => {
      workDir = directory;
      fs.writeFileSync(path.join(directory, 'partial.ppm'), 'partial');
      throw new Error('teardown failed');
    }),
  ).rejects.toThrow('teardown failed');
  expect(fs.existsSync(workDir)).toBe(false);
});

test('parseProjectMGlMetadata reads capture-host OpenGL provenance', () => {
  expect(
    parseProjectMGlMetadata(
      'PROJECTM_GL_INFO\tApple\tApple M1 Max\t4.1 Metal - 88\n',
    ),
  ).toEqual({
    vendor: 'Apple',
    renderer: 'Apple M1 Max',
    version: '4.1 Metal - 88',
  });
});

test('extractPpmPixels separates the native harness header from RGB bytes', () => {
  const ppm = Buffer.concat([
    Buffer.from('P6\n2 1\n255\n'),
    Buffer.from([255, 0, 0, 0, 255, 0]),
  ]);
  expect(extractPpmPixels(ppm, 2, 1)).toEqual(
    Buffer.from([255, 0, 0, 0, 255, 0]),
  );
});
