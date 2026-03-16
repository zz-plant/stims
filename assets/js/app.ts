import { bootLibraryPage } from './bootstrap/library-page.ts';
import { bootToyPage } from './bootstrap/toy-page.ts';
import { initAgentAPI } from './core/agent-api.ts';
import { setRendererTelemetryHandler } from './core/renderer-capabilities.ts';
import { createLoader } from './loader.ts';
import { createRouter } from './router.ts';
import { isSmartTvDevice } from './utils/device-detect.ts';
import { initGamepadNavigation } from './utils/gamepad-navigation.ts';

type LoaderOverrides = {
  loadToy?: typeof import('./loader.ts').loadToy;
  loadFromQuery?: typeof import('./loader.ts').loadFromQuery;
  initNavigation?: typeof import('./loader.ts').initNavigation;
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
        lastFallbackReason: detail.fallbackReason,
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

  const router = createRouter();

  const persistentBackLink = document.querySelector<HTMLAnchorElement>(
    '[data-back-to-library-persistent]',
  );
  if (persistentBackLink) {
    persistentBackLink.href = router.getLibraryHref();
  }
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

  const loadToy = loader.loadToy ?? defaultLoader.loadToy;
  const loadFromQuery = loader.loadFromQuery ?? defaultLoader.loadFromQuery;
  const initNavigation = loader.initNavigation ?? defaultLoader.initNavigation;

  const navContainer = document.querySelector<HTMLElement>(
    '[data-top-nav-container]',
  );
  const audioControlsContainer = document.querySelector<HTMLElement>(
    '[data-audio-controls]',
  );
  const settingsContainer = document.querySelector<HTMLElement>(
    '[data-settings-panel]',
  );
  const libraryList = document.getElementById('toy-list');
  const pageType = document.body?.dataset?.page;

  if (libraryList) {
    bootLibraryPage({
      navContainer,
      loadToy,
      initNavigation,
      loadFromQuery,
    });
  }

  Promise.resolve().then(() => initGamepadNavigation());

  if (pageType === 'toy') {
    initAgentAPI();
    bootToyPage({
      router,
      loadFromQuery,
      initNavigation,
      audioControlsContainer,
      settingsContainer,
      persistentBackLink,
    });
  } else if (!libraryList) {
    initNavigation();
    void loadFromQuery();
  }
};

let appStarted = false;

const startAppOnce = () => {
  if (appStarted) return;
  appStarted = true;
  void startApp();
};

if (document.readyState === 'loading' && !document.body) {
  document.addEventListener('DOMContentLoaded', startAppOnce, { once: true });
} else {
  startAppOnce();
}
