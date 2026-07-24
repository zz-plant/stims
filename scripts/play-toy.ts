import fs from 'node:fs';
import path from 'node:path';
import {
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  chromium,
  type Page,
} from 'playwright';
import sharp from 'sharp';
import { appendParityArtifactEntry } from './parity-artifacts.ts';

export type PlayToyResult = {
  slug: string;
  success: boolean;
  presetId?: string;
  screenshot?: string;
  debugSnapshot?: string;
  video?: string;
  error?: string;
  consoleErrors?: string[];
  audioActive?: boolean;
  vibeModeActivated?: boolean;
  fallbackOccurred?: boolean;
  performance?: PlayToyPerformanceMetrics;
};

export type PlayToyRendererProfile = 'compatibility' | 'webgpu';
export type PlayToyCatalogMode = 'bundled' | 'certification';
export type PlayToyScreenshotSurface = 'canvas' | 'page';

export type PlayToyPerformanceCaptureOptions = {
  warmupMs: number;
};

export type PlayToyPerformanceMetrics = {
  durationMs: number;
  warmupMs: number;
  sampleCount: number;
  averageFrameMs: number | null;
  p95FrameMs: number | null;
  averageSimulationMs: number | null;
  averageRenderMs: number | null;
  actualBackend: 'webgl' | 'webgpu' | null;
  fallbackOccurred: boolean;
  terminalAdaptiveQuality: unknown | null;
};

export type PlayToyBrowserSession = {
  browser: Browser;
  headless: boolean;
  rendererProfile: PlayToyRendererProfile;
};

export type PlayToyOptions = {
  slug: string;
  audioMode?: 'demo' | 'none';
  presetId?: string;
  port?: number;
  duration?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  screenshot?: boolean;
  debugSnapshot?: boolean;
  video?: boolean;
  outputDir?: string;
  headless?: boolean;
  vibeMode?: boolean;
  rendererProfile?: PlayToyRendererProfile;
  catalogMode?: PlayToyCatalogMode;
  screenshotSurface?: PlayToyScreenshotSurface;
  perfCapture?: PlayToyPerformanceCaptureOptions;
  recordParityArtifact?: boolean;
  browserSession?: PlayToyBrowserSession;
};

type NormalizedPlayToyOptions = PlayToyOptions & {
  audioMode: 'demo' | 'none';
  port: number;
  duration: number;
  viewportWidth: number;
  viewportHeight: number;
  outputDir: string;
  headless: boolean;
  vibeMode: boolean;
  rendererProfile: PlayToyRendererProfile;
  catalogMode: PlayToyCatalogMode;
  screenshotSurface: PlayToyScreenshotSurface;
  perfCapture?: PlayToyPerformanceCaptureOptions;
  recordParityArtifact: boolean;
};

const DEFAULT_OPTIONS = {
  port: 5173,
  duration: 5000,
  viewportWidth: 1280,
  viewportHeight: 720,
  outputDir: './screenshots',
};
const SHELL_DEMO_SELECTOR = '[data-demo-audio-btn]';
const CONTROL_DEMO_SELECTOR = '#use-demo-audio';
const AUDIO_DEMO_LABEL = 'Start with demo audio';
const PREFLIGHT_CONTINUE_LABEL = 'Choose audio';
const PREFLIGHT_DEMO_LABEL = 'Start with demo';
const PREFLIGHT_LIGHTER_LABEL = 'Enable lighter visual mode';
const WEBGL_FALLBACK_LABEL = 'Continue with WebGL';
const COMPATIBILITY_RENDERER_ARGS = [
  '--use-angle=swiftshader',
  '--use-gl=angle',
  '--enable-webgl',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];
const WEBGPU_RENDERER_ARGS = [
  '--enable-unsafe-webgpu',
  '--ignore-gpu-blocklist',
  '--enable-features=WebGPU,SharedArrayBuffer',
  '--enable-dawn-features=allow_unsafe_apis',
  '--disable-dawn-features=disallow_unsafe_apis',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
];
const VULKAN_WEBGPU_RENDERER_ARGS = [
  '--enable-features=Vulkan',
  '--use-angle=vulkan',
  '--use-gl=angle',
];
const INITIAL_SHELL_TIMEOUT_MS = 60000;
const TOY_LOAD_TIMEOUT_MS = 30000;
// Route-driven demo audio activates a few seconds after the runtime is ready;
// 5s used to race that and fail intermittently. Wait with real margin.
const AUDIO_ACTIVATION_TIMEOUT_MS = 15000;

type PlayToyPerformanceSample = {
  frameMs: number;
  renderMs: number;
  simulationMs: number;
};

type PlayToyPerformanceSampleSummary = {
  sampleCount: number;
  averageFrameMs: number | null;
  p95FrameMs: number | null;
  averageSimulationMs: number | null;
  averageRenderMs: number | null;
};

type PlayToyRuntimePerformanceSnapshotLike = Partial<
  Pick<
    PlayToyPerformanceMetrics,
    | 'sampleCount'
    | 'averageFrameMs'
    | 'p95FrameMs'
    | 'averageSimulationMs'
    | 'averageRenderMs'
  >
>;

type PlayToyAdaptiveQualitySnapshotLike = Partial<{
  sampleCount: number;
  averageFrameMs: number | null;
  averageRenderMs: number | null;
}>;

function average(values: readonly number[]) {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: readonly number[], percentileValue: number) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const clampedPercentile = Math.min(Math.max(percentileValue, 0), 1);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(clampedPercentile * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

export function summarizePlayToyPerformanceSamples(
  samples: readonly PlayToyPerformanceSample[],
): PlayToyPerformanceSampleSummary {
  return {
    sampleCount: samples.length,
    averageFrameMs: average(samples.map((sample) => sample.frameMs)),
    p95FrameMs: percentile(
      samples.map((sample) => sample.frameMs),
      0.95,
    ),
    averageSimulationMs: average(samples.map((sample) => sample.simulationMs)),
    averageRenderMs: average(samples.map((sample) => sample.renderMs)),
  };
}

export function buildPlayToyPerformanceMetrics({
  samples,
  durationMs,
  warmupMs,
  actualBackend,
  fallbackOccurred,
  terminalAdaptiveQuality,
}: {
  samples: readonly PlayToyPerformanceSample[];
  durationMs: number;
  warmupMs: number;
  actualBackend: 'webgl' | 'webgpu' | null;
  fallbackOccurred: boolean;
  terminalAdaptiveQuality: unknown | null;
}): PlayToyPerformanceMetrics {
  return {
    ...summarizePlayToyPerformanceSamples(samples),
    durationMs,
    warmupMs,
    actualBackend,
    fallbackOccurred,
    terminalAdaptiveQuality,
  };
}

export function normalizePlayToyOptions(
  options: PlayToyOptions,
): NormalizedPlayToyOptions {
  return {
    ...options,
    audioMode: options.audioMode ?? 'demo',
    port: options.port ?? DEFAULT_OPTIONS.port,
    duration: options.duration ?? DEFAULT_OPTIONS.duration,
    viewportWidth: options.viewportWidth ?? DEFAULT_OPTIONS.viewportWidth,
    viewportHeight: options.viewportHeight ?? DEFAULT_OPTIONS.viewportHeight,
    outputDir: options.outputDir ?? DEFAULT_OPTIONS.outputDir,
    headless: options.headless !== false,
    vibeMode: options.vibeMode === true,
    rendererProfile: options.rendererProfile ?? 'compatibility',
    catalogMode: options.catalogMode ?? 'bundled',
    screenshotSurface: options.screenshotSurface ?? 'canvas',
    perfCapture: options.perfCapture,
    recordParityArtifact: options.recordParityArtifact !== false,
  };
}

function ensureOutputDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeArtifactSegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function buildPlayToyArtifactStem({
  slug,
  presetId,
}: {
  slug: string;
  presetId?: string;
}) {
  const slugSegment = sanitizeArtifactSegment(slug) || 'toy';
  const presetSegment = presetId
    ? sanitizeArtifactSegment(presetId) || 'preset'
    : null;
  return presetSegment
    ? `${slugSegment}--preset-${presetSegment}`
    : slugSegment;
}

export function isPlayToyPresetReady({
  requestedPresetId,
  activePresetId,
}: {
  requestedPresetId?: string;
  activePresetId?: string | null;
}) {
  return !requestedPresetId || requestedPresetId === activePresetId;
}

export function didPlayToyRendererFallback({
  requestedProfile,
  actualBackend,
  explicitFallback,
}: {
  requestedProfile: PlayToyRendererProfile;
  actualBackend: 'webgl' | 'webgpu' | null;
  explicitFallback: boolean;
}) {
  if (explicitFallback) return true;
  if (actualBackend === null) return false;
  const requestedBackend = requestedProfile === 'webgpu' ? 'webgpu' : 'webgl';
  return actualBackend !== requestedBackend;
}

export function resolveChromiumRendererArgs(
  rendererProfile: PlayToyRendererProfile,
  platform: NodeJS.Platform = process.platform,
) {
  if (rendererProfile !== 'webgpu') {
    return COMPATIBILITY_RENDERER_ARGS;
  }
  // macOS WebGPU uses Dawn's native Metal backend. Forcing ANGLE/Vulkan there
  // can create a device whose external instance is lost as soon as rendering
  // begins, producing a black frame that used to be recorded as evidence.
  return platform === 'darwin'
    ? WEBGPU_RENDERER_ARGS
    : [...WEBGPU_RENDERER_ARGS, ...VULKAN_WEBGPU_RENDERER_ARGS];
}

export function buildPlayToyUrl({
  port,
  slug,
  presetId,
  demoAudio = true,
  rendererProfile = 'compatibility',
  catalogMode = 'bundled',
}: {
  port: number;
  slug: string;
  presetId?: string;
  demoAudio?: boolean;
  rendererProfile?: PlayToyRendererProfile;
  catalogMode?: PlayToyCatalogMode;
}) {
  const params = new URLSearchParams({
    agent: 'true',
  });
  const routePath = slug === 'milkdrop' ? '/' : '/milkdrop/';
  if (slug !== 'milkdrop') {
    params.set('experience', slug);
  }
  if (demoAudio) {
    params.set('audio', 'demo');
  }
  if (presetId?.trim()) {
    params.set('preset', presetId.trim());
  }
  params.set('renderer', rendererProfile === 'webgpu' ? 'webgpu' : 'webgl');
  if (catalogMode === 'certification') {
    params.set('corpus', 'certification');
  }
  return `http://127.0.0.1:${port}${routePath}?${params.toString()}`;
}

async function closeBrowser(browser?: Browser) {
  if (browser) {
    await browser.close();
  }
}

export async function createPlayToyBrowserSession({
  headless = true,
  rendererProfile = 'compatibility',
}: {
  headless?: boolean;
  rendererProfile?: PlayToyRendererProfile;
} = {}): Promise<PlayToyBrowserSession> {
  return {
    browser: await chromium.launch({
      headless,
      args: resolveChromiumRendererArgs(rendererProfile),
    }),
    headless,
    rendererProfile,
  };
}

export async function closePlayToyBrowserSession(
  session?: PlayToyBrowserSession,
) {
  await closeBrowser(session?.browser);
}

async function createPlayToyContext({
  browser,
  options,
}: {
  browser: Browser;
  options: NormalizedPlayToyOptions;
}): Promise<BrowserContext> {
  return await browser.newContext({
    viewport: {
      width: options.viewportWidth,
      height: options.viewportHeight,
    },
    deviceScaleFactor: 1,
    recordVideo: options.video ? { dir: options.outputDir } : undefined,
    permissions: ['microphone'],
  });
}

async function clickVisibleButton(page: Page, selector: string) {
  try {
    return await page.evaluate((buttonSelector) => {
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
  } catch (_error) {
    return false;
  }
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

export function shouldRequestDemoAudio({
  demoRequestedByRoute,
  audioActive,
}: {
  demoRequestedByRoute: boolean;
  audioActive: boolean;
}) {
  return demoRequestedByRoute && !audioActive;
}

export function getPlayToyAudioActivationError({
  demoRequestedByRoute,
  audioActive,
}: {
  demoRequestedByRoute: boolean;
  audioActive: boolean;
}) {
  if (!demoRequestedByRoute || audioActive) {
    return null;
  }

  return 'Demo audio was requested by the capture route, but audio never became active.';
}

async function requestDemoAudio(page: Page) {
  if (await isAudioActive(page)) {
    return true;
  }

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
  const handleEvaluationFailure = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (
      normalized.includes('execution context was destroyed') ||
      normalized.includes('target page, context or browser has been closed')
    ) {
      return null;
    }
    throw error;
  };

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), 500);
    });
    const evaluation = page
      .evaluate(() => {
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
      })
      .catch(handleEvaluationFailure);

    return await Promise.race([evaluation, timeout]);
  } catch (error) {
    return handleEvaluationFailure(error);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}

async function getMilkdropDebugSnapshot(page: Page) {
  return page
    .evaluate(() => {
      const stimState = (
        window as typeof window & {
          stimState?: {
            getDebugSnapshot?: (key: string) => unknown | null;
          };
        }
      ).stimState;
      if (!stimState || typeof stimState.getDebugSnapshot !== 'function') {
        return null;
      }
      return stimState.getDebugSnapshot('milkdrop');
    })
    .catch(() => null);
}

async function getActiveRenderBackend(page: Page) {
  return page
    .evaluate(() => {
      const backend = document.body.dataset.activeBackend;
      return backend === 'webgl' || backend === 'webgpu' ? backend : null;
    })
    .catch(() => null);
}

async function waitForPerformanceSamplerTarget(page: Page, timeout = 5000) {
  try {
    await page.waitForFunction(
      () => {
        const win = window as Window & {
          __milkdropRuntimeDebug?: {
            getRuntime?: () => {
              toy?: {
                render?: () => void;
              };
            } | null;
            getAdapter?: () => {
              render?: (...args: unknown[]) => unknown;
            } | null;
          };
        };
        const runtime = win.__milkdropRuntimeDebug?.getRuntime?.();
        const adapter = win.__milkdropRuntimeDebug?.getAdapter?.();
        return Boolean(runtime?.toy && typeof adapter?.render === 'function');
      },
      undefined,
      { timeout },
    );
    return true;
  } catch {
    return false;
  }
}

async function installPerformanceSampler(page: Page, warmupMs: number) {
  return page
    .evaluate((warmupDurationMs) => {
      const win = window as Window & {
        __stimsPlayToyPerfSampler?: {
          warmupMs: number;
          startedAtMs: number;
          fallbackOccurred: boolean;
          samples: PlayToyPerformanceSample[];
          currentFrameRenderMs: number;
          requestAnimationFramePatched: boolean;
          adapterRenderPatched: boolean;
          toyRenderPatched: boolean;
        };
        __milkdropRuntimeDebug?: {
          getRuntime?: () => {
            toy?: {
              render?: () => void;
            };
          } | null;
          getAdapter?: () => {
            render?: (...args: unknown[]) => unknown;
          } | null;
        };
      };

      if (win.__stimsPlayToyPerfSampler) {
        return true;
      }

      const runtimeDebug = win.__milkdropRuntimeDebug;
      const runtime = runtimeDebug?.getRuntime?.();
      const adapter = runtimeDebug?.getAdapter?.();
      if (!runtime || !adapter || !runtime.toy) {
        return false;
      }

      const sampler: {
        warmupMs: number;
        startedAtMs: number;
        fallbackOccurred: boolean;
        samples: PlayToyPerformanceSample[];
        currentFrameRenderMs: number;
        requestAnimationFramePatched: boolean;
        adapterRenderPatched: boolean;
        toyRenderPatched: boolean;
      } = {
        warmupMs: warmupDurationMs,
        startedAtMs: performance.now(),
        fallbackOccurred: false,
        samples: [],
        currentFrameRenderMs: 0,
        requestAnimationFramePatched: false,
        adapterRenderPatched: false,
        toyRenderPatched: false,
      };

      const originalRequestAnimationFrame =
        window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = ((callback) =>
        originalRequestAnimationFrame((timestamp) => {
          const frameStartMs = performance.now();
          sampler.currentFrameRenderMs = 0;
          try {
            callback(timestamp);
          } finally {
            const frameMs = performance.now() - frameStartMs;
            if (frameStartMs - sampler.startedAtMs >= sampler.warmupMs) {
              sampler.samples.push({
                frameMs,
                renderMs: sampler.currentFrameRenderMs,
                simulationMs: Math.max(
                  0,
                  frameMs - sampler.currentFrameRenderMs,
                ),
              });
            }
          }
        })) as typeof window.requestAnimationFrame;
      sampler.requestAnimationFramePatched = true;

      const patchRender = <
        TTarget extends {
          render?: (...args: unknown[]) => unknown;
        },
      >(
        target: TTarget,
      ) => {
        if (typeof target.render !== 'function') {
          return false;
        }

        const originalRender = target.render.bind(target);
        target.render = ((...args: unknown[]) => {
          const renderStartMs = performance.now();
          try {
            return originalRender(...args);
          } finally {
            sampler.currentFrameRenderMs += performance.now() - renderStartMs;
          }
        }) as TTarget['render'];
        return true;
      };

      sampler.adapterRenderPatched = patchRender(adapter);
      sampler.toyRenderPatched = patchRender(runtime.toy);
      win.__stimsPlayToyPerfSampler = sampler;
      return true;
    }, warmupMs)
    .catch(() => false);
}

export function buildPlayToyPerformanceMetricsFromDebugSnapshot({
  snapshot,
  durationMs,
  warmupMs,
  actualBackend,
  fallbackOccurred,
  runtimePerformance,
  runtimeAdaptiveQuality,
}: {
  snapshot: unknown;
  durationMs: number;
  warmupMs: number;
  actualBackend: 'webgl' | 'webgpu' | null;
  fallbackOccurred: boolean;
  runtimePerformance?: PlayToyRuntimePerformanceSnapshotLike | null;
  runtimeAdaptiveQuality?: PlayToyAdaptiveQualitySnapshotLike | null;
}) {
  if (
    !(snapshot && typeof snapshot === 'object') &&
    !runtimePerformance &&
    !runtimeAdaptiveQuality
  ) {
    return null;
  }

  const snapshotRecord = snapshot as {
    adaptiveQuality?: unknown;
    performance?: {
      sampleCount?: number;
      averageFrameMs?: number | null;
      p95FrameMs?: number | null;
      averageSimulationMs?: number | null;
      averageRenderMs?: number | null;
    } | null;
  };
  const performance = runtimePerformance ?? snapshotRecord?.performance ?? null;
  const adaptiveQuality =
    runtimeAdaptiveQuality ??
    (snapshotRecord?.adaptiveQuality &&
    typeof snapshotRecord.adaptiveQuality === 'object'
      ? (snapshotRecord.adaptiveQuality as {
          sampleCount?: number;
          averageFrameMs?: number | null;
          averageRenderMs?: number | null;
        })
      : null);
  if (!(performance && typeof performance === 'object') && !adaptiveQuality) {
    return null;
  }

  return {
    durationMs,
    warmupMs,
    sampleCount: performance?.sampleCount ?? adaptiveQuality?.sampleCount ?? 0,
    averageFrameMs:
      performance?.averageFrameMs ?? adaptiveQuality?.averageFrameMs ?? null,
    p95FrameMs: performance?.p95FrameMs ?? null,
    averageSimulationMs:
      performance?.averageSimulationMs ??
      (adaptiveQuality?.averageFrameMs !== null &&
      adaptiveQuality?.averageFrameMs !== undefined &&
      adaptiveQuality?.averageRenderMs !== null &&
      adaptiveQuality?.averageRenderMs !== undefined
        ? Math.max(
            0,
            adaptiveQuality.averageFrameMs - adaptiveQuality.averageRenderMs,
          )
        : null),
    averageRenderMs:
      performance?.averageRenderMs ?? adaptiveQuality?.averageRenderMs ?? null,
    actualBackend,
    fallbackOccurred,
    terminalAdaptiveQuality: adaptiveQuality ?? null,
  } satisfies PlayToyPerformanceMetrics;
}

async function collectPerformanceSampler(page: Page) {
  return page
    .evaluate(() => {
      const win = window as Window & {
        __stimsPlayToyPerfSampler?: {
          fallbackOccurred: boolean;
          startedAtMs: number;
          warmupMs: number;
          samples: PlayToyPerformanceSample[];
        };
        __milkdropRuntimeDebug?: {
          getState?: () => {
            activePresetId: string;
            backend: 'webgl' | 'webgpu';
            status: string | null;
          };
          getAdaptiveQuality?: () => unknown | null;
          getPerformance?: () => unknown | null;
        };
        stimState?: {
          getDebugSnapshot?: (key: string) => unknown | null;
        };
      };

      const sampler = win.__stimsPlayToyPerfSampler;
      const debugSnapshot = win.stimState?.getDebugSnapshot?.('milkdrop');
      const backend = win.__milkdropRuntimeDebug?.getState?.().backend ?? null;
      const actualBackend =
        backend === 'webgl' || backend === 'webgpu' ? backend : null;
      const liveAdaptiveQuality =
        win.__milkdropRuntimeDebug?.getAdaptiveQuality?.() ?? null;
      const livePerformance =
        win.__milkdropRuntimeDebug?.getPerformance?.() ?? null;

      if (
        !sampler &&
        !actualBackend &&
        !liveAdaptiveQuality &&
        !livePerformance
      ) {
        return null;
      }

      return {
        warmupMs: sampler?.warmupMs ?? 0,
        fallbackOccurred:
          (sampler?.fallbackOccurred ?? false) ||
          (actualBackend !== null && actualBackend !== 'webgpu'),
        actualBackend,
        terminalAdaptiveQuality:
          debugSnapshot &&
          typeof debugSnapshot === 'object' &&
          'adaptiveQuality' in debugSnapshot
            ? ((debugSnapshot as { adaptiveQuality?: unknown })
                .adaptiveQuality ?? null)
            : null,
        liveAdaptiveQuality,
        livePerformance,
        samples: sampler?.samples ?? [],
      };
    })
    .catch(() => null);
}

export function shouldUseCanvasBitmapCapture({
  bitmapWidth,
  bitmapHeight,
  rectWidth,
  rectHeight,
  viewportWidth,
  viewportHeight,
}: {
  bitmapWidth: number;
  bitmapHeight: number;
  rectWidth: number;
  rectHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}) {
  return (
    bitmapWidth === viewportWidth &&
    bitmapHeight === viewportHeight &&
    rectWidth === viewportWidth &&
    rectHeight === viewportHeight
  );
}

export async function captureActiveToyCanvas(
  page: Page,
  screenshotPath: string,
): Promise<boolean> {
  const canvasInfo = await page
    .evaluate(() => {
      const canvas =
        document.querySelector<HTMLCanvasElement>(
          '#active-toy-container .active-toy-stage[data-stage-state="incoming"] canvas',
        ) ??
        document.querySelector<HTMLCanvasElement>(
          '#active-toy-container .active-toy-stage:not([data-stage-state="outgoing"]) canvas',
        ) ??
        document.querySelector<HTMLCanvasElement>('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) {
        return null;
      }

      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      return {
        bitmapWidth: canvas.width,
        bitmapHeight: canvas.height,
        rectX: rect.x,
        rectY: rect.y,
        rectWidth: Math.round(rect.width),
        rectHeight: Math.round(rect.height),
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        backend:
          document.body.dataset.activeBackend === 'webgpu'
            ? ('webgpu' as const)
            : ('webgl' as const),
      };
    })
    .catch(() => null);

  if (!canvasInfo) {
    return false;
  }
  const viewport = page.viewportSize();
  const captureWidth = viewport?.width ?? canvasInfo.viewportWidth;
  const captureHeight = viewport?.height ?? canvasInfo.viewportHeight;

  if (canvasInfo.backend === 'webgpu') {
    await page.evaluate(() => {
      const canvas =
        document.querySelector<HTMLCanvasElement>(
          '#active-toy-container .active-toy-stage[data-stage-state="incoming"] canvas',
        ) ??
        document.querySelector<HTMLCanvasElement>(
          '#active-toy-container .active-toy-stage:not([data-stage-state="outgoing"]) canvas',
        ) ??
        document.querySelector<HTMLCanvasElement>('canvas');
      canvas?.setAttribute('data-stims-capture-target', 'true');
      const style = document.createElement('style');
      style.id = 'stims-canvas-capture-isolation';
      style.textContent =
        'body *:not(:has(canvas[data-stims-capture-target="true"])):not(canvas[data-stims-capture-target="true"]) { opacity: 0 !important; } body *:has(canvas[data-stims-capture-target="true"]) { background: transparent !important; border-color: transparent !important; box-shadow: none !important; } canvas[data-stims-capture-target="true"] { opacity: 1 !important; }';
      document.head.append(style);
    });
    try {
      // Capture the compositor region occupied by the canvas. An element
      // screenshot can transiently hide or resize a WebGPU canvas; transparent
      // sibling overlays preserve layout while keeping shell UI out of frame.
      const buffer = await page.screenshot({
        animations: 'disabled',
        clip: {
          x: canvasInfo.rectX,
          y: canvasInfo.rectY,
          width: canvasInfo.rectWidth,
          height: canvasInfo.rectHeight,
        },
      });
      await sharp(buffer)
        .resize(captureWidth, captureHeight, { fit: 'fill' })
        .png()
        .toFile(screenshotPath);
      return true;
    } catch (_error) {
      return false;
    } finally {
      await page
        .evaluate(() => {
          document.querySelector('#stims-canvas-capture-isolation')?.remove();
          document
            .querySelector('[data-stims-capture-target="true"]')
            ?.removeAttribute('data-stims-capture-target');
        })
        .catch(() => undefined);
    }
  }

  const canvasDataUrl = await page
    .evaluate(() => {
      const canvas =
        document.querySelector<HTMLCanvasElement>(
          '#active-toy-container canvas',
        ) ?? document.querySelector<HTMLCanvasElement>('canvas');
      if (!(canvas instanceof HTMLCanvasElement)) {
        return null;
      }

      try {
        return canvas.toDataURL('image/png');
      } catch (_error) {
        return null;
      }
    })
    .catch(() => null);

  const [, base64Data = ''] = canvasDataUrl?.split(',', 2) ?? [];
  if (!base64Data) {
    return false;
  }

  await sharp(Buffer.from(base64Data, 'base64'))
    .resize(captureWidth, captureHeight, { fit: 'fill' })
    .png()
    .toFile(screenshotPath);
  return true;
}

export async function playToy(options: PlayToyOptions): Promise<PlayToyResult> {
  const normalizedOptions = normalizePlayToyOptions(options);
  const allowWebglFallback = normalizedOptions.rendererProfile !== 'webgpu';

  // Ensure output directory exists
  ensureOutputDir(normalizedOptions.outputDir);

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  const consoleErrors: string[] = [];
  let fallbackOccurred = false;
  const ownsBrowser = !normalizedOptions.browserSession;

  try {
    if (
      normalizedOptions.browserSession &&
      normalizedOptions.browserSession.rendererProfile !==
        normalizedOptions.rendererProfile
    ) {
      throw new Error(
        `PlayToy browser session uses renderer profile "${normalizedOptions.browserSession.rendererProfile}" but request needs "${normalizedOptions.rendererProfile}".`,
      );
    }

    if (
      normalizedOptions.browserSession &&
      normalizedOptions.browserSession.headless !== normalizedOptions.headless
    ) {
      throw new Error(
        `PlayToy browser session uses headless=${normalizedOptions.browserSession.headless} but request needs headless=${normalizedOptions.headless}.`,
      );
    }

    browser =
      normalizedOptions.browserSession?.browser ??
      (
        await createPlayToyBrowserSession({
          headless: normalizedOptions.headless,
          rendererProfile: normalizedOptions.rendererProfile,
        })
      ).browser;

    context = await createPlayToyContext({
      browser,
      options: normalizedOptions,
    });

    page = await context.newPage();

    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') {
        console.error(`[Browser Console error] ${msg.text()}`);
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', (err: Error) => {
      console.error(`[Browser PageError] ${err.stack || err.message}`);
      consoleErrors.push(err.message);
    });

    const demoRequestedByRoute = normalizedOptions.audioMode === 'demo';
    const url = buildPlayToyUrl({
      port: normalizedOptions.port,
      slug: options.slug,
      presetId: normalizedOptions.presetId,
      demoAudio: demoRequestedByRoute,
      rendererProfile: normalizedOptions.rendererProfile,
      catalogMode: normalizedOptions.catalogMode,
    });
    console.log(`Navigating to ${url}...`);

    await page.goto(url);

    if (normalizedOptions.rendererProfile === 'webgpu') {
      const hasNavigatorGpu = await page
        .evaluate(() => typeof navigator.gpu !== 'undefined')
        .catch(() => false);
      if (!hasNavigatorGpu) {
        throw new Error(
          'Chromium WebGPU profile launched without navigator.gpu; parity capture cannot certify WebGPU from this browser session.',
        );
      }
    }

    if (await clickVisibleButtonByText(page, PREFLIGHT_LIGHTER_LABEL)) {
      console.log('Using lighter visual mode from capability preflight...');
    }
    if (await clickVisibleButtonByText(page, PREFLIGHT_DEMO_LABEL)) {
      console.log('Starting demo directly from capability preflight...');
    } else if (
      await clickVisibleButton(page, '[data-preflight-primary-action="true"]')
    ) {
      console.log('Advancing through capability preflight...');
    } else if (await clickVisibleButtonByText(page, PREFLIGHT_CONTINUE_LABEL)) {
      console.log('Advancing through capability preflight...');
    }

    // Wait for either an already-loaded toy or the shell audio controls
    await page.waitForFunction(
      () =>
        document.body.dataset.toyLoaded === 'true' ||
        document.querySelector('.active-toy-status') ||
        (() => {
          const canvas =
            document.querySelector('#active-toy-container canvas') ??
            document.querySelector('canvas');
          if (!(canvas instanceof HTMLCanvasElement)) return false;
          const rect = canvas.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })() ||
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
      if (ownsBrowser) {
        await closeBrowser(browser);
      }
      return {
        slug: options.slug,
        success: false,
        error: `${initialErrorStatus.title}: ${initialErrorStatus.message}`,
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
      };
    }

    // Click demo audio button if present
    if (
      shouldRequestDemoAudio({
        demoRequestedByRoute,
        audioActive: await isAudioActive(page),
      }) &&
      (await requestDemoAudio(page))
    ) {
      console.log('Requesting demo audio...');
    }

    await page.waitForFunction(
      () =>
        document.body.dataset.toyLoaded === 'true' ||
        document.querySelector('.active-toy-status') ||
        (() => {
          const canvas =
            document.querySelector('#active-toy-container canvas') ??
            document.querySelector('canvas');
          if (!(canvas instanceof HTMLCanvasElement)) return false;
          const rect = canvas.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })() ||
        document.querySelector('#use-demo-audio') ||
        document.querySelector('#start-audio-btn'),
      undefined,
      { timeout: TOY_LOAD_TIMEOUT_MS },
    );

    const statusAfterAudioRequest = await getErrorStatus(page);
    if (statusAfterAudioRequest) {
      await page.close();
      await context.close();
      if (ownsBrowser) {
        await closeBrowser(browser);
      }
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
      const webglFallbackVisible = await page
        .evaluate((label) => {
          return [...document.querySelectorAll('button')].some((element) => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            const isVisible =
              style.display !== 'none' &&
              style.visibility !== 'hidden' &&
              rect.width > 0 &&
              rect.height > 0;
            return isVisible && element.textContent?.trim() === label;
          });
        }, WEBGL_FALLBACK_LABEL)
        .catch(() => false);

      if (!allowWebglFallback && webglFallbackVisible) {
        fallbackOccurred = true;
        throw new Error(
          'MilkDrop requested WebGL fallback while the capture runner required a WebGPU-certified session.',
        );
      }

      if (
        allowWebglFallback &&
        (await clickVisibleButtonByText(page, WEBGL_FALLBACK_LABEL))
      ) {
        console.log('Continuing with WebGL fallback...');
        fallbackOccurred = true;
      }

      const demoAudioStillInactive = shouldRequestDemoAudio({
        demoRequestedByRoute,
        audioActive: await isAudioActive(page),
      });
      if (demoAudioStillInactive && (await requestDemoAudio(page))) {
        console.log('Enabling demo audio...');
      } else if (!demoRequestedByRoute) {
        console.log('Keeping deterministic capture audio silent.');
      } else {
        console.log(
          demoRequestedByRoute
            ? 'Demo audio is still inactive; preserving the requested source.'
            : 'No audio start button found. Checking if auto-started...',
        );
      }
    }

    await page.waitForFunction(
      () =>
        document.body.dataset.toyLoaded === 'true' ||
        document.querySelector('.active-toy-status') ||
        (() => {
          const canvas =
            document.querySelector('#active-toy-container canvas') ??
            document.querySelector('canvas');
          if (!(canvas instanceof HTMLCanvasElement)) return false;
          const rect = canvas.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })(),
      undefined,
      { timeout: TOY_LOAD_TIMEOUT_MS },
    );

    const loadErrorStatus = await getErrorStatus(page);
    if (loadErrorStatus) {
      await page.close();
      await context.close();
      if (ownsBrowser) {
        await closeBrowser(browser);
      }
      return {
        slug: options.slug,
        success: false,
        error: `${loadErrorStatus.title}: ${loadErrorStatus.message}`,
        consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
      };
    }
    console.log('Toy loaded.');

    if (normalizedOptions.presetId) {
      console.log(`Waiting for preset ${normalizedOptions.presetId}...`);
      await page.waitForFunction(
        (requestedPresetId) => {
          const win = window as Window & {
            __milkdropRuntimeDebug?: {
              getState?: () => { activePresetId?: string | null };
            };
            stimState?: {
              getDebugSnapshot?: (key: string) => {
                activePresetId?: string | null;
              } | null;
            };
          };
          const runtimePresetId =
            win.__milkdropRuntimeDebug?.getState?.()?.activePresetId;
          const debugSnapshot = win.stimState?.getDebugSnapshot?.('milkdrop');
          const debugPresetId =
            typeof debugSnapshot === 'object' && debugSnapshot !== null
              ? (debugSnapshot as { activePresetId?: string | null })
                  .activePresetId
              : null;
          const activePresetId = runtimePresetId ?? debugPresetId;
          return !requestedPresetId || activePresetId === requestedPresetId;
        },
        normalizedOptions.presetId,
        { timeout: TOY_LOAD_TIMEOUT_MS },
      );
      console.log(`Preset ${normalizedOptions.presetId} ready.`);
    }

    // When demo audio is requested through the route, the shell starts it
    // itself once the runtime is ready — there is no button to click, and the
    // agent-API fallback below can't manufacture one. Route-driven activation
    // lands a few seconds after the toy loads, so wait long enough to cover it
    // rather than racing a short timeout and then failing on a retry that has
    // nothing to click.
    let audioActivated = await waitForAudioActive(
      page,
      AUDIO_ACTIVATION_TIMEOUT_MS,
    );
    if (
      shouldRequestDemoAudio({
        demoRequestedByRoute,
        audioActive: audioActivated,
      })
    ) {
      console.warn('Audio activation timed out. Retrying demo audio...');
      // requestDemoAudio may find nothing to click (the shell exposes no demo
      // button), but the route still drives activation, so wait again
      // regardless of whether the retry located an affordance.
      await requestDemoAudio(page);
      audioActivated = await waitForAudioActive(
        page,
        AUDIO_ACTIVATION_TIMEOUT_MS,
      );
    }

    const audioActivationError = getPlayToyAudioActivationError({
      demoRequestedByRoute,
      audioActive: audioActivated,
    });
    if (audioActivationError) {
      throw new Error(audioActivationError);
    }

    // Trigger a temporary vibe mode in agent sessions when available
    const vibeModeActivated = normalizedOptions.vibeMode
      ? await page
          .evaluate(async () => {
            const stimState = (
              window as typeof window & {
                stimState?: {
                  activateVibeMode?: (durationMs?: number) => Promise<void>;
                };
              }
            ).stimState;
            if (
              !stimState ||
              typeof stimState.activateVibeMode !== 'function'
            ) {
              return false;
            }

            await stimState.activateVibeMode(1800);
            return true;
          })
          .catch(() => false)
      : false;

    let samplerInstalled = false;
    if (normalizedOptions.perfCapture) {
      samplerInstalled =
        (await waitForPerformanceSamplerTarget(page)) &&
        (await installPerformanceSampler(
          page,
          normalizedOptions.perfCapture.warmupMs,
        ));
    }

    // Wait for visualization to run
    console.log(`Watching for ${normalizedOptions.duration}ms...`);
    await page.waitForTimeout(normalizedOptions.duration);

    const runtimeDebugSnapshot = normalizedOptions.perfCapture
      ? await getMilkdropDebugSnapshot(page)
      : null;
    const perfCapture = normalizedOptions.perfCapture
      ? await collectPerformanceSampler(page)
      : null;
    const actualBackend =
      perfCapture?.actualBackend ?? (await getActiveRenderBackend(page));
    const performance =
      perfCapture &&
      Array.isArray(perfCapture.samples) &&
      perfCapture.samples.length > 0
        ? buildPlayToyPerformanceMetrics({
            samples: perfCapture.samples,
            durationMs: normalizedOptions.duration,
            warmupMs: perfCapture.warmupMs,
            actualBackend: perfCapture.actualBackend,
            fallbackOccurred: perfCapture.fallbackOccurred,
            terminalAdaptiveQuality: perfCapture.terminalAdaptiveQuality,
          })
        : runtimeDebugSnapshot && normalizedOptions.perfCapture
          ? buildPlayToyPerformanceMetricsFromDebugSnapshot({
              snapshot: runtimeDebugSnapshot,
              durationMs: normalizedOptions.duration,
              warmupMs: normalizedOptions.perfCapture.warmupMs,
              actualBackend,
              fallbackOccurred:
                fallbackOccurred ||
                (!samplerInstalled &&
                  actualBackend !== null &&
                  actualBackend !== 'webgpu'),
              runtimePerformance: perfCapture?.livePerformance ?? null,
              runtimeAdaptiveQuality: perfCapture?.liveAdaptiveQuality ?? null,
            })
          : undefined;

    const result: PlayToyResult = {
      slug: options.slug,
      success: true,
      presetId: normalizedOptions.presetId,
      consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
      fallbackOccurred: didPlayToyRendererFallback({
        requestedProfile: normalizedOptions.rendererProfile,
        actualBackend,
        explicitFallback: fallbackOccurred,
      }),
      performance: performance ?? undefined,
    };

    // Check audio state
    const audioState = await isAudioActive(page);
    result.audioActive = audioState;
    result.vibeModeActivated = vibeModeActivated;
    const artifactStem = buildPlayToyArtifactStem({
      slug: options.slug,
      presetId: normalizedOptions.presetId,
    });
    const artifactTimestamp = Date.now();

    if (options.screenshot) {
      const screenshotName = `${artifactStem}-${artifactTimestamp}.png`;
      const screenshotPath = path.join(
        normalizedOptions.outputDir,
        screenshotName,
      );
      const capturedCanvas =
        normalizedOptions.screenshotSurface === 'canvas'
          ? await captureActiveToyCanvas(page, screenshotPath)
          : false;
      if (!capturedCanvas) {
        if (normalizedOptions.screenshotSurface === 'canvas') {
          throw new Error('Unable to capture the active toy canvas.');
        }
        await page.screenshot({ path: screenshotPath });
      }
      result.screenshot = screenshotPath;
      console.log(`Screenshot saved to ${screenshotPath}`);
    }

    if (options.debugSnapshot) {
      const snapshot =
        runtimeDebugSnapshot ?? (await getMilkdropDebugSnapshot(page));
      const snapshotName = `${artifactStem}-${artifactTimestamp}.debug.json`;
      const snapshotPath = path.join(normalizedOptions.outputDir, snapshotName);
      fs.writeFileSync(snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
      result.debugSnapshot = snapshotPath;
      console.log(`Debug snapshot saved to ${snapshotPath}`);
    }

    if (
      normalizedOptions.recordParityArtifact &&
      (result.screenshot || result.debugSnapshot)
    ) {
      const captureBackend = await getActiveRenderBackend(page);
      const { manifestPath } = appendParityArtifactEntry(
        normalizedOptions.outputDir,
        {
          kind: 'stims-capture',
          slug: options.slug,
          presetId: normalizedOptions.presetId ?? null,
          files: {
            image: result.screenshot,
            debugSnapshot: result.debugSnapshot,
          },
          capture: {
            backend: captureBackend,
            url,
            durationMs: normalizedOptions.duration,
            viewportWidth: normalizedOptions.viewportWidth,
            viewportHeight: normalizedOptions.viewportHeight,
            audioMode: demoRequestedByRoute ? 'demo' : 'none',
            vibeMode: normalizedOptions.vibeMode,
          },
        },
      );
      console.log(`Parity artifact manifest updated at ${manifestPath}`);
    }

    await page.close();
    await context.close(); // Saves video if enabled
    if (ownsBrowser) {
      await closeBrowser(browser);
    }

    return result;
  } catch (error) {
    let performance: PlayToyPerformanceMetrics | undefined;
    try {
      if (normalizedOptions.perfCapture && page) {
        const runtimeDebugSnapshot = await getMilkdropDebugSnapshot(page);
        const perfCapture = await collectPerformanceSampler(page);
        if (
          perfCapture &&
          Array.isArray(perfCapture.samples) &&
          perfCapture.samples.length > 0
        ) {
          performance = buildPlayToyPerformanceMetrics({
            samples: perfCapture.samples,
            durationMs: normalizedOptions.duration,
            warmupMs: perfCapture.warmupMs,
            actualBackend: perfCapture.actualBackend,
            fallbackOccurred: perfCapture.fallbackOccurred,
            terminalAdaptiveQuality: perfCapture.terminalAdaptiveQuality,
          });
        } else {
          performance =
            buildPlayToyPerformanceMetricsFromDebugSnapshot({
              snapshot: runtimeDebugSnapshot,
              durationMs: normalizedOptions.duration,
              warmupMs: normalizedOptions.perfCapture.warmupMs,
              actualBackend: await getActiveRenderBackend(page),
              fallbackOccurred,
              runtimePerformance: perfCapture?.livePerformance ?? null,
              runtimeAdaptiveQuality: perfCapture?.liveAdaptiveQuality ?? null,
            }) ?? undefined;
        }
      }
    } catch (_perfError) {
      // Ignore perf capture errors on failure paths.
    }
    console.error(`Error playing toy ${options.slug}:`, error);
    if (page) {
      await page.close().catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
    if (ownsBrowser) {
      await closeBrowser(browser);
    }
    return {
      slug: options.slug,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      consoleErrors: consoleErrors.length > 0 ? consoleErrors : undefined,
      fallbackOccurred,
      performance,
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
    console.error(
      '  --preset <id>       Requested preset id for /milkdrop/ runs',
    );
    console.error('  --port <number>     Dev server port (default: 5173)');
    console.error('  --duration <ms>     Duration to run (default: 5000)');
    console.error(
      '  --width <px>        Capture viewport width (default: 1280)',
    );
    console.error(
      '  --height <px>       Capture viewport height (default: 720)',
    );
    console.error('  --no-headless       Run in visible window');
    console.error('  --audio <demo|none> Capture audio mode (default: demo)');
    console.error(
      '  --debug-snapshot    Save the milkdrop agent debug snapshot',
    );
    console.error(
      '  --renderer-profile <compatibility|webgpu>  Chromium launch profile (default: compatibility)',
    );
    console.error(
      '  --catalog-mode <bundled|certification>     Preset corpus to expose in the runtime catalog (default: bundled)',
    );
    console.error('  --vibe-mode         Enable temporary agent vibe mode');
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
  const viewportWidth = getArg('--width', 1280) as number;
  const viewportHeight = getArg('--height', 720) as number;
  const presetId = getArg('--preset', '') as string;
  const audioMode = getArg('--audio', 'demo') as 'demo' | 'none';
  const outputDir = getArg('--output', './screenshots') as string;
  const headless = !args.includes('--no-headless');
  const debugSnapshot = args.includes('--debug-snapshot');
  const vibeMode = args.includes('--vibe-mode');
  const rendererProfile = getArg(
    '--renderer-profile',
    'compatibility',
  ) as PlayToyRendererProfile;
  const catalogMode = getArg('--catalog-mode', 'bundled') as PlayToyCatalogMode;
  const screenshotSurface = getArg(
    '--screenshot-surface',
    'canvas',
  ) as PlayToyScreenshotSurface;

  console.log(`Launching ${slug} on port ${port}...`);

  playToy({
    slug,
    audioMode,
    presetId: presetId.trim() || undefined,
    port,
    screenshot: true,
    debugSnapshot,
    video: false,
    duration,
    viewportWidth,
    viewportHeight,
    outputDir,
    headless,
    vibeMode,
    rendererProfile,
    catalogMode,
    screenshotSurface,
  }).then((res) => console.log(JSON.stringify(res, null, 2)));
}
