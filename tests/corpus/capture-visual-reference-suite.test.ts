import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
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
