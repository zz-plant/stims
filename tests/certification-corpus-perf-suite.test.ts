import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCertificationCorpusPerfRequests,
  type CertificationCorpusPerfReport,
  rankCertificationCorpusPerfReports,
} from '../scripts/run-certification-corpus-perf-suite.ts';

function writeCertificationCorpusManifest(
  repoRoot: string,
  presets: Array<{
    id: string;
    title: string;
    file: string;
    fixtureRoot: string;
    corpusGroup:
      | 'bundled-shipped'
      | 'local-custom-shape'
      | 'parity-corpus'
      | 'projectm-upstream';
    sourceFamily: string;
    requiredBackend: 'webgpu';
    toleranceProfile: 'default';
    strata: string[];
    selectionReason: string;
  }>,
) {
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
        presets,
      },
      null,
      2,
    )}\n`,
  );
}

test('buildCertificationCorpusPerfRequests standardizes perf capture inputs and supports filters', () => {
  const repoRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'stims-certification-perf-'),
  );
  writeCertificationCorpusManifest(repoRoot, [
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
      sourceFamily: 'projectm-fixture',
      requiredBackend: 'webgpu',
      toleranceProfile: 'default',
      strata: ['geometry'],
      selectionReason: 'upstream',
    },
  ]);

  expect(
    buildCertificationCorpusPerfRequests({
      repoRoot,
      outputDir: '/tmp/perf-suite',
      port: 4173,
      headless: true,
    }),
  ).toEqual([
    expect.objectContaining({
      id: 'alpha',
      title: 'Alpha',
      corpusGroup: 'bundled-shipped',
      strata: ['feedback'],
      playToy: expect.objectContaining({
        slug: 'milkdrop',
        presetId: 'alpha',
        port: 4173,
        duration: 4500,
        viewportWidth: 1280,
        viewportHeight: 720,
        headless: true,
        vibeMode: false,
        rendererProfile: 'webgpu',
        catalogMode: 'certification',
        outputDir: '/tmp/perf-suite',
        perfCapture: { warmupMs: 1000 },
      }),
    }),
    expect.objectContaining({
      id: 'beta',
      title: 'Beta',
      corpusGroup: 'projectm-upstream',
      strata: ['geometry'],
    }),
  ]);
});

test('rankCertificationCorpusPerfReports sorts errors first and then worst over-budget failures', () => {
  const reports: CertificationCorpusPerfReport[] = [
    {
      version: 1,
      presetId: 'pass',
      title: 'Pass',
      corpusGroup: 'parity-corpus',
      strata: ['waveform'],
      sourceFamily: 'projectm-fixture',
      requiredBackend: 'webgpu',
      actualBackend: 'webgpu',
      status: 'pass',
      targetFrameMs: 16.7,
      overBudgetMs: -1.3,
      consoleErrors: null,
      error: null,
      fallbackOccurred: false,
      performance: null,
      playToySuccess: true,
      reportPath: '/tmp/perf-suite/reports/pass.json',
    },
    {
      version: 1,
      presetId: 'fail-slower',
      title: 'Fail Slower',
      corpusGroup: 'bundled-shipped',
      strata: ['feedback'],
      sourceFamily: 'external-pack',
      requiredBackend: 'webgpu',
      actualBackend: 'webgpu',
      status: 'fail',
      targetFrameMs: 16.7,
      overBudgetMs: 12,
      consoleErrors: null,
      error: null,
      fallbackOccurred: false,
      performance: null,
      playToySuccess: true,
      reportPath: '/tmp/perf-suite/reports/fail-slower.json',
    },
    {
      version: 1,
      presetId: 'error-fallback',
      title: 'Error Fallback',
      corpusGroup: 'projectm-upstream',
      strata: ['geometry'],
      sourceFamily: 'projectm-fixture',
      requiredBackend: 'webgpu',
      actualBackend: 'webgl',
      status: 'error',
      targetFrameMs: 16.7,
      overBudgetMs: null,
      consoleErrors: null,
      error: 'fallback',
      fallbackOccurred: true,
      performance: null,
      playToySuccess: false,
      reportPath: '/tmp/perf-suite/reports/error-fallback.json',
    },
    {
      version: 1,
      presetId: 'fail-faster',
      title: 'Fail Faster',
      corpusGroup: 'local-custom-shape',
      strata: ['shape'],
      sourceFamily: 'ad-hoc',
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
      reportPath: '/tmp/perf-suite/reports/fail-faster.json',
    },
  ];

  expect(
    rankCertificationCorpusPerfReports(reports).map(
      (report) => report.presetId,
    ),
  ).toEqual(['error-fallback', 'fail-slower', 'fail-faster', 'pass']);
});
