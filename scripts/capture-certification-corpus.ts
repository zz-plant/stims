import { spawn } from 'node:child_process';
import {
  type CertificationCorpusGroup,
  loadCertificationCorpusManifest,
} from './certification-corpus.ts';
import type { PlayToyOptions, PlayToyResult } from './play-toy.ts';

type CaptureCertificationCorpusOptions = {
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
      const str = data.toString();
      stdout += str;
      process.stdout.write(str);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`play-toy process exited with code ${code}`));
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
            `Failed to parse play-toy JSON output: ${errMessage}. Raw output length: ${stdout.length}`,
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
  const requests = buildCertificationCorpusCaptureRequests(options);
  const results = [];

  for (const request of requests) {
    results.push(await runPlayToyInChildProcess(request));
  }

  return {
    count: requests.length,
    results,
  };
}

function usage() {
  console.error(
    'Usage: bun scripts/capture-certification-corpus.ts [--output <dir>] [--port <number>] [--group <group>] [--preset <id>]...',
  );
}

function parseArgs(argv: string[]): CaptureCertificationCorpusOptions {
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
    vibeMode: !argv.includes('--no-vibe-mode'),
    presetIds: presetIds.length > 0 ? presetIds : undefined,
    corpusGroup,
    duration: getArg('--duration', 1500) as number,
    viewportWidth: getArg('--viewport-width', 1280) as number,
    viewportHeight: getArg('--viewport-height', 720) as number,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    usage();
    process.exit(0);
  }

  const options = parseArgs(args);
  const result = await captureCertificationCorpus(options);
  console.log(JSON.stringify(result, null, 2));
}
