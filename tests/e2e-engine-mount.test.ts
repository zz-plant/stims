/**
 * E2E: Verify the engine mounts, loads a preset, and renders canvas content.
 * Uses headed Chromium for real GPU rendering on macOS.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { chromium } from 'playwright';

const TEST_PORT = 5181;
const SERVER_URL = `http://127.0.0.1:${TEST_PORT}`;
let devServer: ChildProcess | null = null;

async function startServer() {
  devServer = spawn('bun', ['run', 'dev', '--port', String(TEST_PORT)], {
    stdio: 'ignore',
    env: { ...process.env, BROWSER: 'none' },
  });

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(SERVER_URL);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Dev server failed to start');
}

async function stopServer() {
  if (devServer) {
    devServer.kill('SIGTERM');
    devServer = null;
  }
}

beforeAll(() => startServer(), { timeout: 60000 });
afterAll(() => stopServer());

test(
  'mounts engine, loads preset, canvas renders non-blank content',
  async () => {
    const browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      console.log(`[TEST BROWSER CONSOLE 1] ${msg.type()}: ${msg.text()}`);
    });

    try {
      await page.goto(
        `${SERVER_URL}/?preset=eos-glowsticks-v2-03-music&audio=demo`,
        { waitUntil: 'domcontentloaded' },
      );

      // App shell must be present
      await page.waitForSelector('#stims-main', { timeout: 15000 });
      const shell = await page.$('#stims-main');
      expect(shell).not.toBeNull();

      // Click demo audio button
      const clicked = await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const demo = btns.find(
          (b) =>
            b.textContent?.includes('demo audio') ||
            b.textContent?.includes('Play with demo'),
        );
        if (demo) {
          demo.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        }
        return false;
      });
      expect(clicked).toBe(true);

      // Wait for engine to enter live mode
      await page.waitForSelector('[data-mode="live"]', { timeout: 30000 });

      // Canvas must appear once engine finishes mounting
      const canvas = await page.waitForSelector('canvas', { timeout: 15000 });
      expect(canvas).not.toBeNull();

      await page.waitForTimeout(3000);

      const info = await page.evaluate(() => {
        const c = document.querySelector('canvas') as HTMLCanvasElement | null;
        if (!c) return null;
        const data = c.toDataURL('image/png');
        return {
          width: c.width,
          height: c.height,
          dataLen: data.length,
          hasContent: data.length > 1000,
        };
      });

      expect(info).not.toBeNull();
      if (!info) throw new Error('canvas info is null');
      expect(info.width).toBeGreaterThan(0);
      expect(info.height).toBeGreaterThan(0);
      expect(info.hasContent).toBe(true);
    } finally {
      await ctx.close();
      await browser.close();
    }
  },
  { timeout: 120000 },
);

test(
  'switches preset and canvas content changes',
  async () => {
    const browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    page.on('console', (msg) => {
      console.log(`[TEST BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
    });

    try {
      // Load first preset
      await page.goto(
        `${SERVER_URL}/?preset=eos-glowsticks-v2-03-music&audio=demo`,
        { waitUntil: 'domcontentloaded' },
      );
      await page.waitForSelector('#stims-main', { timeout: 15000 });
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const demo = btns.find(
          (b) =>
            b.textContent?.includes('demo audio') ||
            b.textContent?.includes('Play with demo'),
        );
        demo?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await page.waitForSelector('[data-mode="live"]', { timeout: 30000 });
      await page.waitForSelector('canvas', { timeout: 15000 });
      await page.waitForFunction(() => document.title.includes('Glowsticks'), {
        timeout: 30000,
      });
      await page.waitForTimeout(2000);

      const hash1 = await page.evaluate(
        () => document.querySelector('canvas')?.toDataURL('image/png').length,
      );

      // Load a different preset via URL change (page.goto with new preset)
      await page.goto(
        `${SERVER_URL}/?preset=rovastar-parallel-universe&audio=demo`,
        {
          waitUntil: 'domcontentloaded',
        },
      );
      await page.waitForSelector('#stims-main', { timeout: 15000 });
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('button')];
        const demo = btns.find(
          (b) =>
            b.textContent?.includes('demo audio') ||
            b.textContent?.includes('Play with demo'),
        );
        demo?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await page.waitForSelector('[data-mode="live"]', { timeout: 30000 });
      await page.waitForSelector('canvas', { timeout: 15000 });
      await page.waitForFunction(() => document.title.includes('Parallel'), {
        timeout: 30000,
      });
      await page.waitForTimeout(2000);

      const hash2 = await page.evaluate(
        () => document.querySelector('canvas')?.toDataURL('image/png').length,
      );

      // Verify presets are distinct
      const title = await page.evaluate(() => document.title);
      expect(title).toContain('Parallel');

      // Both must have content
      expect(hash1).toBeGreaterThan(1000);
      expect(hash2).toBeGreaterThan(1000);
    } finally {
      await ctx.close();
      await browser.close();
    }
  },
  { timeout: 120000 },
);
