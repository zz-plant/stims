import { initAgentAPI } from './core/agent-api.ts';
import {
  attachCapabilityPreflight,
  type CapabilityPreflightResult,
  PREFLIGHT_SESSION_DISMISS_KEY,
} from './core/capability-preflight.ts';
import { setRendererTelemetryHandler } from './core/renderer-capabilities.ts';
import { startToyAudioFromSource } from './core/toy-audio-startup.ts';
import type { ToyWindow } from './core/toy-globals';
import toyManifest from './data/toy-manifest.ts';
import type { ToyEntry } from './data/toy-schema.ts';
import { createLibraryView } from './library-view.js';
import { createLoader } from './loader.ts';
import { createRouter } from './router.ts';
import { initAudioControls } from './ui/audio-controls.ts';
import { initNavigation as initTopNav } from './ui/nav.ts';
import { initSystemControls } from './ui/system-controls.ts';
import { isSmartTvDevice } from './utils/device-detect.ts';
import { initGamepadNavigation } from './utils/gamepad-navigation.ts';
import { initLibraryView } from './utils/init-library.ts';
import { initNavScrollEffects } from './utils/init-nav-scroll.ts';
import { initQuickstartCta } from './utils/init-quickstart.ts';
import { initSystemCheck } from './utils/init-system-check.ts';

type LoaderOverrides = {
  loadToy?: typeof import('./loader.ts').loadToy;
  loadFromQuery?: typeof import('./loader.ts').loadFromQuery;
  initNavigation?: typeof import('./loader.ts').initNavigation;
};

type Toy = Pick<ToyEntry, 'slug' | 'title'>;
type ToyWithControls = Pick<ToyEntry, 'slug' | 'controls'>;

const runInit = (label: string, init: () => void | Promise<void>) => {
  Promise.resolve()
    .then(() => init())
    .catch((error) => {
      console.error(`Failed to initialize ${label}`, error);
    });
};

const resolveToyTitle = (slug: string | null, toys: Toy[]) => {
  if (!slug) return 'Web toy';
  return toys.find((toy) => toy.slug === slug)?.title ?? slug;
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

  if (navContainer && (pageType === 'library' || libraryList)) {
    initTopNav(navContainer, { mode: 'library' });
  }

  if (libraryList) {
    runInit('library view', async () => {
      const overrides = (globalThis as unknown as { __stimsToyLibrary?: Toy[] })
        .__stimsToyLibrary;
      if (overrides) {
        const libraryView = createLibraryView({
          toys: overrides,
          loadToy,
          initNavigation,
          loadFromQuery,
          targetId: 'toy-list',
          cardElement: 'a',
          enableIcons: false,
          enableCapabilityBadges: true,
          enableKeyboardHandlers: true,
          enableDarkModeToggle: true,
          themeToggleId: 'theme-toggle',
        });
        libraryView.init();
        document.body.dataset.libraryEnhanced = 'true';
        return;
      }

      await initLibraryView({ loadToy, initNavigation, loadFromQuery });
    });

    runInit('quickstart CTA', () => initQuickstartCta({ loadToy }));
    runInit('nav scroll effects', initNavScrollEffects);
    runInit('system check', initSystemCheck);
  }

  runInit('gamepad navigation', () => {
    initGamepadNavigation();
  });

  if (pageType === 'toy') {
    initAgentAPI();

    let loaderStarted = false;
    const startLoaderIfNeeded = () => {
      if (loaderStarted) return;
      loaderStarted = true;
      initNavigation();
      void loadFromQuery();
    };

    const toyWindow = window as unknown as ToyWindow;

    const buildAudioInitState = (result: CapabilityPreflightResult | null) => {
      if (isSmartTvDevice()) {
        return {
          preferDemoAudio: true,
          initialStatus: {
            message:
              'TV mode enabled. Demo audio is selected first for easier remote setup, but microphone and tab audio are still available.',
            variant: 'success' as const,
          },
        };
      }

      if (!result) return {};

      const microphone = result.microphone;
      if (!microphone?.supported) {
        return {
          preferDemoAudio: true,
          initialStatus: {
            message:
              'Microphone access is unavailable in this browser. Use demo, tab, or YouTube audio to keep exploring.',
            variant: 'error' as const,
          },
        };
      }

      if (microphone.state === 'denied') {
        return {
          preferDemoAudio: true,
          initialStatus: {
            message:
              'Microphone access is blocked. Update permissions or use demo, tab, or YouTube audio to start the visuals.',
            variant: 'error' as const,
          },
        };
      }

      return {};
    };

    const setupAudio = (result: CapabilityPreflightResult | null) => {
      if (!audioControlsContainer) return;

      const starterTips = (() => {
        if (!toySlug) return [];
        const toyWithControls = (toyManifest as ToyWithControls[]).find(
          (entry) => entry.slug === toySlug,
        );
        return toyWithControls?.controls ?? [];
      })();
      const firstRunHint = starterTips[0];
      const gestureHints = starterTips.filter((tip) =>
        /touch|drag|pinch|swipe|gesture|tap|rotate/i.test(tip),
      );

      initAudioControls(audioControlsContainer, {
        onRequestMicrophone: async () => {
          startLoaderIfNeeded();
          await startToyAudioFromSource(toyWindow, { source: 'microphone' });
        },
        onRequestDemoAudio: async () => {
          startLoaderIfNeeded();
          await startToyAudioFromSource(toyWindow, { source: 'demo' });
        },
        onRequestYouTubeAudio: async (stream) => {
          startLoaderIfNeeded();
          await startToyAudioFromSource(toyWindow, {
            source: 'youtube',
            stream,
          });
        },
        onRequestTabAudio: async (stream) => {
          startLoaderIfNeeded();
          await startToyAudioFromSource(toyWindow, {
            source: 'tab',
            stream,
          });
        },
        starterTips,
        firstRunHint,
        gestureHints,
        ...buildAudioInitState(result),
      });
    };

    const setupSystemControls = () => {
      if (!settingsContainer || settingsContainer.childElementCount > 0) return;
      initSystemControls(settingsContainer);
    };

    const toySlug = new URLSearchParams(window.location.search).get('toy');
    const toyTitle = resolveToyTitle(toySlug, toyManifest as Toy[]);
    document.title = toySlug ? `${toyTitle} · Stim Webtoy` : document.title;

    const shouldSkipPreflightForSession = (() => {
      try {
        return (
          window.sessionStorage.getItem(PREFLIGHT_SESSION_DISMISS_KEY) === '1'
        );
      } catch (_error) {
        return false;
      }
    })();

    const handlePreflightReady = (result: CapabilityPreflightResult) => {
      if (!result.canProceed) return;
      startLoaderIfNeeded();
      setupAudio(result);
      setupSystemControls();
    };

    const preflight = attachCapabilityPreflight({
      heading: 'Quick check',
      backHref: router.getLibraryHref(),
      openOnAttach: !shouldSkipPreflightForSession,
      onComplete: handlePreflightReady,
      onRetry: handlePreflightReady,
      host: document.body,
    });

    if (shouldSkipPreflightForSession) {
      void preflight.run().then(handlePreflightReady);
    }

    window.addEventListener('pagehide', () => {
      // Cleanup if needed
    });
  } else if (!libraryList) {
    initNavigation();
    void loadFromQuery();
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startApp, { once: true });
} else {
  void startApp();
}
