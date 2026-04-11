import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCertificationCorpusCaptureRequests } from '../scripts/capture-certification-corpus.ts';

test('buildCertificationCorpusCaptureRequests derives requests from the certification corpus manifest', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-certification-capture-'),
  );
  fs.mkdirSync(path.join(repoRoot, 'assets', 'data', 'milkdrop-parity'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(
      repoRoot,
      'assets',
      'data',
      'milkdrop-parity',
      'certification-corpus.json',
    ),
    `${JSON.stringify(
      {
        version: 1,
        parityTarget: 'projectm-webgpu-certification-v1',
        requiredBackend: 'webgpu',
        presetCount: 2,
        groups: {
          'bundled-shipped': {
            minimumCount: 1,
            description: 'bundled presets',
          },
          'local-custom-shape': {
            minimumCount: 0,
            description: 'local shape fixtures',
          },
          'parity-corpus': {
            minimumCount: 0,
            description: 'parity fixtures',
          },
          'projectm-upstream': {
            minimumCount: 0,
            description: 'upstream fixtures',
          },
        },
        presets: [
          {
            id: 'alpha',
            title: 'Alpha',
            file: 'alpha.milk',
            fixtureRoot: 'public/milkdrop-presets',
            corpusGroup: 'bundled-shipped',
            sourceFamily: 'external-pack',
            requiredBackend: 'webgpu',
            toleranceProfile: 'default',
            strata: ['feedback'],
            selectionReason: 'bundled',
          },
          {
            id: 'beta',
            title: 'Beta',
            file: 'beta.milk',
            fixtureRoot: 'tests/fixtures/milkdrop/projectm-upstream',
            corpusGroup: 'projectm-upstream',
            sourceFamily: 'projectm-upstream',
            requiredBackend: 'webgpu',
            toleranceProfile: 'default',
            strata: ['geometry'],
            selectionReason: 'upstream',
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  expect(
    buildCertificationCorpusCaptureRequests({
      repoRoot,
      outputDir: '/tmp/parity',
      port: 4173,
      headless: true,
      vibeMode: false,
      duration: 1500,
      viewportWidth: 1280,
      viewportHeight: 720,
    }),
  ).toEqual([
    {
      slug: 'milkdrop',
      presetId: 'alpha',
      port: 4173,
      duration: 1500,
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshot: true,
      debugSnapshot: true,
      outputDir: '/tmp/parity',
      headless: true,
      vibeMode: false,
      rendererProfile: 'webgpu',
      catalogMode: 'certification',
    },
    {
      slug: 'milkdrop',
      presetId: 'beta',
      port: 4173,
      duration: 1500,
      viewportWidth: 1280,
      viewportHeight: 720,
      screenshot: true,
      debugSnapshot: true,
      outputDir: '/tmp/parity',
      headless: true,
      vibeMode: false,
      rendererProfile: 'webgpu',
      catalogMode: 'certification',
    },
  ]);
});

test('buildCertificationCorpusCaptureRequests can filter by corpus group and preset id', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-certification-capture-filter-'),
  );
  fs.mkdirSync(path.join(repoRoot, 'assets', 'data', 'milkdrop-parity'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(
      repoRoot,
      'assets',
      'data',
      'milkdrop-parity',
      'certification-corpus.json',
    ),
    `${JSON.stringify(
      {
        version: 1,
        parityTarget: 'projectm-webgpu-certification-v1',
        requiredBackend: 'webgpu',
        presetCount: 3,
        groups: {
          'bundled-shipped': {
            minimumCount: 1,
            description: 'bundled presets',
          },
          'local-custom-shape': {
            minimumCount: 0,
            description: 'local shape fixtures',
          },
          'parity-corpus': {
            minimumCount: 0,
            description: 'parity fixtures',
          },
          'projectm-upstream': {
            minimumCount: 0,
            description: 'upstream fixtures',
          },
        },
        presets: [
          {
            id: 'alpha',
            title: 'Alpha',
            file: 'alpha.milk',
            fixtureRoot: 'public/milkdrop-presets',
            corpusGroup: 'bundled-shipped',
            sourceFamily: 'external-pack',
            requiredBackend: 'webgpu',
            toleranceProfile: 'default',
            strata: ['feedback'],
            selectionReason: 'bundled',
          },
          {
            id: 'beta',
            title: 'Beta',
            file: 'beta.milk',
            fixtureRoot: 'public/milkdrop-presets',
            corpusGroup: 'bundled-shipped',
            sourceFamily: 'external-pack',
            requiredBackend: 'webgpu',
            toleranceProfile: 'default',
            strata: ['geometry'],
            selectionReason: 'bundled',
          },
          {
            id: 'gamma',
            title: 'Gamma',
            file: 'gamma.milk',
            fixtureRoot: 'tests/fixtures/milkdrop/projectm-upstream',
            corpusGroup: 'projectm-upstream',
            sourceFamily: 'projectm-upstream',
            requiredBackend: 'webgpu',
            toleranceProfile: 'default',
            strata: ['upstream'],
            selectionReason: 'upstream',
          },
        ],
      },
      null,
      2,
    )}\n`,
  );

  expect(
    buildCertificationCorpusCaptureRequests({
      repoRoot,
      outputDir: '/tmp/parity',
      port: 4173,
      headless: true,
      vibeMode: false,
      corpusGroup: 'bundled-shipped',
      presetIds: ['beta'],
      duration: 2200,
      viewportWidth: 640,
      viewportHeight: 360,
    }).map((request) => request.presetId),
  ).toEqual(['beta']);
});
