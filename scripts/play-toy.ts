import fs from 'node:fs';
import path from 'node:path';
import {
  type Browser,
  type ConsoleMessage,
  chromium,
  type Page,
} from 'playwright';

export type PlayToyResult = {
  slug: string;
  success: boolean;
  screenshot?: string;
  video?: string;
  error?: string;
  consoleErrors?: string[];
  audioActive?: boolean;
  vibeModeActivated?: boolean;
};

type PlayToyOptions = {
  slug: string;
  port?: number;
  duration?: number;
  screenshot?: boolean;
  video?: boolean;
  outputDir?: string;
  headless?: boolean;
};

type NormalizedPlayToyOptions = PlayToyOptions & {
  port: number;
  duration: number;
  outputDir: string;
  headless: boolean;
};

const DEFAULT_OPTIONS = {
  port: 5173,
  duration: 5000,
  outputDir: './output/playwright',
};
const SHELL_DEMO_SELECTOR = '[data-demo-audio-btn]';
const CONTROL_DEMO_SELECTOR = '#use-demo-audio';
const CONTROL_MIC_SELECTOR = '#start-audio-btn';
const AUDIO_DEMO_LABEL = 'Start with demo audio';
const PREFLIGHT_CONTINUE_LABEL = 'Continue to audio setup';
const PREFLIGHT_LIGHTER_LABEL = 'Enable lighter visual mode';
const WEBGL_FALLBACK_LABEL = 'Continue with WebGL';
const PLAYWRIGHT_RENDERER_ARGS = [
  '--use-angle=swiftshader',
  '--use-gl=angle',
  '--enable-webgl',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];
const INITIAL_SHELL_TIMEOUT_MS = 30000;
const TOY_LOAD_TIMEOUT_MS = 30000;
const AUDIO_ACTIVATION_TIMEOUT_MS = 5000;

function normalizeOptions(options: PlayToyOptions): NormalizedPlayToyOptions {
  return {
    ...options,
    port: options.port ?? DEFAULT_OPTIONS.port,
    duration: options.duration ?? DEFAULT_OPTIONS.duration,
    outputDir: options.outputDir ?? DEFAULT_OPTIONS.outputDir,
    headless: options.headless !== false,
  };
}

function ensureOutputDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

async function closeBrowser(browser?: Browser) {
  if (browser) {
    await browser.close();
  }
}

async function clickVisibleButton(page: Page, selector: string) {
  return page.evaluate((buttonSelector) => {
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

async function requestDemoAudio(page: Page) {
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
  return page.evaluate(() => {
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
  });
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

    const url = `http://localhost:${normalizedOptions.port}/milkdrop/?experience=${encodeURIComponent(options.slug)}&agent=true`;
    console.log(`Navigating to ${url}...`);

    await page.goto(url);

    if (await clickVisibleButtonByText(page, PREFLIGHT_LIGHTER_LABEL)) {
      console.log('Using lighter visual mode from capability preflight...');
    }
    if (await clickVisibleButtonByText(page, PREFLIGHT_CONTINUE_LABEL)) {
      console.log('Advancing through capability preflight...');
    }

    // Wait for either an already-loaded toy or the shell audio controls
    await page.waitForFunction(
      () =>
        document.body.dataset.toyLoaded === 'true' ||
        document.querySelector('.active-toy-status') ||
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
    if (await requestDemoAudio(page)) {
      console.log('Requesting demo audio...');
    }

    await page.waitForFunction(
      () =>
        document.body.dataset.toyLoaded === 'true' ||
        document.querySelector('.active-toy-status') ||
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

      if (await requestDemoAudio(page)) {
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
        document.querySelector('.active-toy-status'),
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
    if (!(await waitForAudioActive(page, AUDIO_ACTIVATION_TIMEOUT_MS))) {
      console.warn('Audio activation timed out. Retrying demo audio...');
      if (await requestDemoAudio(page)) {
        await waitForAudioActive(page, AUDIO_ACTIVATION_TIMEOUT_MS);
      }
    }

    // Trigger a temporary vibe mode in agent sessions when available
    const vibeModeActivated = await page
      .evaluate(async () => {
        const stimState = (
          window as typeof window & {
            stimState?: {
              activateVibeMode?: (durationMs?: number) => Promise<void>;
            };
          }
        ).stimState;
        if (!stimState || typeof stimState.activateVibeMode !== 'function') {
          return false;
        }

        await stimState.activateVibeMode(1800);
        return true;
      })
      .catch(() => false);

    // Wait for visualization to run
    console.log(`Watching for ${normalizedOptions.duration}ms...`);
    await page.waitForTimeout(normalizedOptions.duration);

    const result: PlayToyResult = {
      slug: options.slug,
      success: true,
      consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
    };

    // Check audio state
    const audioState = await isAudioActive(page);
    result.audioActive = audioState;
    result.vibeModeActivated = vibeModeActivated;

    if (options.screenshot) {
      const screenshotName = `${options.slug}-${Date.now()}.png`;
      const screenshotPath = path.join(
        normalizedOptions.outputDir,
        screenshotName,
      );
      await page.screenshot({ path: screenshotPath });
      result.screenshot = screenshotPath;
      console.log(`Screenshot saved to ${screenshotPath}`);
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
    console.error('  --port <number>     Dev server port (default: 5173)');
    console.error('  --duration <ms>     Duration to run (default: 5000)');
    console.error('  --no-headless       Run in visible window');
    console.error(
      '  --output <dir>      Output directory (default: ./output/playwright)',
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
  const outputDir = getArg('--output', './output/playwright') as string;
  const headless = !args.includes('--no-headless');

  console.log(`Launching ${slug} on port ${port}...`);

  playToy({
    slug,
    port,
    screenshot: true,
    video: false,
    duration,
    outputDir,
    headless,
  }).then((res) => console.log(JSON.stringify(res, null, 2)));
}
