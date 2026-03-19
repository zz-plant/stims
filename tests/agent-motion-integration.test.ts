import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Page,
} from 'playwright';

const chromiumPath = chromium.executablePath();
const hasChromium = fs.existsSync(chromiumPath);
const integrationTest = hasChromium ? test : test.skip;
const TEST_PORT = 5180;
const PLAYWRIGHT_RENDERER_ARGS = [
  '--use-angle=swiftshader',
  '--use-gl=angle',
  '--enable-webgl',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
];

type MilkdropDebugSnapshot = {
  activePresetId: string | null;
  frameState: {
    presetId: string;
    signals: Record<string, number>;
  } | null;
};

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

async function clickVisibleButtonByText(page: Page, label: string) {
  return page.evaluate((buttonLabel) => {
    const buttons = [...document.querySelectorAll('button')];
    const target = buttons.find((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const isVisible =
        !element.hidden &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        !element.hasAttribute('disabled');
      return isVisible && element.textContent?.trim() === buttonLabel;
    });

    if (!(target instanceof HTMLElement)) return false;
    target.click();
    return true;
  }, label);
}

async function withMountedToyPage(
  {
    slug,
    beforeNavigate,
  }: {
    slug: string;
    beforeNavigate?: (page: Page) => Promise<void>;
  },
  callback: (page: Page) => Promise<void>,
) {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: PLAYWRIGHT_RENDERER_ARGS,
    });
    context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      permissions: ['microphone'],
    });
    page = await context.newPage();
    await beforeNavigate?.(page);
    await page.goto(`http://127.0.0.1:${TEST_PORT}/index.html?agent=true`);
    await page.evaluate(async (targetSlug) => {
      const agentApiModulePath = '/assets/js/core/agent-api.ts';
      const { initAgentAPI } = await import(
        /* @vite-ignore */ agentApiModulePath
      );
      initAgentAPI();

      document.body.innerHTML = '';
      const container = document.createElement('div');
      container.id = 'test-root';
      document.body.appendChild(container);

      const toyModulePath = `/assets/js/toys/${targetSlug}.ts`;
      const toyModule = await import(/* @vite-ignore */ toyModulePath);
      const instance = await Promise.resolve(toyModule.start({ container }));

      (
        window as typeof window & {
          __mountedToy?: unknown;
        }
      ).__mountedToy = instance;
    }, slug);
    await page.waitForFunction(
      () => document.querySelector('canvas') !== null,
      undefined,
      { timeout: 10000 },
    );
    await page.waitForTimeout(250);
    await callback(page);
  } finally {
    await page
      ?.evaluate(async () => {
        const win = window as typeof window & {
          __mountedToy?: {
            dispose?: () => Promise<unknown> | unknown;
          };
        };
        const mountedToy = win.__mountedToy;
        if (
          mountedToy &&
          typeof mountedToy === 'object' &&
          typeof mountedToy.dispose === 'function'
        ) {
          await mountedToy.dispose();
        }
        delete win.__mountedToy;
      })
      .catch(() => {});
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

async function installMotionMock(page: Page) {
  await page.addInitScript(() => {
    class FakeDeviceOrientationEvent extends Event {
      alpha: number | null;
      beta: number | null;
      gamma: number | null;

      static async requestPermission() {
        return 'granted' as PermissionState;
      }

      constructor(
        type: string,
        init: {
          alpha?: number | null;
          beta?: number | null;
          gamma?: number | null;
        } = {},
      ) {
        super(type);
        this.alpha = init.alpha ?? null;
        this.beta = init.beta ?? null;
        this.gamma = init.gamma ?? null;
      }
    }

    Object.defineProperty(window, 'DeviceOrientationEvent', {
      configurable: true,
      writable: true,
      value: FakeDeviceOrientationEvent,
    });
    window.localStorage.setItem('stims:motion-enabled', 'true');
  });
}

async function dispatchDeviceOrientation(
  page: Page,
  {
    alpha = 0,
    beta = 0,
    gamma = 0,
  }: {
    alpha?: number;
    beta?: number;
    gamma?: number;
  },
) {
  await page.evaluate(
    (payload) => {
      const event = new DeviceOrientationEvent('deviceorientation', payload);
      window.dispatchEvent(event);
    },
    { alpha, beta, gamma },
  );
}

async function getMilkdropDebugSnapshot(page: Page) {
  return page.evaluate(() => {
    const stimState = (
      window as typeof window & {
        stimState?: {
          getDebugSnapshot?: (key: string) => unknown;
        };
      }
    ).stimState;
    return stimState?.getDebugSnapshot?.('milkdrop') ?? null;
  }) as Promise<MilkdropDebugSnapshot | null>;
}

async function waitForMilkdropSnapshot(
  page: Page,
  predicate: (snapshot: MilkdropDebugSnapshot) => boolean,
  timeoutMs = 5000,
) {
  const startedAt = Date.now();
  let lastSnapshot: MilkdropDebugSnapshot | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await getMilkdropDebugSnapshot(page);
    lastSnapshot = snapshot;
    if (snapshot && predicate(snapshot)) {
      return snapshot;
    }
    await page.waitForTimeout(10);
  }

  throw new Error(
    `Timed out waiting for MilkDrop debug snapshot. Last snapshot: ${JSON.stringify(lastSnapshot)}`,
  );
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
  'milkdrop tactile presets respond to device motion',
  async () => {
    await withMountedToyPage(
      {
        slug: 'tactile-sand-table',
        beforeNavigate: installMotionMock,
      },
      async (page) => {
        const initial = await waitForMilkdropSnapshot(
          page,
          (snapshot) =>
            snapshot.activePresetId === 'tactile-sand-table' &&
            snapshot.frameState !== null,
        );

        const enabled = await clickVisibleButtonByText(
          page,
          'Enable motion control',
        );
        expect(enabled).toBe(true);

        await waitForMilkdropSnapshot(
          page,
          (snapshot) =>
            snapshot.frameState?.presetId === 'tactile-sand-table' &&
            snapshot.frameState.signals.motion_enabled === 1,
        );

        await dispatchDeviceOrientation(page, { beta: 28, gamma: 34 });

        const motionSnapshot = await waitForMilkdropSnapshot(
          page,
          (snapshot) =>
            snapshot.frameState?.presetId === 'tactile-sand-table' &&
            snapshot.frameState.signals.motion_enabled === 1 &&
            Math.abs(snapshot.frameState.signals.motion_x) > 0.2,
        );

        expect(motionSnapshot.frameState?.signals.motion_enabled).toBe(1);
        expect(
          Math.abs(
            (motionSnapshot.frameState?.signals.motion_x ?? 0) -
              (initial.frameState?.signals.motion_x ?? 0),
          ),
        ).toBeGreaterThan(0.2);
      },
    );
  },
  { timeout: 60000 },
);
