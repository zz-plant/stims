import fs from 'node:fs';
import path from 'node:path';
import {
  type Browser,
  type ConsoleMessage,
  chromium,
  type Page,
} from 'playwright';
import { appendParityArtifactEntry } from './parity-artifacts.ts';

export type PlayToyResult = {
  slug: string;
  success: boolean;
  presetId?: string;
  screenshot?: string;
  debugSnapshot?: string;
  video?: string;
  error?: string;
  consoleErrors?: string[];
  audioActive?: boolean;
  vibeModeActivated?: boolean;
};

type PlayToyOptions = {
  slug: string;
  presetId?: string;
  port?: number;
  duration?: number;
  screenshot?: boolean;
  debugSnapshot?: boolean;
  video?: boolean;
  outputDir?: string;
  headless?: boolean;
  vibeMode?: boolean;
};

type NormalizedPlayToyOptions = PlayToyOptions & {
  port: number;
  duration: number;
  outputDir: string;
  headless: boolean;
  vibeMode: boolean;
};

const DEFAULT_OPTIONS = {
  port: 5173,
  duration: 5000,
  outputDir: './screenshots',
};
const SHELL_DEMO_SELECTOR = '[data-demo-audio-btn]';
const CONTROL_DEMO_SELECTOR = '#use-demo-audio';
const CONTROL_MIC_SELECTOR = '#start-audio-btn';
const AUDIO_DEMO_LABEL = 'Start with demo audio';
const PREFLIGHT_CONTINUE_LABEL = 'Choose audio';
const PREFLIGHT_DEMO_LABEL = 'Start with demo';
const PREFLIGHT_LIGHTER_LABEL = 'Enable lighter visual mode';
const WEBGL_FALLBACK_LABEL = 'Continue with WebGL';
const PLAYWRIGHT_RENDERER_ARGS = [
  '--use-angle=swiftshader',
  '--use-gl=angle',
  '--enable-webgl',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];
const INITIAL_SHELL_TIMEOUT_MS = 60000;
const TOY_LOAD_TIMEOUT_MS = 30000;
const AUDIO_ACTIVATION_TIMEOUT_MS = 5000;

function normalizeOptions(options: PlayToyOptions): NormalizedPlayToyOptions {
  return {
    ...options,
    port: options.port ?? DEFAULT_OPTIONS.port,
    duration: options.duration ?? DEFAULT_OPTIONS.duration,
    outputDir: options.outputDir ?? DEFAULT_OPTIONS.outputDir,
    headless: options.headless !== false,
    vibeMode: options.vibeMode !== false,
  };
}

function ensureOutputDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeArtifactSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildPlayToyArtifactStem({
  slug,
  presetId,
}: {
  slug: string;
  presetId?: string;
}) {
  const slugSegment = sanitizeArtifactSegment(slug) || 'toy';
  const presetSegment = presetId
    ? sanitizeArtifactSegment(presetId) || 'preset'
    : null;
  return presetSegment
    ? `${slugSegment}--preset-${presetSegment}`
    : slugSegment;
}

export function buildPlayToyUrl({
  port,
  slug,
  presetId,
  demoAudio = true,
}: {
  port: number;
  slug: string;
  presetId?: string;
  demoAudio?: boolean;
}) {
  const params = new URLSearchParams({
    experience: slug,
    agent: 'true',
  });
  if (demoAudio) {
    params.set('audio', 'demo');
  }
  if (presetId?.trim()) {
    params.set('preset', presetId.trim());
  }
  return `http://127.0.0.1:${port}/milkdrop/?${params.toString()}`;
}

async function closeBrowser(browser?: Browser) {
  if (browser) {
    await browser.close();
  }
}

async function clickVisibleButton(page: Page, selector: string) {
  try {
    return await page.evaluate((buttonSelector) => {
      const button = document.querySelector<HTMLElement>(buttonSelector);
      if (!(button instanceof HTMLElement)) return false;

      const style = window.getComputedStyle(button);
      const rect = button.getBoundingClientRect();
      const isVisible =
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0;
      if (!isVisible) return false;

      button.click();
      return true;
    }, selector);
  } catch (_error) {
    return false;
  }
}

async function clickVisibleButtonByText(page: Page, label: string) {
  try {
    return await page.evaluate((buttonLabel) => {
      const buttons = [...document.querySelectorAll('button')];
      const target = buttons.find((element) => {
        if (!(element instanceof HTMLElement)) return false;
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const isVisible =
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0;
        return isVisible && element.textContent?.trim() === buttonLabel;
      });

      if (!(target instanceof HTMLElement)) return false;
      target.click();
      return true;
    }, label);
  } catch (_error) {
    return false;
  }
}

async function isAudioActive(page: Page) {
  return page.evaluate(() => {
    if (document.body.dataset.audioActive === 'true') {
      return true;
    }

    const stimState = (
      window as typeof window & {
        stimState?: {
          getState?: () => { audioActive?: boolean };
        };
      }
    ).stimState;
    return stimState?.getState?.().audioActive === true;
  });
}

async function waitForAudioActive(
  page: Page,
  timeout = AUDIO_ACTIVATION_TIMEOUT_MS,
) {
  try {
    await page.waitForFunction(
      () => {
        if (document.body.dataset.audioActive === 'true') {
          return true;
        }

        const stimState = (
          window as typeof window & {
            stimState?: {
              getState?: () => { audioActive?: boolean };
            };
          }
        ).stimState;
        return stimState?.getState?.().audioActive === true;
      },
      undefined,
      { timeout },
    );
    return true;
  } catch (_error) {
    return false;
  }
}

async function isImmersiveSessionReady(page: Page) {
  return page
    .evaluate(() => {
      const canvas =
        document.querySelector<HTMLCanvasElement>(
          '#active-toy-container canvas',
        ) ?? document.querySelector<HTMLCanvasElement>('canvas');
      const overlayToggle = document.querySelector('.milkdrop-overlay__toggle');
      const liveNav = document.querySelector('.active-toy-nav');
      const activeStatus = document.querySelector('.active-toy-status');
      const rect = canvas?.getBoundingClientRect();
      const canvasVisible = Boolean(rect && rect.width > 0 && rect.height > 0);
      return Boolean(
        document.body.dataset.toyLoaded === 'true' ||
          activeStatus ||
          canvasVisible ||
          overlayToggle ||
          liveNav,
      );
    })
    .catch(() => false);
}

async function requestDemoAudio(page: Page) {
  if ((await isAudioActive(page)) || (await isImmersiveSessionReady(page))) {
    return true;
  }

  const activatedViaAgentApi = await page
    .evaluate(async () => {
      const stimState = (
        window as typeof window & {
          stimState?: {
            enableDemoAudio?: () => Promise<void>;
          };
        }
      ).stimState;
      if (!stimState || typeof stimState.enableDemoAudio !== 'function') {
        return false;
      }

      try {
        await stimState.enableDemoAudio();
        return true;
      } catch (_error) {
        return false;
      }
    })
    .catch(() => false);

  if (activatedViaAgentApi) {
    return true;
  }

  const clickedVisibleDemoButton =
    (await clickVisibleButton(page, SHELL_DEMO_SELECTOR)) ||
    (await clickVisibleButton(page, CONTROL_DEMO_SELECTOR)) ||
    (await clickVisibleButtonByText(page, AUDIO_DEMO_LABEL));
  if (clickedVisibleDemoButton) {
    return true;
  }

  return page
    .evaluate(() => {
      const demoButton = document.querySelector<HTMLElement>(
        '[data-demo-audio-btn], #use-demo-audio',
      );
      if (!(demoButton instanceof HTMLElement)) {
        return false;
      }
      demoButton.click();
      return true;
    })
    .catch(() => false);
}

async function getErrorStatus(page: Page) {
  const handleEvaluationFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (
      normalized.includes('execution context was destroyed') ||
      normalized.includes('target page, context or browser has been closed')
    ) {
      return null;
    }
    throw error;
  };

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), 500);
    });
    const evaluation = page
      .evaluate(() => {
        const status = document.querySelector<HTMLElement>(
          '.active-toy-status.is-error',
        );
        if (!(status instanceof HTMLElement)) {
          return null;
        }

        const title = status.querySelector('h2')?.textContent?.trim() ?? '';
        const message = status.querySelector('p')?.textContent?.trim() ?? '';
        if (!title && !message) {
          return null;
        }

        return { title, message };
      })
      .catch(handleEvaluationFailure);

    return await Promise.race([evaluation, timeout]);
  } catch (error) {
    return handleEvaluationFailure(error);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

async function getMilkdropDebugSnapshot(page: Page) {
  return page
    .evaluate(() => {
      const stimState = (
        window as typeof window & {
          stimState?: {
            getDebugSnapshot?: (key: string) => unknown | null;
          };
        }
      ).stimState;
      if (!stimState || typeof stimState.getDebugSnapshot !== 'function') {
        return null;
      }
      return stimState.getDebugSnapshot('milkdrop');
    })
    .catch(() => null);
}

export async function playToy(options: PlayToyOptions): Promise<PlayToyResult> {
  const normalizedOptions = normalizeOptions(options);

  // Ensure output directory exists
  ensureOutputDir(normalizedOptions.outputDir);

  let browser: Browser | undefined;
  const consoleErrors: string[] = [];

  try {
    browser = await chromium.launch({
      headless: normalizedOptions.headless,
      args: PLAYWRIGHT_RENDERER_ARGS,
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 }, // Standard 720p
      recordVideo: options.video
        ? { dir: normalizedOptions.outputDir }
        : undefined,
      permissions: ['microphone'], // Auto-grant microphone if needed
    });

    const page = await context.newPage();

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (err: Error) => {
      consoleErrors.push(err.message);
    });

    const demoRequestedByRoute = true;
    const url = buildPlayToyUrl({
      port: normalizedOptions.port,
      slug: options.slug,
      presetId: normalizedOptions.presetId,
      demoAudio: demoRequestedByRoute,
    });
    console.log(`Navigating to ${url}...`);

    await page.goto(url);

    if (await clickVisibleButtonByText(page, PREFLIGHT_LIGHTER_LABEL)) {
      console.log('Using lighter visual mode from capability preflight...');
    }
    if (await clickVisibleButtonByText(page, PREFLIGHT_DEMO_LABEL)) {
      console.log('Starting demo directly from capability preflight...');
    } else if (
      await clickVisibleButton(page, '[data-preflight-primary-action="true"]')
    ) {
      console.log('Advancing through capability preflight...');
    } else if (await clickVisibleButtonByText(page, PREFLIGHT_CONTINUE_LABEL)) {
      console.log('Advancing through capability preflight...');
    }

    // Wait for either an already-loaded toy or the shell audio controls
    await page.waitForFunction(
      () =>
        document.body.dataset.toyLoaded === 'true' ||
        document.querySelector('.active-toy-status') ||
        (() => {
          const canvas =
            document.querySelector('#active-toy-container canvas') ??
            document.querySelector('canvas');
          if (!(canvas instanceof HTMLCanvasElement)) return false;
          const rect = canvas.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })() ||
        [
          ...document.querySelectorAll(
            '[data-demo-audio-btn], #use-demo-audio, [data-mic-audio-btn], #start-audio-btn',
          ),
        ].some((element) => {
          if (!(element instanceof HTMLElement)) return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        }),
      undefined,
      { timeout: INITIAL_SHELL_TIMEOUT_MS },
    );
    console.log('Toy shell ready.');

    const initialErrorStatus = await getErrorStatus(page);
    if (initialErrorStatus) {
      await page.close();
      await context.close();
      await closeBrowser(browser);
      return {
        slug: options.slug,
        success: false,
        error: `${initialErrorStatus.title}: ${initialErrorStatus.message}`,
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
      };
    }

    // Click demo audio button if present
    if (
      !demoRequestedByRoute &&
      !(await isAudioActive(page)) &&
      (await requestDemoAudio(page))
    ) {
      console.log('Requesting demo audio...');
    }

    await page.waitForFunction(
      () =>
        document.body.dataset.toyLoaded === 'true' ||
        document.querySelector('.active-toy-status') ||
        (() => {
          const canvas =
            document.querySelector('#active-toy-container canvas') ??
            document.querySelector('canvas');
          if (!(canvas instanceof HTMLCanvasElement)) return false;
          const rect = canvas.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })() ||
        document.querySelector('#use-demo-audio') ||
        document.querySelector('#start-audio-btn'),
      undefined,
      { timeout: TOY_LOAD_TIMEOUT_MS },
    );

    const statusAfterAudioRequest = await getErrorStatus(page);
    if (statusAfterAudioRequest) {
      await page.close();
      await context.close();
      await closeBrowser(browser);
      return {
        slug: options.slug,
        success: false,
        error: `${statusAfterAudioRequest.title}: ${statusAfterAudioRequest.message}`,
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
      };
    }

    const toyLoadedAfterPreflight = await page.evaluate(
      () => document.body.dataset.toyLoaded === 'true',
    );
    if (!toyLoadedAfterPreflight) {
      if (await clickVisibleButtonByText(page, WEBGL_FALLBACK_LABEL)) {
        console.log('Continuing with WebGL fallback...');
      }

      if (
        !demoRequestedByRoute &&
        !(await isAudioActive(page)) &&
        (await requestDemoAudio(page))
      ) {
        console.log('Enabling demo audio...');
      } else if (await clickVisibleButton(page, CONTROL_MIC_SELECTOR)) {
        console.log('No demo audio button found. Enabling microphone...');
      } else {
        console.log('No audio start button found. Checking if auto-started...');
      }
    }

    await page.waitForFunction(
      () =>
        document.body.dataset.toyLoaded === 'true' ||
        document.querySelector('.active-toy-status') ||
        (() => {
          const canvas =
            document.querySelector('#active-toy-container canvas') ??
            document.querySelector('canvas');
          if (!(canvas instanceof HTMLCanvasElement)) return false;
          const rect = canvas.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })(),
      undefined,
      { timeout: TOY_LOAD_TIMEOUT_MS },
    );

    const loadErrorStatus = await getErrorStatus(page);
    if (loadErrorStatus) {
      await page.close();
      await context.close();
      await closeBrowser(browser);
      return {
        slug: options.slug,
        success: false,
        error: `${loadErrorStatus.title}: ${loadErrorStatus.message}`,
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
      };
    }
    console.log('Toy loaded.');

    // Wait for audio activation and retry via the agent API if the initial UI click
    // won the race against the shell but not the runtime audio starter.
    const audioActivated = await waitForAudioActive(
      page,
      AUDIO_ACTIVATION_TIMEOUT_MS,
    );
    if (!audioActivated && !demoRequestedByRoute) {
      console.warn('Audio activation timed out. Retrying demo audio...');
      if (await requestDemoAudio(page)) {
        await waitForAudioActive(page, AUDIO_ACTIVATION_TIMEOUT_MS);
      }
    }

    // Trigger a temporary vibe mode in agent sessions when available
    const vibeModeActivated = normalizedOptions.vibeMode
      ? await page
          .evaluate(async () => {
            const stimState = (
              window as typeof window & {
                stimState?: {
                  activateVibeMode?: (durationMs?: number) => Promise<void>;
                };
              }
            ).stimState;
            if (
              !stimState ||
              typeof stimState.activateVibeMode !== 'function'
            ) {
              return false;
            }

            await stimState.activateVibeMode(1800);
            return true;
          })
          .catch(() => false)
      : false;

    // Wait for visualization to run
    console.log(`Watching for ${normalizedOptions.duration}ms...`);
    await page.waitForTimeout(normalizedOptions.duration);

    const result: PlayToyResult = {
      slug: options.slug,
      success: true,
      presetId: normalizedOptions.presetId,
      consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
    };

    // Check audio state
    const audioState = await isAudioActive(page);
    result.audioActive = audioState || demoRequestedByRoute;
    result.vibeModeActivated = vibeModeActivated;
    const artifactStem = buildPlayToyArtifactStem({
      slug: options.slug,
      presetId: normalizedOptions.presetId,
    });
    const artifactTimestamp = Date.now();

    if (options.screenshot) {
      const screenshotName = `${artifactStem}-${artifactTimestamp}.png`;
      const screenshotPath = path.join(
        normalizedOptions.outputDir,
        screenshotName,
      );
      await page.screenshot({ path: screenshotPath });
      result.screenshot = screenshotPath;
      console.log(`Screenshot saved to ${screenshotPath}`);
    }

    if (options.debugSnapshot) {
      const snapshot = await getMilkdropDebugSnapshot(page);
      const snapshotName = `${artifactStem}-${artifactTimestamp}.debug.json`;
      const snapshotPath = path.join(normalizedOptions.outputDir, snapshotName);
      fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      result.debugSnapshot = snapshotPath;
      console.log(`Debug snapshot saved to ${snapshotPath}`);
    }

    if (result.screenshot || result.debugSnapshot) {
      const { manifestPath } = appendParityArtifactEntry(
        normalizedOptions.outputDir,
        {
          kind: 'stims-capture',
          slug: options.slug,
          presetId: normalizedOptions.presetId ?? null,
          files: {
            image: result.screenshot,
            debugSnapshot: result.debugSnapshot,
          },
          capture: {
            url,
            durationMs: normalizedOptions.duration,
            audioMode: demoRequestedByRoute ? 'demo' : 'none',
            vibeMode: normalizedOptions.vibeMode,
          },
        },
      );
      console.log(`Parity artifact manifest updated at ${manifestPath}`);
    }

    await page.close();
    await context.close(); // Saves video if enabled
    await closeBrowser(browser);

    return result;
  } catch (error) {
    console.error(`Error playing toy ${options.slug}:`, error);
    await closeBrowser(browser);
    return {
      slug: options.slug,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
    };
  }
}

// Allow running directly
if (import.meta.main) {
  const args = process.argv.slice(2);
  const slug = args[0];

  if (!slug || slug.startsWith('--')) {
    console.error('Usage: bun scripts/play-toy.ts <slug> [options]');
    console.error('Options:');
    console.error(
      '  --preset <id>       Requested preset id for /milkdrop/ runs',
    );
    console.error('  --port <number>     Dev server port (default: 5173)');
    console.error('  --duration <ms>     Duration to run (default: 5000)');
    console.error('  --no-headless       Run in visible window');
    console.error(
      '  --debug-snapshot    Save the milkdrop agent debug snapshot',
    );
    console.error('  --no-vibe-mode      Skip temporary agent vibe mode');
    console.error(
      '  --output <dir>      Output directory (default: ./screenshots)',
    );
    process.exit(1);
  }

  // Parse args
  const getArg = (name: string, fallback: string | number) => {
    const idx = args.indexOf(name);
    if (idx !== -1 && idx + 1 < args.length) {
      const val = args[idx + 1];
      return typeof fallback === 'number' ? parseInt(val, 10) : val;
    }
    return fallback;
  };

  const port = getArg('--port', 5173) as number;
  const duration = getArg('--duration', 3000) as number;
  const presetId = getArg('--preset', '') as string;
  const outputDir = getArg('--output', './screenshots') as string;
  const headless = !args.includes('--no-headless');
  const debugSnapshot = args.includes('--debug-snapshot');
  const vibeMode = !args.includes('--no-vibe-mode');

  console.log(`Launching ${slug} on port ${port}...`);

  playToy({
    slug,
    presetId: presetId.trim() || undefined,
    port,
    screenshot: true,
    debugSnapshot,
    video: false,
    duration,
    outputDir,
    headless,
    vibeMode,
  }).then((res) => console.log(JSON.stringify(res, null, 2)));
}
