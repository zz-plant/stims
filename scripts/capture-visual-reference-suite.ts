import { spawn } from 'node:child_process';
import os from 'node:os';
import type { PlayToyOptions, PlayToyResult } from './play-toy.ts';
import { loadVisualReferenceManifest } from './visual-reference-manifest.ts';

const DEFAULT_CONCURRENCY = Math.min(
  4,
  Math.max(1, (os.availableParallelism?.() ?? os.cpus()?.length ?? 4) - 1),
);

export type CaptureVisualReferenceSuiteOptions = {
  repoRoot: string;
  outputDir: string;
  port: number;
  headless: boolean;
  vibeMode: boolean;
  presetIds?: string[];
  rendererProfile?: 'compatibility' | 'webgpu';
  concurrency?: number;
};

type VisualReferenceCaptureRequest = Required<
  Pick<
    PlayToyOptions,
    | 'slug'
    | 'audioMode'
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

export function buildVisualReferenceCaptureRequests({
  repoRoot,
  outputDir,
  port,
  headless,
  vibeMode,
  presetIds,
  rendererProfile,
}: CaptureVisualReferenceSuiteOptions): VisualReferenceCaptureRequest[] {
  const manifest = loadVisualReferenceManifest(repoRoot);
  const presetFilter = presetIds ? new Set(presetIds) : null;

  return manifest.presets
    .filter((preset) => !presetFilter || presetFilter.has(preset.id))
    .map((preset) => ({
      slug: 'milkdrop',
      audioMode: 'none',
      presetId: preset.id,
      port,
      duration: preset.capture.warmupMs + preset.capture.captureOffsetMs,
      viewportWidth: preset.capture.width,
      viewportHeight: preset.capture.height,
      screenshot: true,
      debugSnapshot: true,
      outputDir,
      headless,
      vibeMode,
      rendererProfile:
        rendererProfile ??
        (preset.capture.requiredBackend === 'webgpu'
          ? 'webgpu'
          : 'compatibility'),
      catalogMode: 'certification',
      screenshotSurface: 'canvas',
    }));
}

function runPlayToyInChildProcess(
  request: VisualReferenceCaptureRequest,
  label: string,
): Promise<PlayToyResult> {
  return new Promise((resolve, reject) => {
    const args = [
      'run',
      'scripts/play-toy.ts',
      request.slug,
      '--preset',
      request.presetId,
      '--audio',
      request.audioMode,
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
      const str = data.toString();
      stdout += str;
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

export function assertVisualReferenceCaptureSucceeded(
  result: PlayToyResult,
): PlayToyResult {
  if (!result.success) {
    throw new Error(
      `Capture failed for ${result.slug}: ${result.error ?? 'unknown error'}`,
    );
  }
  if (result.consoleErrors?.length) {
    throw new Error(
      `Capture failed for ${result.slug}: browser reported ${result.consoleErrors.length} console error(s): ${result.consoleErrors[0]}`,
    );
  }
  return result;
}

export async function captureVisualReferenceSuite(
  options: CaptureVisualReferenceSuiteOptions,
) {
  const requests = buildVisualReferenceCaptureRequests(options);
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
        results[index] = assertVisualReferenceCaptureSucceeded(result);
      } catch (error) {
        results[index] = {
          slug: request.slug,
          success: false,
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
    'Usage: bun scripts/capture-visual-reference-suite.ts [--output <dir>] [--port <number>] [--preset <id>]... [--force-webgl|--force-webgpu] [--concurrency <n>]',
  );
}

export function parseVisualReferenceCaptureArgs(
  argv: string[],
): CaptureVisualReferenceSuiteOptions {
  const getArg = (name: string, fallback: string | number) => {
    const idx = argv.indexOf(name);
    if (idx !== -1 && idx + 1 < argv.length) {
      const val = argv[idx + 1];
      return typeof fallback === 'number' ? parseInt(val, 10) : val;
    }
    return fallback;
  };

  const presetIds = argv.flatMap((arg, index) =>
    arg === '--preset' && argv[index + 1] ? [argv[index + 1] ?? ''] : [],
  );
  if (argv.includes('--force-webgl') && argv.includes('--force-webgpu')) {
    throw new Error('--force-webgl and --force-webgpu cannot be combined.');
  }

  return {
    repoRoot: process.cwd(),
    outputDir: getArg('--output', './screenshots/parity') as string,
    port: getArg('--port', 5173) as number,
    headless: !argv.includes('--no-headless'),
    vibeMode: false,
    presetIds: presetIds.length > 0 ? presetIds : undefined,
    rendererProfile: argv.includes('--force-webgl')
      ? 'compatibility'
      : argv.includes('--force-webgpu')
        ? 'webgpu'
        : undefined,
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

  const options = parseVisualReferenceCaptureArgs(args);
  try {
    const result = await captureVisualReferenceSuite(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `Capture suite failed: ${rawMessage}\n` +
        `Check that the dev server is running on port ${options.port} (bun run dev) and the browser is available.`,
    );
    process.exit(1);
  }
}
