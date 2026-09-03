/**
 * Capture the site's prominent surfaces as flat screenshots, the way a visitor
 * (or a link unfurler, or a reviewer) would first see them, so they can be
 * critiqued as graphic design rather than as running software.
 *
 * Usage: bun run scripts/capture-aesthetic-audit.ts [--out <dir>] [--only <id,id>]
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { ensureDevServer } from './dev-server.ts';

const DEFAULT_OUTPUT_DIR = './screenshots/aesthetic-audit';

type Shot = {
  id: string;
  urlPath: string;
  width: number;
  height: number;
  waitMs?: number;
};

const SHOTS: Shot[] = [
  {
    id: '01-desktop-home',
    urlPath: '/?agent=true',
    width: 1440,
    height: 900,
    waitMs: 2000,
  },
  {
    id: '02-desktop-browse',
    urlPath: '/?agent=true&panel=browse',
    width: 1440,
    height: 900,
    waitMs: 2000,
  },
  {
    id: '03-desktop-settings',
    urlPath: '/?agent=true&panel=settings',
    width: 1440,
    height: 900,
    waitMs: 2000,
  },
  {
    id: '04-desktop-editor',
    urlPath: '/?agent=true&panel=editor',
    width: 1440,
    height: 900,
    waitMs: 2000,
  },
  {
    id: '05-desktop-live',
    urlPath: '/?agent=true&audio=demo',
    width: 1440,
    height: 900,
    waitMs: 3000,
  },
  {
    id: '06-mobile-home',
    urlPath: '/?agent=true',
    width: 375,
    height: 812,
    waitMs: 2000,
  },
  {
    id: '07-mobile-browse',
    urlPath: '/?agent=true&panel=browse',
    width: 375,
    height: 812,
    waitMs: 2000,
  },
];

async function captureScreen(page: Page, shot: Shot, outputPath: string) {
  await page.setViewportSize({ width: shot.width, height: shot.height });
  // 'load' plus the shot's own settle, not 'networkidle': the dev server keeps
  // an HMR socket open and the stage keeps a render loop running, so the
  // narrow-viewport shots could sit until the navigation timed out.
  await page.goto(`http://127.0.0.1:5173${shot.urlPath}`, {
    waitUntil: 'load',
  });
  await page.waitForTimeout(shot.waitMs ?? 1500);
  await page.screenshot({ path: outputPath, fullPage: false, timeout: 90_000 });
  console.log(`Captured ${outputPath}`);
}

function parseArgs(argv: string[]) {
  let outputDir = DEFAULT_OUTPUT_DIR;
  let only: Set<string> | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--out' && argv[i + 1]) {
      outputDir = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--only' && argv[i + 1]) {
      only = new Set(argv[i + 1].split(',').map((value) => value.trim()));
      i += 1;
    }
  }
  return { outputDir, only };
}

async function main() {
  const { outputDir, only } = parseArgs(process.argv.slice(2));
  await mkdir(outputDir, { recursive: true });
  const server = await ensureDevServer(5173);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-unsafe-webgpu',
      '--use-gl=angle',
      '--use-angle=swiftshader',
    ],
  });

  const page = await browser.newPage();

  for (const shot of SHOTS) {
    if (only && !only.has(shot.id)) continue;
    await captureScreen(page, shot, path.join(outputDir, `${shot.id}.png`));
  }

  await browser.close();
  server.close();
  console.log('Capture complete!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
