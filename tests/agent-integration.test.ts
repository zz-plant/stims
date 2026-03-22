import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { playToy } from '../scripts/play-toy.ts';

const chromiumPath = chromium.executablePath();
const hasChromium = fs.existsSync(chromiumPath);
const integrationTest = hasChromium ? test : test.skip;
const TEST_PORT = 5180;
let devServer: ChildProcess | null = null;

async function waitForServer(url: string, timeoutMs = 20000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (_error) {
      // Server is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Timed out waiting for dev server at ${url}`);
}

async function createMobilePage() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 430, height: 932 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  return {
    browser,
    context,
    page,
    close: async () => {
      await context.close();
      await browser.close();
    },
  };
}

beforeAll(async () => {
  if (!hasChromium) return;

  devServer = spawn(
    process.execPath,
    ['run', 'vite', '--host', '127.0.0.1', '--port', String(TEST_PORT)],
    {
      stdio: 'ignore',
      cwd: process.cwd(),
    },
  );

  await waitForServer(`http://127.0.0.1:${TEST_PORT}/`);
}, 30000);

afterAll(async () => {
  if (!devServer) return;

  devServer.kill('SIGTERM');
  await new Promise((resolve) => devServer?.once('exit', resolve));
  devServer = null;
});

integrationTest(
  'agents can launch and capture milkdrop',
  async () => {
    const outputDir = await mkdtemp(path.join(tmpdir(), 'stims-agent-'));

    try {
      const result = await playToy({
        slug: 'milkdrop',
        screenshot: true,
        duration: 3000,
        outputDir,
        port: TEST_PORT,
      });

      expect(result.success).toBe(true);
      expect(result.audioActive).toBe(true);
      expect(result.screenshot).toBeTruthy();
      expect(result.screenshot ? fs.existsSync(result.screenshot) : false).toBe(
        true,
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  },
  { timeout: 45000 },
);

integrationTest(
  'agents can detect failing toy',
  async () => {
    const result = await playToy({
      slug: 'non-existent-toy-slug',
      duration: 1000,
      port: TEST_PORT,
    });

    expect(result.success).toBe(false);
  },
  { timeout: 45000 },
);

integrationTest(
  'milkdrop shows touch onboarding after audio starts on a coarse-pointer viewport',
  async () => {
    const mobile = await createMobilePage();

    try {
      await mobile.page.goto(`http://127.0.0.1:${TEST_PORT}/milkdrop/`);
      await mobile.page.locator('#use-demo-audio').click();
      await mobile.page.waitForFunction(
        () => document.body.dataset.audioActive === 'true',
      );

      await mobile.page.waitForSelector('[data-gesture-hints]:not([hidden])');
      const gestureText =
        (await mobile.page.textContent('[data-gesture-hints]')) ?? '';
      expect(gestureText).toContain('Touch gestures');
      expect(gestureText).toContain(
        'Drag to bend the scene and shove the feedback trail.',
      );
      expect(gestureText).toContain(
        'Pinch to swell or compress the depth and intensity.',
      );
      expect(gestureText).not.toContain('Press Q/E');
      expect(gestureText).not.toContain('Desktop controls');
    } finally {
      await mobile.close();
    }
  },
  { timeout: 45000 },
);

integrationTest(
  'browser-backed audio controls use mobile fallback gestures without desktop shortcut copy',
  async () => {
    const mobile = await createMobilePage();

    try {
      await mobile.page.goto(`http://127.0.0.1:${TEST_PORT}/`);
      await mobile.page.evaluate(async () => {
        document.body.innerHTML = '<section id="audio-controls"></section>';
        const moduleUrl = new URL(
          '/assets/js/ui/audio-controls.ts',
          window.location.origin,
        ).href;
        const { initAudioControls } = await import(
          /* @vite-ignore */ moduleUrl
        );
        const container = document.querySelector('#audio-controls');
        if (!(container instanceof HTMLElement)) {
          throw new Error('Audio controls container missing.');
        }
        initAudioControls(container, {
          onRequestMicrophone: async () => {},
          onRequestDemoAudio: async () => {},
          starterTips: ['Press Q/E for mode changes', 'Import preset files'],
          desktopHints: [
            'Move to steer the scene.',
            'Press Space for an accent burst.',
          ],
        });
      });

      await mobile.page.locator('#use-demo-audio').click();
      await mobile.page.waitForSelector('[data-gesture-hints]:not([hidden])');
      const gestureText =
        (await mobile.page.textContent('[data-gesture-hints]')) ?? '';
      expect(gestureText).toContain('Drag to bend the scene.');
      expect(gestureText).toContain('Pinch to swell or compress the depth.');
      expect(gestureText).not.toContain('Press Q/E');
      expect(gestureText).not.toContain('Press Space');
    } finally {
      await mobile.close();
    }
  },
  { timeout: 45000 },
);
