import { type PlayToyOptions, playToy } from './play-toy.ts';
import { loadVisualReferenceManifest } from './visual-reference-manifest.ts';

type CaptureVisualReferenceSuiteOptions = {
  repoRoot: string;
  outputDir: string;
  port: number;
  headless: boolean;
  vibeMode: boolean;
  presetIds?: string[];
};

type VisualReferenceCaptureRequest = Required<
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
  >
>;

export function buildVisualReferenceCaptureRequests({
  repoRoot,
  outputDir,
  port,
  headless,
  vibeMode,
  presetIds,
}: CaptureVisualReferenceSuiteOptions): VisualReferenceCaptureRequest[] {
  const manifest = loadVisualReferenceManifest(repoRoot);
  const presetFilter = presetIds ? new Set(presetIds) : null;

  return manifest.presets
    .filter((preset) => !presetFilter || presetFilter.has(preset.id))
    .map((preset) => ({
      slug: 'milkdrop',
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
      rendererProfile: 'webgpu',
      catalogMode: 'certification',
    }));
}

export async function captureVisualReferenceSuite(
  options: CaptureVisualReferenceSuiteOptions,
) {
  const requests = buildVisualReferenceCaptureRequests(options);
  const results = [];

  for (const request of requests) {
    results.push(await playToy(request));
  }

  return {
    count: requests.length,
    results,
  };
}

function usage() {
  console.error(
    'Usage: bun scripts/capture-visual-reference-suite.ts [--output <dir>] [--port <number>] [--preset <id>]...',
  );
}

function parseArgs(argv: string[]): CaptureVisualReferenceSuiteOptions {
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

  return {
    repoRoot: process.cwd(),
    outputDir: getArg('--output', './screenshots/parity') as string,
    port: getArg('--port', 5173) as number,
    headless: !argv.includes('--no-headless'),
    vibeMode: !argv.includes('--no-vibe-mode'),
    presetIds: presetIds.length > 0 ? presetIds : undefined,
  };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    usage();
    process.exit(0);
  }

  const options = parseArgs(args);
  const result = await captureVisualReferenceSuite(options);
  console.log(JSON.stringify(result, null, 2));
}
