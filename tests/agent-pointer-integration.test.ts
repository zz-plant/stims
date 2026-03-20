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
  status: string | null;
  frameState: {
    signals: Record<string, number>;
    variables: Record<string, number>;
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

async function withMountedToyPage(
  { slug }: { slug: string },
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

async function getPrimaryCanvasBox(page: Page) {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) {
    throw new Error('Canvas was not available for interaction.');
  }
  return box;
}

async function dispatchPointerEvent(
  page: Page,
  event: {
    type: string;
    pointerId: number;
    clientX: number;
    clientY: number;
    pointerType?: string;
  },
) {
  await page.evaluate((payload) => {
    const target = document.querySelector('canvas');
    if (!(target instanceof HTMLElement)) {
      throw new Error('Canvas target not found.');
    }

    const pointerEvent = new PointerEvent(payload.type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: payload.pointerId,
      pointerType: payload.pointerType ?? 'touch',
      isPrimary: payload.pointerId === 1,
      clientX: payload.clientX,
      clientY: payload.clientY,
      buttons: payload.type === 'pointerup' ? 0 : 1,
      pressure: payload.type === 'pointerup' ? 0 : 0.5,
    });

    target.dispatchEvent(pointerEvent);
  }, event);
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
  'milkdrop touch presets respond to drag input',
  async () => {
    await withMountedToyPage({ slug: 'pocket-pulse' }, async (page) => {
      const initial = await waitForMilkdropSnapshot(
        page,
        (snapshot) =>
          snapshot.activePresetId === 'pocket-pulse' &&
          snapshot.frameState !== null,
      );
      const box = await getPrimaryCanvasBox(page);
      const startX = box.x + box.width * 0.28;
      const startY = box.y + box.height * 0.72;
      const endX = box.x + box.width * 0.76;
      const endY = box.y + box.height * 0.34;

      await dispatchPointerEvent(page, {
        type: 'pointerdown',
        pointerId: 1,
        clientX: startX,
        clientY: startY,
      });
      for (let step = 1; step <= 6; step += 1) {
        const progress = step / 6;
        await dispatchPointerEvent(page, {
          type: 'pointermove',
          pointerId: 1,
          clientX: startX + (endX - startX) * progress,
          clientY: startY + (endY - startY) * progress,
        });
        await page.waitForTimeout(16);
      }

      const dragged = await waitForMilkdropSnapshot(
        page,
        (snapshot) =>
          snapshot.activePresetId === 'pocket-pulse' &&
          snapshot.frameState?.signals.input_pressed === 1 &&
          snapshot.frameState.signals.input_count === 1 &&
          snapshot.frameState.signals.input_x > 0.2 &&
          snapshot.frameState.signals.input_y > 0.1,
      );

      await dispatchPointerEvent(page, {
        type: 'pointerup',
        pointerId: 1,
        clientX: endX,
        clientY: endY,
      });

      expect(dragged.frameState?.signals.input_pressed).toBe(1);
      expect(dragged.frameState?.signals.input_count).toBe(1);
      expect(
        Math.abs(
          (dragged.frameState?.signals.input_x ?? 0) -
            (initial.frameState?.signals.input_x ?? 0),
        ),
      ).toBeGreaterThan(0.2);
    });
  },
  { timeout: 60000 },
);

integrationTest(
  'milkdrop gestural presets respond to pinch and rotate input',
  async () => {
    await withMountedToyPage({ slug: 'aurora-painter' }, async (page) => {
      const initial = await waitForMilkdropSnapshot(
        page,
        (snapshot) =>
          snapshot.activePresetId === 'aurora-painter' &&
          snapshot.frameState !== null,
      );

      const box = await getPrimaryCanvasBox(page);
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      const startLeft = { x: centerX - 80, y: centerY };
      const startRight = { x: centerX + 80, y: centerY };
      const endLeft = { x: centerX - 120, y: centerY + 60 };
      const endRight = { x: centerX + 120, y: centerY - 60 };

      await dispatchPointerEvent(page, {
        type: 'pointerdown',
        pointerId: 1,
        clientX: startLeft.x,
        clientY: startLeft.y,
      });
      await dispatchPointerEvent(page, {
        type: 'pointerdown',
        pointerId: 2,
        clientX: startRight.x,
        clientY: startRight.y,
      });
      await waitForMilkdropSnapshot(
        page,
        (snapshot) =>
          snapshot.activePresetId === 'aurora-painter' &&
          snapshot.frameState?.signals.input_count === 2 &&
          (snapshot.frameState?.signals.gesture_scale ?? 0) === 1,
      );
      await dispatchPointerEvent(page, {
        type: 'pointermove',
        pointerId: 1,
        clientX: endLeft.x,
        clientY: endLeft.y,
      });
      await page.waitForTimeout(32);
      await dispatchPointerEvent(page, {
        type: 'pointermove',
        pointerId: 2,
        clientX: endRight.x,
        clientY: endRight.y,
      });

      const gestured = await waitForMilkdropSnapshot(
        page,
        (snapshot) =>
          snapshot.activePresetId === 'aurora-painter' &&
          Math.abs((snapshot.frameState?.signals.gesture_scale ?? 1) - 1) >
            0.1 &&
          Math.abs(snapshot.frameState?.signals.gesture_rotation ?? 0) > 0.3 &&
          typeof snapshot.status === 'string' &&
          snapshot.status.includes('Aurora palette:') &&
          (snapshot.frameState?.variables.shape_1_b ?? 0) !==
            (initial.frameState?.variables.shape_1_b ?? 0),
      );

      await dispatchPointerEvent(page, {
        type: 'pointerup',
        pointerId: 1,
        clientX: endLeft.x,
        clientY: endLeft.y,
      });
      await dispatchPointerEvent(page, {
        type: 'pointerup',
        pointerId: 2,
        clientX: endRight.x,
        clientY: endRight.y,
      });

      expect(gestured.status).toContain('Aurora palette:');
      expect(
        Math.abs(
          (gestured.frameState?.variables.shape_1_b ?? 0) -
            (initial.frameState?.variables.shape_1_b ?? 0),
        ),
      ).toBeGreaterThan(0.05);
    });
  },
  { timeout: 60000 },
);
