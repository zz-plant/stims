import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Page } from 'playwright';

const OUTPUT_DIR = './screenshots/aesthetic-audit';

async function isPortOpen(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/?agent=true`);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

async function ensureDevServer(port = 5173): Promise<{ close: () => void }> {
  if (await isPortOpen(port)) {
    console.log(`Dev server already running on port ${port}`);
    return { close: () => {} };
  }

  console.log(`Starting Vite dev server on port ${port}...`);
  const proc = spawn('bun', ['run', 'dev', '--port', String(port)], {
    stdio: 'ignore',
  });

  // Wait for server to start
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isPortOpen(port)) {
      console.log(`Dev server started on port ${port}`);
      break;
    }
  }

  return {
    close: () => {
      proc.kill();
    },
  };
}

async function captureScreen(
  page: Page,
  urlPath: string,
  width: number,
  height: number,
  outputPath: string,
  waitMs = 1500,
) {
  await page.setViewportSize({ width, height });
  await page.goto(`http://127.0.0.1:5173${urlPath}`, {
    waitUntil: 'networkidle',
  });
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: outputPath, fullPage: false });
  console.log(`Captured ${outputPath}`);
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
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

  // Desktop captures (1440x900)
  await captureScreen(
    page,
    '/?agent=true',
    1440,
    900,
    path.join(OUTPUT_DIR, '01-desktop-home.png'),
    2000,
  );
  await captureScreen(
    page,
    '/?agent=true&panel=browse',
    1440,
    900,
    path.join(OUTPUT_DIR, '02-desktop-browse.png'),
    2000,
  );
  await captureScreen(
    page,
    '/?agent=true&panel=settings',
    1440,
    900,
    path.join(OUTPUT_DIR, '03-desktop-settings.png'),
    2000,
  );
  await captureScreen(
    page,
    '/?agent=true&panel=editor',
    1440,
    900,
    path.join(OUTPUT_DIR, '04-desktop-editor.png'),
    2000,
  );
  await captureScreen(
    page,
    '/?agent=true&audio=demo',
    1440,
    900,
    path.join(OUTPUT_DIR, '05-desktop-live.png'),
    3000,
  );

  // Mobile captures (375x812)
  await captureScreen(
    page,
    '/?agent=true',
    375,
    812,
    path.join(OUTPUT_DIR, '06-mobile-home.png'),
    2000,
  );
  await captureScreen(
    page,
    '/?agent=true&panel=browse',
    375,
    812,
    path.join(OUTPUT_DIR, '07-mobile-browse.png'),
    2000,
  );

  await browser.close();
  server.close();
  console.log('Capture complete!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
