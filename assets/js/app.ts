import { setRendererTelemetryHandler } from './core/renderer-capabilities.ts';
import { isSmartTvDevice } from './utils/device-detect.ts';

type LoaderModule = typeof import('./loader.ts');
type LoaderOverrides = {
  loadToy?: LoaderModule['loadToy'];
  loadFromQuery?: LoaderModule['loadFromQuery'];
  initNavigation?: LoaderModule['initNavigation'];
};

const recordRendererTelemetry = () => {
  setRendererTelemetryHandler((_event, detail) => {
    try {
      const key = 'stims:renderer-support-stats';
      const raw = window.localStorage.getItem(key);
      const existing = raw ? JSON.parse(raw) : {};
      const stats = {
        samples: Number(existing.samples ?? 0) + 1,
        webgpu: Number(existing.webgpu ?? 0) + Number(detail.isWebGPUSupported),
        webglFallback:
          Number(existing.webglFallback ?? 0) +
          Number(!detail.isWebGPUSupported),
        hiFiReady:
          Number(existing.hiFiReady ?? 0) +
          Number(detail.webgpu?.recommendedQualityPreset === 'hi-fi'),
        timestampQuery:
          Number(existing.timestampQuery ?? 0) +
          Number(detail.webgpu?.features.timestampQuery === true),
        shaderF16:
          Number(existing.shaderF16 ?? 0) +
          Number(detail.webgpu?.features.shaderF16 === true),
        workerOffscreenReady:
          Number(existing.workerOffscreenReady ?? 0) +
          Number(
            detail.webgpu?.workers.workers === true &&
              detail.webgpu?.workers.offscreenCanvas === true &&
              detail.webgpu?.workers.transferControlToOffscreen === true,
          ),
        lastFallbackReason: detail.fallbackReason,
        lastPreferredCanvasFormat: detail.webgpu?.preferredCanvasFormat ?? null,
        lastPerformanceTier: detail.webgpu?.performanceTier ?? null,
        lastUpdatedAt: new Date().toISOString(),
      };
      window.localStorage.setItem(key, JSON.stringify(stats));
    } catch (_error) {
      // Ignore telemetry persistence failures.
    }
  });
};

const startApp = async () => {
  recordRendererTelemetry();

  if (document.body) {
    document.body.classList.toggle('tv-mode', isSmartTvDevice());
  }

  const audioControlsContainer = document.querySelector<HTMLElement>(
    '[data-audio-controls]',
  );
  const settingsContainer = document.querySelector<HTMLElement>(
    '[data-settings-panel]',
  );
  const navContainer = document.querySelector<HTMLElement>(
    '[data-top-nav-container]',
  );
  const pageType = document.body?.dataset?.page;

  Promise.resolve().then(async () => {
    const { initGamepadNavigation } = await import(
      './utils/gamepad-navigation.ts'
    );
    initGamepadNavigation();
  });

  if (pageType === 'toy' || pageType === 'library') {
    const [{ createLoader }, { createRouter }] = await Promise.all([
      import('./loader.ts'),
      import('./router.ts'),
    ]);
    const router = createRouter();
    const defaultLoader = createLoader({ router });
    const loaderOverrides =
      (
        globalThis as unknown as {
          __stimsLoaderOverrides?: LoaderOverrides;
        }
      ).__stimsLoaderOverrides ?? {};
    const loader = {
      ...defaultLoader,
      ...loaderOverrides,
    };
    const loadFromQuery = loader.loadFromQuery ?? defaultLoader.loadFromQuery;
    const initNavigation =
      loader.initNavigation ?? defaultLoader.initNavigation;

    if (pageType === 'toy') {
      const [{ bootToyPage }, { initAgentAPI }] = await Promise.all([
        import('./bootstrap/toy-page.ts'),
        import('./core/agent-api.ts'),
      ]);
      initAgentAPI();
      bootToyPage({
        router,
        loadFromQuery,
        initNavigation,
        audioControlsContainer,
        settingsContainer,
      });
      return;
    }

    const { bootLibraryPage } = await import('./bootstrap/library-page.ts');
    bootLibraryPage({
      navContainer,
      loadToy: loader.loadToy ?? defaultLoader.loadToy,
      initNavigation,
      loadFromQuery,
    });
    return;
  }

  const { bootHomePage } = await import('./bootstrap/home-page.ts');
  bootHomePage({
    navContainer,
  });
};

let appStarted = false;

const appReady = new Promise<void>((resolve) => {
  const startAppOnce = () => {
    if (appStarted) {
      resolve();
      return;
    }
    appStarted = true;
    void startApp().finally(resolve);
  };

  if (document.readyState === 'loading' && !document.body) {
    document.addEventListener('DOMContentLoaded', startAppOnce, { once: true });
  } else {
    startAppOnce();
  }
});

(
  globalThis as typeof globalThis & { __stimsAppReady?: Promise<void> }
).__stimsAppReady = appReady;
