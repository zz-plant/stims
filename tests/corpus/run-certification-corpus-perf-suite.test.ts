import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  aggregateCertificationPerfTrials,
  buildCertificationCorpusPerfRequests,
  type CertificationCorpusPerfReport,
  rankCertificationCorpusPerfReports,
  resolveCertificationCorpusPerfWindow,
  resolvePerfExecutionDefaults,
} from '../../scripts/run-certification-corpus-perf-suite.ts';

function writeCorpus(repoRoot: string, presets: unknown[]) {
  fs.mkdirSync(path.join(repoRoot, 'src', 'data', 'milkdrop-parity'), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(
      repoRoot,
      'src',
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

test('resolveCertificationCorpusPerfWindow preserves requested evidence windows', () => {
  expect(
    resolveCertificationCorpusPerfWindow({ warmupMs: 2000, durationMs: 8000 }),
  ).toEqual({ warmupMs: 2000, durationMs: 8000 });
});

test('resolvePerfExecutionDefaults uses repeated production evidence by default', () => {
  expect(resolvePerfExecutionDefaults({})).toEqual({
    repetitions: 3,
    serverMode: 'production',
    port: 4173,
  });
  expect(
    resolvePerfExecutionDefaults({
      repetitions: 5,
      serverMode: 'development',
      port: 5199,
    }),
  ).toEqual({ repetitions: 5, serverMode: 'development', port: 5199 });
});

test('aggregateCertificationPerfTrials uses the median trial and preserves spread', () => {
  const makeResult = (averageFrameMs: number, medianFps: number) => ({
    slug: 'milkdrop',
    success: true,
    fallbackOccurred: false,
    performance: {
      durationMs: 6000,
      warmupMs: 2000,
      sampleCount: 400,
      averageFrameMs,
      p95FrameMs: averageFrameMs + 1,
      averageSimulationMs: averageFrameMs - 2,
      averageRenderMs: 2,
      averageCadenceMs: 1000 / medianFps,
      medianCadenceMs: 1000 / medianFps,
      p95CadenceMs: 1000 / medianFps + 1,
      averageFps: medianFps,
      medianFps,
      metricsSource: 'sampler' as const,
      actualBackend: 'webgpu' as const,
      fallbackOccurred: false,
      terminalAdaptiveQuality: null,
    },
  });

  const aggregate = aggregateCertificationPerfTrials(
    [makeResult(14, 58), makeResult(10, 60), makeResult(12, 59)],
    'webgpu',
  );

  expect(aggregate.status).toBe('pass');
  expect(aggregate.successfulTrialCount).toBe(3);
  expect(aggregate.representativePerformance?.averageFrameMs).toBe(12);
  expect(aggregate.metrics).toEqual({
    medianAverageFrameMs: 12,
    minAverageFrameMs: 10,
    maxAverageFrameMs: 14,
    medianFps: 59,
  });
});

test('aggregateCertificationPerfTrials rejects incomplete evidence', () => {
  const aggregate = aggregateCertificationPerfTrials(
    [
      {
        slug: 'milkdrop',
        success: false,
        error: 'browser crashed',
      },
    ],
    'webgpu',
  );

  expect(aggregate.status).toBe('error');
  expect(aggregate.successfulTrialCount).toBe(0);
  expect(aggregate.representativePerformance).toBeNull();
});

test('aggregateCertificationPerfTrials rejects fatal browser runtime errors', () => {
  const measuredResult = {
    slug: 'milkdrop',
    success: true,
    fallbackOccurred: false,
    performance: {
      durationMs: 6000,
      warmupMs: 2000,
      sampleCount: 400,
      averageFrameMs: 10,
      p95FrameMs: 11,
      averageSimulationMs: 8,
      averageRenderMs: 2,
      averageCadenceMs: 16.7,
      medianCadenceMs: 16.7,
      p95CadenceMs: 17,
      averageFps: 60,
      medianFps: 60,
      metricsSource: 'sampler' as const,
      actualBackend: 'webgpu' as const,
      fallbackOccurred: false,
      terminalAdaptiveQuality: null,
    },
  };

  expect(
    aggregateCertificationPerfTrials(
      [
        {
          ...measuredResult,
          consoleErrors: [
            'GPUValidationError: Vertex range (1997 - 2047) requires a larger buffer',
          ],
        },
      ],
      'webgpu',
    ).status,
  ).toBe('error');
  expect(
    aggregateCertificationPerfTrials(
      [
        {
          ...measuredResult,
          consoleErrors: ['PageError: renderer exploded'],
        },
      ],
      'webgpu',
    ).status,
  ).toBe('error');
  expect(
    aggregateCertificationPerfTrials(
      [
        {
          ...measuredResult,
          consoleErrors: [
            'Failed to load resource: the server responded with a status of 404 (Not Found)',
          ],
        },
      ],
      'webgpu',
    ).status,
  ).toBe('pass');
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
      cpuThrottleRate: 1,
      rendererProfile: 'webgpu' as const,
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
      cpuThrottleRate: 1,
      rendererProfile: 'webgpu' as const,
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
      cpuThrottleRate: 1,
      rendererProfile: 'webgpu' as const,
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
      cpuThrottleRate: 1,
      rendererProfile: 'webgpu' as const,
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
