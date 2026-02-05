import fs from 'node:fs';
import path from 'node:path';
import { type Browser, type ConsoleMessage, chromium } from 'playwright';

export type PlayToyResult = {
  slug: string;
  success: boolean;
  screenshot?: string;
  video?: string;
  error?: string;
  consoleErrors?: string[];
  audioActive?: boolean;
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
  outputDir: './screenshots',
};

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

export async function playToy(options: PlayToyOptions): Promise<PlayToyResult> {
  const normalizedOptions = normalizeOptions(options);

  // Ensure output directory exists
  ensureOutputDir(normalizedOptions.outputDir);

  let browser: Browser | undefined;
  const consoleErrors: string[] = [];

  try {
    browser = await chromium.launch({ headless: normalizedOptions.headless });
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

    const url = `http://localhost:${normalizedOptions.port}/toy.html?toy=${encodeURIComponent(options.slug)}&agent=true`;
    console.log(`Navigating to ${url}...`);

    await page.goto(url);

    // Wait for toy to load
    await page.waitForFunction(
      () => document.body.dataset.toyLoaded === 'true',
      undefined,
      { timeout: 10000 },
    );
    console.log('Toy loaded.');

    // Click demo audio button if present
    const demoBtn = await page.$('[data-demo-audio-btn], #use-demo-audio');
    if (demoBtn) {
      console.log('Enabling demo audio...');
      await demoBtn.click();

      // Wait for audio activation
      await page
        .waitForFunction(
          () => document.body.dataset.audioActive === 'true',
          undefined,
          { timeout: 5000 },
        )
        .catch(() =>
          console.warn(
            'Audio activation timed out or not detected via data attribute.',
          ),
        );
    } else {
      console.log('No demo audio button found. Checking if auto-started...');
    }

    // Wait for visualization to run
    console.log(`Watching for ${normalizedOptions.duration}ms...`);
    await page.waitForTimeout(normalizedOptions.duration);

    const result: PlayToyResult = {
      slug: options.slug,
      success: true,
      consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
    };

    // Check audio state
    const audioState = await page.evaluate(
      () => document.body.dataset.audioActive === 'true',
    );
    result.audioActive = audioState;

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
  const outputDir = getArg('--output', './screenshots') as string;
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
