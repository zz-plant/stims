import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertCaptureBackendMatches,
  assertForcedBackendMatchesManifest,
  assertVisualReferenceCaptureSucceeded,
  buildVisualReferenceCaptureRequests,
  parseVisualReferenceCaptureArgs,
} from '../../scripts/capture-visual-reference-suite.ts';
import { saveVisualReferenceManifest } from '../../scripts/visual-reference-manifest.ts';

test('buildVisualReferenceCaptureRequests derives viewport and timing from the reference manifest', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-parity-capture-'),
  );

  saveVisualReferenceManifest(repoRoot, {
    version: 1,
    parityTarget: 'projectm-visual-reference',
    fixtureRoot: 'tests/fixtures/milkdrop/projectm-reference',
    minimumPresetCount: 0,
    presetCount: 2,
    defaults: {
      renderer: 'projectm',
      requiredBackend: 'webgpu',
      width: 1280,
      height: 720,
      warmupMs: 5000,
      captureOffsetMs: 0,
      warmupFrames: 900,
      toleranceProfile: 'default',
      threshold: 16,
      failThreshold: 0.02,
    },
    presets: [
      {
        id: 'alpha',
        title: 'Alpha',
        image: 'alpha.png',
        sourceFamily: 'projectm-fixture',
        strata: ['geometry'],
        tolerance: {
          profile: 'default',
          threshold: 16,
          failThreshold: 0.02,
        },
        capture: {
          renderer: 'projectm',
          requiredBackend: 'webgpu',
          width: 2550,
          height: 1794,
          warmupMs: 5000,
          captureOffsetMs: 250,
          warmupFrames: 900,
        },
        provenance: {
          label: 'fixture',
          importedAt: '2026-03-31T00:00:00.000Z',
        },
      },
      {
        id: 'beta',
        title: 'Beta',
        image: 'beta.png',
        sourceFamily: 'projectm-fixture',
        strata: ['feedback'],
        tolerance: {
          profile: 'default',
          threshold: 16,
          failThreshold: 0.02,
        },
        capture: {
          renderer: 'projectm',
          requiredBackend: 'webgpu',
          width: 640,
          height: 360,
          warmupMs: 2000,
          captureOffsetMs: 1000,
          warmupFrames: 900,
        },
        provenance: {
          label: 'fixture',
          importedAt: '2026-03-31T00:00:00.000Z',
        },
      },
    ],
  });

  expect(
    buildVisualReferenceCaptureRequests({
      repoRoot,
      outputDir: '/tmp/parity',
      port: 4173,
      headless: true,
      vibeMode: false,
    }),
  ).toEqual([
    {
      slug: 'milkdrop',
      audioMode: 'none',
      presetId: 'alpha',
      port: 4173,
      duration: 5250,
      deterministicFrames: 900,
      viewportWidth: 2550,
      viewportHeight: 1794,
      screenshot: true,
      debugSnapshot: true,
      outputDir: '/tmp/parity',
      headless: true,
      vibeMode: false,
      rendererProfile: 'webgpu',
      catalogMode: 'certification',
      screenshotSurface: 'canvas',
    },
    {
      slug: 'milkdrop',
      audioMode: 'none',
      presetId: 'beta',
      port: 4173,
      duration: 3000,
      deterministicFrames: 900,
      viewportWidth: 640,
      viewportHeight: 360,
      screenshot: true,
      debugSnapshot: true,
      outputDir: '/tmp/parity',
      headless: true,
      vibeMode: false,
      rendererProfile: 'webgpu',
      catalogMode: 'certification',
      screenshotSurface: 'canvas',
    },
  ]);
});

test('buildVisualReferenceCaptureRequests can target a subset of certified presets', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-parity-capture-filter-'),
  );

  saveVisualReferenceManifest(repoRoot, {
    version: 1,
    parityTarget: 'projectm-visual-reference',
    fixtureRoot: 'tests/fixtures/milkdrop/projectm-reference',
    minimumPresetCount: 0,
    presetCount: 2,
    defaults: {
      renderer: 'projectm',
      requiredBackend: 'webgpu',
      width: 1280,
      height: 720,
      warmupMs: 5000,
      captureOffsetMs: 0,
      warmupFrames: 900,
      toleranceProfile: 'default',
      threshold: 16,
      failThreshold: 0.02,
    },
    presets: [
      {
        id: 'alpha',
        title: 'Alpha',
        image: 'alpha.png',
        sourceFamily: 'projectm-fixture',
        strata: [],
        tolerance: {
          profile: 'default',
          threshold: 16,
          failThreshold: 0.02,
        },
        capture: {
          renderer: 'projectm',
          requiredBackend: 'webgpu',
          width: 1280,
          height: 720,
          warmupMs: 5000,
          captureOffsetMs: 0,
          warmupFrames: 900,
        },
        provenance: {
          label: 'fixture',
          importedAt: '2026-03-31T00:00:00.000Z',
        },
      },
      {
        id: 'beta',
        title: 'Beta',
        image: 'beta.png',
        sourceFamily: 'projectm-fixture',
        strata: [],
        tolerance: {
          profile: 'default',
          threshold: 16,
          failThreshold: 0.02,
        },
        capture: {
          renderer: 'projectm',
          requiredBackend: 'webgpu',
          width: 1280,
          height: 720,
          warmupMs: 5000,
          captureOffsetMs: 0,
          warmupFrames: 900,
        },
        provenance: {
          label: 'fixture',
          importedAt: '2026-03-31T00:00:00.000Z',
        },
      },
    ],
  });

  expect(
    buildVisualReferenceCaptureRequests({
      repoRoot,
      outputDir: '/tmp/parity',
      port: 4173,
      headless: true,
      vibeMode: true,
      presetIds: ['beta'],
    }).map((request) => request.presetId),
  ).toEqual(['beta']);
});

test('parseVisualReferenceCaptureArgs keeps parity captures out of vibe mode by default', () => {
  expect(parseVisualReferenceCaptureArgs([]).vibeMode).toBe(false);
  expect(parseVisualReferenceCaptureArgs(['--no-vibe-mode']).vibeMode).toBe(
    false,
  );
});

test('parseVisualReferenceCaptureArgs reuses one browser unless isolation is asked for', () => {
  // The default matters: a process per preset costs ~12s of Bun start,
  // Chromium launch and cold dev-server transform against ~4s of actual
  // capture. Measured over the nine certified presets, reusing the browser
  // took 35s where process-per-preset had not finished in 9 minutes.
  expect(parseVisualReferenceCaptureArgs([]).isolateCaptures).toBe(false);
  expect(
    parseVisualReferenceCaptureArgs(['--isolate-captures']).isolateCaptures,
  ).toBe(true);
});

test('parseVisualReferenceCaptureArgs honors explicit backend capture overrides', () => {
  expect(
    parseVisualReferenceCaptureArgs(['--force-webgl']).rendererProfile,
  ).toBe('compatibility');
  expect(
    parseVisualReferenceCaptureArgs(['--force-webgpu']).rendererProfile,
  ).toBe('webgpu');
  expect(() =>
    parseVisualReferenceCaptureArgs(['--force-webgl', '--force-webgpu']),
  ).toThrow('cannot be combined');
});

test('capture suite fails closed when play-toy reports an unsuccessful capture', () => {
  expect(() =>
    assertVisualReferenceCaptureSucceeded({
      slug: 'milkdrop',
      success: false,
      error: 'renderer unavailable',
      fallbackOccurred: false,
    }),
  ).toThrow('Capture failed for milkdrop: renderer unavailable');
});

test('capture suite rejects captures with browser renderer errors', () => {
  expect(() =>
    assertVisualReferenceCaptureSucceeded({
      slug: 'milkdrop',
      success: true,
      fallbackOccurred: false,
      consoleErrors: ['WebGPU Device Lost'],
    }),
  ).toThrow('browser reported 1 console error(s): WebGPU Device Lost');
});

test('parity captures run serially unless --concurrency asks otherwise', () => {
  // The pool size used to be filled in here unconditionally, which meant the
  // suite's own serial default was unreachable from the command line and every
  // capture ran four wide — the configuration that produced a black frame for
  // 100-square and a 24% score for 250-wavecode.
  expect(parseVisualReferenceCaptureArgs([]).concurrency).toBeUndefined();
  expect(
    parseVisualReferenceCaptureArgs(['--concurrency', '4']).concurrency,
  ).toBe(4);
});

test('assertForcedBackendMatchesManifest rejects a forced backend before capturing', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-backend-'));
  fs.mkdirSync(path.join(repoRoot, 'src/data/milkdrop-parity'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(
      repoRoot,
      'src/data/milkdrop-parity/visual-reference-manifest.json',
    ),
    JSON.stringify({
      version: 1,
      parityTarget: 'projectm-visual-reference',
      fixtureRoot: 'tests/fixtures/milkdrop/projectm-reference',
      presets: [
        {
          id: 'webgpu-only',
          title: 'WebGPU only',
          image: 'webgpu-only.png',
          sourceFamily: 'projectm-fixture',
          strata: [],
          capture: { requiredBackend: 'webgpu' },
        },
      ],
    }),
  );

  expect(() =>
    assertForcedBackendMatchesManifest({
      repoRoot,
      rendererProfile: 'compatibility',
      allowBackendOverride: false,
    }),
  ).toThrow(/--force-webgl/);
  expect(() =>
    assertForcedBackendMatchesManifest({
      repoRoot,
      rendererProfile: 'compatibility',
      allowBackendOverride: true,
    }),
  ).not.toThrow();
  expect(() =>
    assertForcedBackendMatchesManifest({
      repoRoot,
      rendererProfile: 'webgpu',
      allowBackendOverride: false,
    }),
  ).not.toThrow();

  fs.rmSync(repoRoot, { recursive: true, force: true });
});

test('assertCaptureBackendMatches names the flag that fixes a silent fallback', () => {
  expect(() =>
    assertCaptureBackendMatches({
      presetId: 'webgpu-only',
      requiredBackend: 'webgpu',
      actualBackend: 'webgl',
    }),
  ).toThrow(/--force-webgpu/);
  expect(() =>
    assertCaptureBackendMatches({
      presetId: 'webgpu-only',
      requiredBackend: 'webgpu',
      actualBackend: 'webgpu',
    }),
  ).not.toThrow();
});
