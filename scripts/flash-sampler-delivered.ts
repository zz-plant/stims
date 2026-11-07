/**
 * Delivered-frame attribution for the flash sampler, behind
 * `lab:flash-sampler-bench -- --delivered`. Run its docblock there for what
 * the stages mean and why it serves a production build.
 *
 * The stages are selected inside the shipped sampler by intercepting the two
 * browser calls it makes, so what is measured is the code visitors run: no
 * test hook exists in the bundle.
 */
import { type Browser, chromium, type Page } from 'playwright';
import { ensureProductionServer } from './dev-server.ts';

const STAGES = ['off', 'capture', 'judge', 'full'] as const;
type Stage = (typeof STAGES)[number];

const DEFAULT_PRESETS = ['martin-journey-into-space', 'martin-dune-racer'];
const WINDOW_MS = 6000;
const SETTLE_MS = 1500;
const WARMUP_MS = 10_000;

function readArg(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

/**
 * Runs before app code. Wraps `Worker` so the readback worker's traffic can be
 * cut at the stage in `window.__flashBenchStage`.
 */
function interceptReadback() {
  const scope = window as unknown as {
    __flashBenchStage: string;
    __flashBenchFrames: number;
    __flashBenchCaptures: number;
    __flashBenchReplies: number;
    __flashBenchHandlerMs: number;
    __flashBenchFilterWrites: number;
    __flashBenchLatencyMs: number;
  };
  const sentAt = new Map<number, number>();
  scope.__flashBenchStage = 'full';
  scope.__flashBenchLatencyMs = 0;
  scope.__flashBenchHandlerMs = 0;
  scope.__flashBenchFilterWrites = 0;
  scope.__flashBenchFrames = 0;
  scope.__flashBenchCaptures = 0;
  scope.__flashBenchReplies = 0;
  const countFrame = () => {
    scope.__flashBenchFrames += 1;
    requestAnimationFrame(countFrame);
  };
  requestAnimationFrame(countFrame);

  // `judge` runs everything but the mitigation's style write.
  const filter = Object.getOwnPropertyDescriptor(
    CSSStyleDeclaration.prototype,
    'filter',
  );
  if (filter?.set) {
    const nativeSet = filter.set;
    Object.defineProperty(CSSStyleDeclaration.prototype, 'filter', {
      ...filter,
      set(value: string) {
        scope.__flashBenchFilterWrites += 1;
        if (scope.__flashBenchStage !== 'judge') nativeSet.call(this, value);
      },
    });
  }

  const NativeWorker = window.Worker;
  class BenchWorker extends NativeWorker {
    #isReadback = false;
    #listener: ((event: MessageEvent) => void) | null = null;

    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.#isReadback = options?.name === 'flash-guard-readback';
      if (this.#isReadback) {
        super.addEventListener('message', (event: MessageEvent) => {
          scope.__flashBenchReplies += 1;
          const sent = sentAt.get(event.data.id);
          if (sent !== undefined) {
            scope.__flashBenchLatencyMs += performance.now() - sent;
            sentAt.delete(event.data.id);
          }
          const started = performance.now();
          this.#listener?.(event);
          scope.__flashBenchHandlerMs += performance.now() - started;
        });
      }
    }

    set onmessage(listener: ((event: MessageEvent) => void) | null) {
      if (this.#isReadback) this.#listener = listener;
      else super.onmessage = listener;
    }

    get onmessage() {
      return this.#isReadback
        ? this.#listener
        : (super.onmessage as ((event: MessageEvent) => void) | null);
    }

    postMessage(message: unknown, transfer?: unknown) {
      const request = message as { id: number; bitmap?: ImageBitmap };
      if (this.#isReadback && request.bitmap) {
        scope.__flashBenchCaptures += 1;
        sentAt.set(request.id, performance.now());
        if (scope.__flashBenchStage === 'capture') {
          request.bitmap.close();
          sentAt.delete(request.id);
          const answer = new MessageEvent('message', {
            data: { id: request.id, decision: null, pixels: null },
          });
          queueMicrotask(() => this.#listener?.(answer));
          return;
        }
      }
      super.postMessage(message, transfer as Transferable[]);
    }
  }
  window.Worker = BenchWorker as unknown as typeof Worker;
}

async function setStage(page: Page, stage: Stage, current: { guard: boolean }) {
  const wantGuard = stage !== 'off';
  if (wantGuard !== current.guard) {
    await page.evaluate(() =>
      (
        window as unknown as {
          __stims_agent: { run: (id: string) => Promise<unknown> };
        }
      ).__stims_agent.run('toggle-reduce-flashing'),
    );
    current.guard = wantGuard;
  }
  await page.evaluate((next) => {
    (window as unknown as { __flashBenchStage: string }).__flashBenchStage =
      next;
  }, stage);
}

async function measureWindow(page: Page) {
  await page.waitForTimeout(SETTLE_MS);
  const read = () =>
    page.evaluate(() => {
      const scope = window as unknown as {
        __flashBenchFrames: number;
        __flashBenchCaptures: number;
        __flashBenchHandlerMs: number;
        __flashBenchFilterWrites: number;
        __flashBenchLatencyMs: number;
        __flashBenchReplies: number;
      };
      return {
        latencyMs: scope.__flashBenchLatencyMs,
        replies: scope.__flashBenchReplies,
        frames: scope.__flashBenchFrames,
        captures: scope.__flashBenchCaptures,
        handlerMs: scope.__flashBenchHandlerMs,
        filterWrites: scope.__flashBenchFilterWrites,
        at: performance.now(),
      };
    });
  const before = await read();
  await page.waitForTimeout(WINDOW_MS);
  const after = await read();
  const seconds = (after.at - before.at) / 1000;
  return {
    fps: (after.frames - before.frames) / seconds,
    capturesPerSecond: (after.captures - before.captures) / seconds,
    handlerMsPerCapture:
      (after.handlerMs - before.handlerMs) /
      Math.max(1, after.captures - before.captures),
    filterWritesPerSecond: (after.filterWrites - before.filterWrites) / seconds,
    latencyMsPerReply:
      (after.latencyMs - before.latencyMs) /
      Math.max(1, after.replies - before.replies),
  };
}

async function measurePreset(
  browser: Browser,
  port: number,
  renderer: string,
  preset: string,
  throttle: number,
) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  await context.addInitScript(interceptReadback);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  }
  await page.goto(
    `http://localhost:${port}/?renderer=${renderer}&mockAudio=demo&preset=${encodeURIComponent(preset)}`,
  );
  await page.waitForFunction(
    () =>
      (
        window as unknown as {
          __stims_agent?: { getState?: () => { engineReady?: boolean } };
        }
      ).__stims_agent?.getState?.().engineReady === true,
    undefined,
    { timeout: 120_000 },
  );
  await page.evaluate(() =>
    (
      window as unknown as {
        __stims_agent: { run: (id: string) => Promise<unknown> };
      }
    ).__stims_agent.run('audio-demo'),
  );
  await page.waitForTimeout(WARMUP_MS);

  const results: Record<Stage, number[]> = {
    off: [],
    capture: [],
    judge: [],
    full: [],
  };
  let captureRate = 0;
  let handlerMs = 0;
  let filterWrites = 0;
  let latencyMs = 0;
  const current = { guard: true };
  for (const stage of [...STAGES, ...[...STAGES].reverse()]) {
    await setStage(page, stage, current);
    const measured = await measureWindow(page);
    results[stage].push(measured.fps);
    if (stage === 'full') {
      captureRate = measured.capturesPerSecond;
      handlerMs = measured.handlerMsPerCapture;
      filterWrites = measured.filterWritesPerSecond;
      latencyMs = measured.latencyMsPerReply;
    }
  }
  const backend = await page.evaluate(
    () =>
      (
        window as unknown as {
          __stims_agent: { getState: () => { backend?: string } };
        }
      ).__stims_agent.getState().backend ?? 'unknown',
  );
  await context.close();
  return { backend, results, captureRate, handlerMs, filterWrites, latencyMs };
}

export async function runDeliveredFrameBench(args: string[]) {
  const throttle = Number(readArg(args, '--throttle') ?? 6);
  const presetArg = readArg(args, '--preset');
  const rendererArg = readArg(args, '--renderer');
  const port = Number(readArg(args, '--port') ?? 5202);
  const presets = presetArg ? presetArg.split(',') : DEFAULT_PRESETS;
  const renderers = rendererArg ? [rendererArg] : ['webgl', 'webgpu'];

  const server = await ensureProductionServer(port, process.cwd());
  const browser = await chromium.launch({
    headless: true,
    channel: 'chromium',
    args: [
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-webgpu',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    console.log(`\n  Delivered fps at ${throttle}x CPU throttle (A-B-B-A)\n`);
    console.log(
      `  ${'backend'.padEnd(8)}${'preset'.padEnd(30)}${STAGES.map((s) => s.padEnd(10)).join('')}captures/s  handler ms  latency ms  filter writes/s`,
    );
    for (const renderer of renderers) {
      for (const preset of presets) {
        const {
          backend,
          results,
          captureRate,
          handlerMs,
          filterWrites,
          latencyMs,
        } = await measurePreset(browser, port, renderer, preset, throttle);
        const cells = STAGES.map((stage) =>
          results[stage]
            .map((fps) => fps.toFixed(0))
            .join(', ')
            .padEnd(10),
        ).join('');
        console.log(
          `  ${backend.padEnd(8)}${preset.slice(0, 28).padEnd(30)}${cells}${captureRate.toFixed(0).padEnd(12)}${handlerMs.toFixed(2).padEnd(12)}${latencyMs.toFixed(1).padEnd(12)}${filterWrites.toFixed(1)}`,
        );
      }
    }
    console.log('');
  } finally {
    await browser.close();
    await server.close();
  }
}
