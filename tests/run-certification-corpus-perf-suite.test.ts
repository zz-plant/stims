import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCertificationCorpusPerfRequests,
  type CertificationCorpusPerfReport,
  rankCertificationCorpusPerfReports,
} from '../scripts/run-certification-corpus-perf-suite.ts';

function writeCorpus(repoRoot: string, presets: unknown[]) {
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
        presetCount: presets.length,
        groups: {
          'bundled-shipped': { minimumCount: 0, description: 'bundled' },
          'local-custom-shape': { minimumCount: 0, description: 'local' },
          'parity-corpus': { minimumCount: 0, description: 'parity' },
          'projectm-upstream': { minimumCount: 0, description: 'upstream' },
        },
        presets,
      },
      null,
      2,
    )}\n`,
  );
}

test('buildCertificationCorpusPerfRequests standardizes certification perf runs', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-certification-perf-'),
  );
  writeCorpus(repoRoot, [
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
  ]);

  expect(
    buildCertificationCorpusPerfRequests({
      repoRoot,
      outputDir: '/tmp/certification-perf',
      port: 5176,
      headless: true,
    }),
  ).toEqual([
    expect.objectContaining({
      id: 'alpha',
      playToy: expect.objectContaining({
        slug: 'milkdrop',
        presetId: 'alpha',
        port: 5176,
        duration: 4500,
        headless: true,
        vibeMode: false,
        rendererProfile: 'webgpu',
        catalogMode: 'certification',
        recordParityArtifact: false,
        perfCapture: {
          warmupMs: 1000,
        },
      }),
    }),
  ]);
});

test('rankCertificationCorpusPerfReports puts errors first, then hottest failures', () => {
  const reports: CertificationCorpusPerfReport[] = [
    {
      version: 1,
      presetId: 'pass',
      title: 'Pass',
      corpusGroup: 'bundled-shipped',
      strata: ['feedback'],
      sourceFamily: 'external-pack',
      requiredBackend: 'webgpu',
      actualBackend: 'webgpu',
      status: 'pass',
      targetFrameMs: 16.7,
      overBudgetMs: -1,
      consoleErrors: null,
      error: null,
      fallbackOccurred: false,
      performance: null,
      playToySuccess: true,
      reportPath: '/tmp/pass.json',
    },
    {
      version: 1,
      presetId: 'hot-fail',
      title: 'Hot Fail',
      corpusGroup: 'parity-corpus',
      strata: ['motion-vectors'],
      sourceFamily: 'projectm-fixture',
      requiredBackend: 'webgpu',
      actualBackend: 'webgpu',
      status: 'fail',
      targetFrameMs: 16.7,
      overBudgetMs: 9,
      consoleErrors: null,
      error: null,
      fallbackOccurred: false,
      performance: null,
      playToySuccess: true,
      reportPath: '/tmp/hot-fail.json',
    },
    {
      version: 1,
      presetId: 'cooler-fail',
      title: 'Cooler Fail',
      corpusGroup: 'projectm-upstream',
      strata: ['feedback'],
      sourceFamily: 'projectm-fixture',
      requiredBackend: 'webgpu',
      actualBackend: 'webgpu',
      status: 'fail',
      targetFrameMs: 16.7,
      overBudgetMs: 2,
      consoleErrors: null,
      error: null,
      fallbackOccurred: false,
      performance: null,
      playToySuccess: true,
      reportPath: '/tmp/cooler-fail.json',
    },
    {
      version: 1,
      presetId: 'error',
      title: 'Error',
      corpusGroup: 'local-custom-shape',
      strata: ['custom-shape'],
      sourceFamily: 'ad-hoc',
      requiredBackend: 'webgpu',
      actualBackend: null,
      status: 'error',
      targetFrameMs: 16.7,
      overBudgetMs: null,
      consoleErrors: ['boom'],
      error: 'boom',
      fallbackOccurred: true,
      performance: null,
      playToySuccess: false,
      reportPath: '/tmp/error.json',
    },
  ];

  expect(
    rankCertificationCorpusPerfReports(reports).map(
      (report) => report.presetId,
    ),
  ).toEqual(['error', 'hot-fail', 'cooler-fail', 'pass']);
});
