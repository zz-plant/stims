import { spawn } from 'node:child_process';
import os from 'node:os';
import { DEFAULT_VIEWPORT } from '../src/viewport-config.ts';
import {
  type CertificationCorpusGroup,
  loadCertificationCorpusManifest,
} from './certification-corpus.ts';
import { ensureDevServer } from './dev-server.ts';
import type { PlayToyOptions, PlayToyResult } from './play-toy.ts';

// Corpus captures render through SwiftShader (CPU) for determinism, so the
// worker count is CPU-bound. CI's small runner keeps the old cap of 4;
// locally the cap is 8 so a many-core machine actually gets used.
const DEFAULT_CONCURRENCY = Math.min(
  process.env.CI ? 4 : 8,
  Math.max(1, (os.availableParallelism?.() ?? os.cpus()?.length ?? 4) - 1),
);

export type CaptureCertificationCorpusOptions = {
  repoRoot: string;
  outputDir: string;
  port: number;
  headless: boolean;
  vibeMode: boolean;
  presetIds?: string[];
  corpusGroup?: CertificationCorpusGroup;
  duration: number;
  viewportWidth: number;
  viewportHeight: number;
  concurrency?: number;
};

type CertificationCorpusCaptureRequest = Required<
  Pick<
    PlayToyOptions,
    | 'slug'
    | 'presetId'
    | 'port'
    | 'duration'
    | 'viewportWidth'
    | 'viewportHeight'
    | 'screenshot'
    | 'debugSnapshot'
    | 'outputDir'
    | 'headless'
    | 'vibeMode'
    | 'rendererProfile'
    | 'catalogMode'
    | 'screenshotSurface'
  >
>;

export function buildCertificationCorpusCaptureRequests({
  repoRoot,
  outputDir,
  port,
  headless,
  vibeMode,
  presetIds,
  corpusGroup,
  duration,
  viewportWidth,
  viewportHeight,
}: CaptureCertificationCorpusOptions): CertificationCorpusCaptureRequest[] {
  const manifest = loadCertificationCorpusManifest(repoRoot);
  const presetFilter = presetIds ? new Set(presetIds) : null;

  return manifest.presets
    .filter((preset) => !corpusGroup || preset.corpusGroup === corpusGroup)
    .filter((preset) => !presetFilter || presetFilter.has(preset.id))
    .map((preset) => ({
      slug: 'milkdrop',
      presetId: preset.id,
      port,
      duration,
      viewportWidth,
      viewportHeight,
      screenshot: true,
      debugSnapshot: true,
      outputDir,
      headless,
      vibeMode,
      rendererProfile:
        preset.requiredBackend === 'webgpu' ? 'webgpu' : 'compatibility',
      catalogMode: 'certification',
      screenshotSurface: 'canvas',
    }));
}

function runPlayToyInChildProcess(
  request: CertificationCorpusCaptureRequest,
  label: string,
): Promise<PlayToyResult> {
  return new Promise((resolve, reject) => {
    const args = [
      'run',
      'scripts/play-toy.ts',
      request.slug,
      '--preset',
      request.presetId,
      '--port',
      String(request.port),
      '--duration',
      String(request.duration),
      '--width',
      String(request.viewportWidth),
      '--height',
      String(request.viewportHeight),
      '--output',
      request.outputDir,
      '--renderer-profile',
      request.rendererProfile,
      '--catalog-mode',
      request.catalogMode,
      '--screenshot-surface',
      request.screenshotSurface,
    ];

    if (!request.headless) {
      args.push('--no-headless');
    }
    if (!request.vibeMode) {
      args.push('--no-vibe-mode');
    }
    if (request.debugSnapshot) {
      args.push('--debug-snapshot');
    }

    const proc = spawn('bun', args, { stdio: ['ignore', 'pipe', 'inherit'] });
    let stdout = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.on('close', (code) => {
      if (stdout) {
        console.log(`\n[${label}] stdout:\n${stdout}`);
      }
      if (code !== 0) {
        reject(
          new Error(`play-toy process for "${label}" exited with code ${code}`),
        );
        return;
      }

      try {
        const jsonStart = stdout.lastIndexOf('{');
        if (jsonStart === -1) {
          throw new Error('No JSON output found');
        }
        const jsonStr = stdout.substring(jsonStart);
        const result = JSON.parse(jsonStr);
        resolve(result);
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        reject(
          new Error(
            `Failed to parse play-toy JSON output for "${label}": ${errMessage}. Raw output length: ${stdout.length}`,
          ),
        );
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

export async function captureCertificationCorpus(
  options: CaptureCertificationCorpusOptions,
) {
  const server = await ensureDevServer(options.port, options.repoRoot);
  const requests = buildCertificationCorpusCaptureRequests(options);
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const results: PlayToyResult[] = new Array(requests.length);
  const errors: Error[] = [];

  let nextIndex = 0;
  async function worker() {
    while (nextIndex < requests.length) {
      const index = nextIndex++;
      const request = requests[index];
      try {
        const result = await runPlayToyInChildProcess(
          request,
          `${request.presetId} (${index + 1}/${requests.length})`,
        );
        results[index] = result;
      } catch (error) {
        results[index] = {
          slug: request.slug,
          success: false,
          presetId: request.presetId,
          error: error instanceof Error ? error.message : String(error),
        };
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, requests.length) },
    () => worker(),
  );
  await Promise.all(workers);

  server.close();

  if (errors.length > 0) {
    throw errors[0];
  }

  return {
    count: requests.length,
    results,
  };
}

function usage() {
  console.error(
    'Usage: bun scripts/capture-certification-corpus.ts [--output <dir>] [--port <number>] [--group <group>] [--preset <id>]... [--concurrency <n>]',
  );
}

export function parseCertificationCorpusArgs(
  argv: string[],
): CaptureCertificationCorpusOptions {
  const getArg = (name: string, fallback: string | number) => {
    const idx = argv.indexOf(name);
    if (idx !== -1 && idx + 1 < argv.length) {
      const value = argv[idx + 1];
      return typeof fallback === 'number' ? parseInt(value, 10) : value;
    }
    return fallback;
  };

  const presetIds = argv.flatMap((arg, index) =>
    arg === '--preset' && argv[index + 1] ? [argv[index + 1] ?? ''] : [],
  );
  const groupArg = getArg('--group', '') as string;
  const corpusGroup = groupArg.trim()
    ? (groupArg as CertificationCorpusGroup)
    : undefined;

  return {
    repoRoot: process.cwd(),
    outputDir: getArg('--output', './screenshots/parity') as string,
    port: getArg('--port', 5173) as number,
    headless: !argv.includes('--no-headless'),
    vibeMode: false,
    presetIds: presetIds.length > 0 ? presetIds : undefined,
    corpusGroup,
    duration: getArg('--duration', 1500) as number,
    viewportWidth: getArg('--viewport-width', DEFAULT_VIEWPORT.width) as number,
    viewportHeight: getArg(
      '--viewport-height',
      DEFAULT_VIEWPORT.height,
    ) as number,
    concurrency: (() => {
      const raw = getArg(
        '--concurrency',
        String(DEFAULT_CONCURRENCY),
      ) as string;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed >= 1
        ? parsed
        : DEFAULT_CONCURRENCY;
    })(),
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    usage();
    process.exit(0);
  }

  const options = parseCertificationCorpusArgs(args);
  const result = await captureCertificationCorpus(options);
  console.log(JSON.stringify(result, null, 2));
}
