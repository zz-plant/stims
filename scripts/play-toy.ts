import fs from 'node:fs';
import path from 'node:path';
import { type ConsoleMessage, chromium } from 'playwright';

export type PlayToyResult = {
  slug: string;
  success: boolean;
  screenshot?: string;
  video?: string;
  error?: string;
  consoleErrors?: string[];
  audioActive?: boolean;
};

export async function playToy(options: {
  slug: string;
  port?: number;
  duration?: number;
  screenshot?: boolean;
  video?: boolean;
  outputDir?: string;
  headless?: boolean;
}): Promise<PlayToyResult> {
  const port = options.port || 5173;
  const duration = options.duration || 5000;
  const outputDir = options.outputDir || './screenshots';
  const headless = options.headless !== false; // Default to true

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }, // Standard 720p
    recordVideo: options.video ? { dir: outputDir } : undefined,
    permissions: ['microphone'], // Auto-grant microphone if needed
  });

  const page = await context.newPage();
  const consoleErrors: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err: Error) => {
    consoleErrors.push(err.message);
  });

  try {
    const url = `http://localhost:${port}/toy.html?toy=${encodeURIComponent(options.slug)}&agent=true`;
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
    console.log(`Watching for ${duration}ms...`);
    await page.waitForTimeout(duration);

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
      const screenshotPath = path.join(outputDir, screenshotName);
      await page.screenshot({ path: screenshotPath });
      result.screenshot = screenshotPath;
      console.log(`Screenshot saved to ${screenshotPath}`);
    }

    await page.close();
    await context.close(); // Saves video if enabled
    await browser.close();

    return result;
  } catch (error) {
    console.error(`Error playing toy ${options.slug}:`, error);
    await browser.close();
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
