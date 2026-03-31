import { installRendererTelemetryPersistence } from './core/renderer-telemetry.ts';
import { isSmartTvDevice } from './utils/device-detect.ts';

type LoaderModule = typeof import('./loader.ts');
type LoaderOverrides = {
  loadToy?: LoaderModule['loadToy'];
  loadFromQuery?: LoaderModule['loadFromQuery'];
  initNavigation?: LoaderModule['initNavigation'];
};

const startApp = async () => {
  installRendererTelemetryPersistence();

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

  if (pageType === 'experience' || pageType === 'library') {
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

    if (pageType === 'experience') {
      const [{ bootToyPage }, { initAgentAPI }] = await Promise.all([
        import('./bootstrap/toy-page.ts'),
        import('./core/agent-api.ts'),
      ]);
      initAgentAPI();
      bootToyPage({
        router,
        loadFromQuery,
        initNavigation,
        navContainer,
        audioControlsContainer,
        settingsContainer,
      });
      return;
    }

    if (pageType === 'library') {
      const { bootLibraryPage } = await import('./bootstrap/library-page.ts');
      bootLibraryPage({
        navContainer,
        loadToy: loader.loadToy ?? defaultLoader.loadToy,
        initNavigation,
        loadFromQuery,
      });
      return;
    }
  }

  if (pageType === 'home') {
    const { bootHomePage } = await import('./bootstrap/home-page.ts');
    bootHomePage({
      navContainer,
    });
    return;
  }
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
