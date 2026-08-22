/**
 * Captures Stims screenshots for every preset in the visual reference
 * manifest.
 *
 * Capture stage of the parity pipeline (capture -> diff -> promote). Ensures
 * the dev server is up, then walks the manifest presets on one reused browser,
 * using each preset's warmup/capture-offset timing, viewport and required
 * backend, writing canvas PNGs plus debug snapshots into the parity artifact
 * directory that diff-parity-artifacts.ts and run-parity-diff-suite.ts consume.
 *
 * The browser is opened once, not once per preset: measured over the nine
 * certified presets, that is 35s against a process-per-preset run that had not
 * finished in 9 minutes. `--isolate-captures` restores the old behaviour.
 *
 *   bun run parity:capture -- [--preset <id>]... [--output <dir>] [--port <n>]
 *
 * Captures run one at a time. `--concurrency <n>` opts into a worker pool and
 * warns, because parallel captures corrupt frames (measured: 100-square scored
 * 1.30-1.81% serially and 17.24%/34.97% at concurrency 4).
 * `--force-webgl`/`--force-webgpu` override the manifest's required backend —
 * mutually exclusive, and rejected before any capture runs unless
 * `--allow-backend-override` is passed — and `--no-headless` shows the browser.
 */
import { spawn } from 'node:child_process';
import { ensureDevServer } from './dev-server.ts';
import { loadParityArtifactManifest } from './parity-artifacts.ts';
import {
  closePlayToyBrowserSession,
  createPlayToyBrowserSession,
  type PlayToyBrowserSession,
  type PlayToyOptions,
  type PlayToyResult,
  playToy,
} from './play-toy.ts';
import { loadVisualReferenceManifest } from './visual-reference-manifest.ts';

/**
 * Captures run one at a time.
 *
 * Parallel captures do not just run slower, they produce different pictures.
 * Measured on this machine across three passes of the nine certified presets:
 * 100-square scored 1.30/1.31/1.81% serially and 1.30/17.24/34.97% at
 * concurrency 4; 250-wavecode 0.50/0.50/1.13% against 0.51/3.02/4.24%.
 * Two mechanisms, both driven by the host being busy: Chromium instances
 * contend for the GPU and lose their device mid-run, and the pre-capture
 * transition settle loop burns a variable number of frames (0 on every serial
 * capture, up to 180 at concurrency 4) so the pump lands on a different frame
 * of the preset's evolution.
 */
const DEFAULT_CONCURRENCY = 1;

export type CaptureVisualReferenceSuiteOptions = {
  repoRoot: string;
  outputDir: string;
  port: number;
  headless: boolean;
  vibeMode: boolean;
  presetIds?: string[];
  rendererProfile?: 'compatibility' | 'webgpu';
  concurrency?: number;
  /** Permit `--force-webgl`/`--force-webgpu` to contradict a certified backend. */
  allowBackendOverride?: boolean;
  /**
   * Spawn a fresh `bun scripts/play-toy.ts` per preset instead of reusing one
   * browser. Costs ~60s per preset; buys total isolation. Worth it only when
   * a capture is suspected of contaminating the next one.
   */
  isolateCaptures?: boolean;
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
    | 'deterministicFrames'
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
      deterministicFrames: preset.capture.warmupFrames,
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

/**
 * Pull play-toy's trailing JSON payload out of its stdout.
 *
 * Was `stdout.lastIndexOf('{')`, which lands inside the payload whenever a
 * console error it reports contains a brace — "WebGPU device lost: unknown
 * {reason: unknown}" did exactly that, so a run that failed for a real,
 * stated reason surfaced as an unparseable-output error instead. Walk the
 * candidate starts from the end and take the first one that parses.
 */
export function parsePlayToyStdout(stdout: string): PlayToyResult {
  const starts: number[] = [];
  for (let index = stdout.indexOf('{'); index !== -1; ) {
    starts.push(index);
    index = stdout.indexOf('{', index + 1);
  }
  if (starts.length === 0) {
    throw new Error('No JSON output found');
  }
  let lastError: unknown = null;
  for (const start of starts.reverse()) {
    try {
      return JSON.parse(stdout.slice(start)) as PlayToyResult;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error('No JSON output found');
}

/**
 * Run one capture on an already-open browser.
 *
 * The suite used to spawn `bun scripts/play-toy.ts` per preset, which pays for
 * a Bun start, a Chromium launch and a cold dev-server transform on every
 * preset. Measured on the nine certified presets, that overhead is ~98% of the
 * run: the part that actually matters — pumping 900 deterministic frames — is
 * about 1.5s on hardware WebGPU against 60-90s of wall clock per preset.
 *
 * Reusing the browser is only sound because captures are already deterministic
 * by construction: `deterministicFrames` pumps a fixed frame count through
 * `renderFrames({ startTime: 0 })`, which resets the simulation clock and
 * clears feedback history, so preset N+1 cannot inherit preset N's warp
 * buffer. Without that reset this would be a correctness bug, not a speedup.
 */
function runPlayToyInProcess(
  request: VisualReferenceCaptureRequest,
  browserSession: PlayToyBrowserSession,
): Promise<PlayToyResult> {
  return playToy({
    slug: request.slug,
    presetId: request.presetId,
    audioMode: request.audioMode,
    port: request.port,
    duration: request.duration,
    deterministicFrames: request.deterministicFrames,
    // Pin the quality ladder, exactly as the child-process argv did. Adaptive
    // quality reacts to frame time, so a capture taken while the machine is
    // busy renders at a different scale than one taken idle.
    lockedQualityStep: 0,
    viewportWidth: request.viewportWidth,
    viewportHeight: request.viewportHeight,
    outputDir: request.outputDir,
    rendererProfile: request.rendererProfile,
    catalogMode: request.catalogMode,
    screenshotSurface: request.screenshotSurface,
    headless: request.headless,
    vibeMode: request.vibeMode,
    debugSnapshot: request.debugSnapshot,
    screenshot: true,
    video: false,
    browserSession,
  });
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
      // Frames, not milliseconds: the reference is one frame of the preset's
      // evolution, and a wall-clock wait lands on a different frame on every
      // backend — 631 frames on hardware WebGPU against 47 on software WebGL,
      // measured on the same preset.
      '--deterministic-frames',
      String(request.deterministicFrames),
      // Pin the quality ladder. Adaptive quality reacts to frame time, so a
      // capture taken while the machine is busy — several presets captured
      // at once, say — renders at a different scale than one taken idle, and
      // the same preset scored 0.48% and 96.75% against its reference in the
      // two cases.
      '--lock-quality-step',
      '0',
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
        const result = parsePlayToyStdout(stdout);
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

/**
 * Reject a forced backend that contradicts a certified preset before spending
 * a capture on it.
 *
 * The diff suite already catches this, but only after every capture has run
 * and only as a per-preset `backend-mismatch` line in a summary — minutes of
 * GPU time to learn that a flag was wrong. The check is a string comparison
 * against the manifest, so it costs nothing to do first.
 */
export function assertForcedBackendMatchesManifest({
  repoRoot,
  presetIds,
  rendererProfile,
  allowBackendOverride,
}: Pick<
  CaptureVisualReferenceSuiteOptions,
  'repoRoot' | 'presetIds' | 'rendererProfile' | 'allowBackendOverride'
>) {
  if (!rendererProfile || allowBackendOverride) {
    return;
  }
  const forcedBackend = rendererProfile === 'webgpu' ? 'webgpu' : 'webgl';
  const forcingFlag =
    rendererProfile === 'webgpu' ? '--force-webgpu' : '--force-webgl';
  const manifest = loadVisualReferenceManifest(repoRoot);
  const presetFilter = presetIds ? new Set(presetIds) : null;
  const conflicting = manifest.presets.filter(
    (preset) =>
      (!presetFilter || presetFilter.has(preset.id)) &&
      preset.capture.requiredBackend !== forcedBackend,
  );
  if (conflicting.length === 0) {
    return;
  }
  const requiredFlag =
    conflicting[0].capture.requiredBackend === 'webgpu'
      ? '--force-webgpu'
      : '--force-webgl';
  const sample = conflicting
    .slice(0, 5)
    .map((preset) => `${preset.id} (${preset.capture.requiredBackend})`)
    .join(', ');
  throw new Error(
    `${forcingFlag} would capture ${conflicting.length} preset(s) on ${forcedBackend.toUpperCase()}, ` +
      `but their certified reference requires the other backend: ${sample}` +
      `${conflicting.length > 5 ? ', ...' : ''}. ` +
      `A capture on the wrong backend can only ever report backend-mismatch. ` +
      `Drop the flag to use each preset's certified backend, pass ${requiredFlag} instead, ` +
      `select matching presets with --preset, or pass --allow-backend-override to capture anyway.`,
  );
}

/**
 * Fail a capture whose actual backend is not the certified one.
 *
 * A WebGPU capture that quietly fell back to WebGL is not a WebGL capture of
 * record — it is a run whose device went away — and the diff suite would have
 * reported it as `backend-mismatch` after the whole batch finished.
 */
export function assertCaptureBackendMatches({
  presetId,
  requiredBackend,
  actualBackend,
}: {
  presetId: string;
  requiredBackend: 'webgl' | 'webgpu';
  actualBackend: 'webgl' | 'webgpu' | null;
}) {
  if (actualBackend === requiredBackend) {
    return;
  }
  const requiredFlag =
    requiredBackend === 'webgpu' ? '--force-webgpu' : '--force-webgl';
  throw new Error(
    `Capture for "${presetId}" ran on ${
      actualBackend ? actualBackend.toUpperCase() : 'an unrecorded backend'
    } but its certified reference requires ${requiredBackend.toUpperCase()}. ` +
      `Re-run with ${requiredFlag} on a host where that backend is available, ` +
      `or re-certify the reference for the backend you can actually run.`,
  );
}

function latestCaptureBackend(outputDir: string, presetId: string) {
  const artifacts = loadParityArtifactManifest(outputDir).artifacts.filter(
    (entry) => entry.kind === 'stims-capture' && entry.presetId === presetId,
  );
  return artifacts[artifacts.length - 1]?.capture?.backend ?? null;
}

export async function captureVisualReferenceSuite(
  options: CaptureVisualReferenceSuiteOptions,
) {
  assertForcedBackendMatchesManifest(options);
  const server = await ensureDevServer(options.port, options.repoRoot);
  const requests = buildVisualReferenceCaptureRequests(options);
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  if (concurrency > 1) {
    console.warn(
      `[parity:capture] Running ${concurrency} captures at once. Frames captured under ` +
        `GPU contention are not trustworthy evidence: parallel Chromium instances lose their ` +
        `device mid-run and the transition settle loop burns a variable number of frames, so ` +
        `the capture lands on a different frame of the preset. Measured on this corpus, ` +
        `100-square scored 1.30-1.81% serially and 17.24%/34.97% at concurrency 4. ` +
        `Drop --concurrency before believing any number this produces.`,
    );
  }
  const results: PlayToyResult[] = new Array(requests.length);
  const errors: Error[] = [];

  let nextIndex = 0;
  async function worker() {
    // One browser per worker, opened on the first request and reused for the
    // rest. Held here rather than hoisted to the suite so a pool of workers
    // still gets one browser each instead of sharing one.
    let browserSession: PlayToyBrowserSession | null = null;
    const releaseSession = async () => {
      const session = browserSession;
      browserSession = null;
      if (session) {
        await closePlayToyBrowserSession(session).catch(() => {});
      }
    };

    try {
      while (nextIndex < requests.length) {
        const index = nextIndex++;
        const request = requests[index];
        try {
          let result: PlayToyResult;
          if (options.isolateCaptures) {
            result = await runPlayToyInChildProcess(
              request,
              `${request.presetId} (${index + 1}/${requests.length})`,
            );
          } else {
            if (!browserSession) {
              browserSession = await createPlayToyBrowserSession({
                headless: request.headless,
                rendererProfile: request.rendererProfile,
              });
            }
            try {
              result = await runPlayToyInProcess(request, browserSession);
            } catch (error) {
              // A lost GPU device kills the browser, not just this capture.
              // Drop it so the next preset opens a fresh one rather than
              // failing the whole remaining manifest against a dead handle.
              await releaseSession();
              throw error;
            }
          }
          results[index] = assertVisualReferenceCaptureSucceeded(result);
          if (!options.allowBackendOverride) {
            assertCaptureBackendMatches({
              presetId: request.presetId,
              requiredBackend:
                request.rendererProfile === 'webgpu' ? 'webgpu' : 'webgl',
              actualBackend: latestCaptureBackend(
                request.outputDir,
                request.presetId,
              ),
            });
          }
        } catch (error) {
          results[index] = {
            slug: request.slug,
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
          errors.push(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    } finally {
      await releaseSession();
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
    'Usage: bun scripts/capture-visual-reference-suite.ts [--output <dir>] [--port <number>] [--preset <id>]... [--force-webgl|--force-webgpu] [--allow-backend-override] [--concurrency <n>]',
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
    allowBackendOverride: argv.includes('--allow-backend-override'),
    isolateCaptures: argv.includes('--isolate-captures'),
    // Left undefined when the flag is absent so the serial default applies.
    // This used to fill in a pool size unconditionally, which defeated the
    // suite's own "WebGPU captures run one at a time" default: it was
    // reachable from library callers and never from the command line, so
    // every `parity:capture` run went four wide.
    concurrency: (() => {
      if (!argv.includes('--concurrency')) {
        return undefined;
      }
      const parsed = Number.parseInt(
        getArg('--concurrency', '1') as string,
        10,
      );
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
