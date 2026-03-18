import { setAudioActive } from '../core/agent-api.ts';
import {
  attachCapabilityPreflight,
  type CapabilityPreflightResult,
  PREFLIGHT_SESSION_DISMISS_KEY,
} from '../core/capability-preflight.ts';
import { startToyAudioFromSource } from '../core/toy-audio-startup.ts';
import type { ToyWindow } from '../core/toy-globals.ts';
import toyManifest from '../data/toy-manifest.ts';
import type { ToyEntry } from '../data/toy-schema.ts';
import type { createLoader } from '../loader.ts';
import { requestMilkdropPresetSelection } from '../milkdrop/preset-selection.ts';
import { initAudioControls } from '../ui/audio-controls.ts';
import { initSystemControls } from '../ui/system-controls.ts';
import { isSmartTvDevice } from '../utils/device-detect.ts';
import { bindLibraryBackLink } from '../utils/library-back-navigation.ts';

type LoaderApi = ReturnType<typeof createLoader>;
type Toy = Pick<ToyEntry, 'slug' | 'title'>;
type ToyWithControls = Pick<
  ToyEntry,
  | 'slug'
  | 'controls'
  | 'desktopHints'
  | 'touchHints'
  | 'firstRunHint'
  | 'starterPreset'
  | 'wowControl'
  | 'recommendedCapability'
>;

const resolveToyTitle = (slug: string | null, toys: Toy[]) => {
  if (!slug) return 'Web toy';
  return toys.find((toy) => toy.slug === slug)?.title ?? slug;
};

function buildAudioInitState(result: CapabilityPreflightResult | null) {
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
}

export function shouldPreferDemoAudio({
  forcePreferDemoAudio,
  audioInitPrefersDemoAudio,
  recommendedCapability,
}: {
  forcePreferDemoAudio: boolean;
  audioInitPrefersDemoAudio?: boolean;
  recommendedCapability?: ToyWithControls['recommendedCapability'];
}) {
  return (
    forcePreferDemoAudio ||
    audioInitPrefersDemoAudio === true ||
    recommendedCapability === 'demoAudio'
  );
}

export function bootToyPage({
  router,
  loadFromQuery,
  initNavigation,
  audioControlsContainer,
  settingsContainer,
  persistentBackLink,
}: {
  router: {
    getLibraryHref: () => string;
  };
  loadFromQuery: LoaderApi['loadFromQuery'];
  initNavigation: LoaderApi['initNavigation'];
  audioControlsContainer: HTMLElement | null;
  settingsContainer: HTMLElement | null;
  persistentBackLink: HTMLAnchorElement | null;
}) {
  let loaderStarted = false;
  const hidePersistentBackLink = () => {
    const escapeShell =
      persistentBackLink?.closest<HTMLElement>('.toy-shell-escape');
    if (escapeShell) {
      escapeShell.hidden = true;
    }
  };

  const startLoaderIfNeeded = () => {
    if (loaderStarted) return;
    loaderStarted = true;
    hidePersistentBackLink();
    initNavigation();
    void loadFromQuery();
  };

  const toyWindow = window as unknown as ToyWindow;
  const toySlug = new URLSearchParams(window.location.search).get('toy');
  const toyTitle = resolveToyTitle(toySlug, toyManifest as Toy[]);
  document.title = toySlug ? `${toyTitle} · Stim Webtoy` : document.title;

  if (persistentBackLink) {
    bindLibraryBackLink(persistentBackLink, {
      backHref: router.getLibraryHref(),
    });
  }

  const setupAudio = (
    result: CapabilityPreflightResult | null,
    { forcePreferDemoAudio = false }: { forcePreferDemoAudio?: boolean } = {},
  ) => {
    if (!audioControlsContainer) return;

    const toyMeta = (() => {
      if (!toySlug) return null;
      return (toyManifest as ToyWithControls[]).find(
        (entry) => entry.slug === toySlug,
      );
    })();

    const starterTips = [
      ...(toyMeta?.controls ?? []),
      ...(toyMeta?.wowControl
        ? [`Best wow control: ${toyMeta.wowControl}`]
        : []),
    ];
    const firstRunHint = toyMeta?.firstRunHint ?? starterTips[0];
    const touchHints = (toyMeta?.touchHints ?? starterTips).filter((tip) =>
      /touch|drag|pinch|swipe|gesture|tap|rotate/i.test(tip),
    );
    const desktopHints = (
      toyMeta?.desktopHints ?? [
        'Move to steer the scene.',
        'Drag to inject force.',
        'Scroll or trackpad pinch for depth and intensity.',
        'Press Space for an accent burst.',
        'Press R to remix the preset browser.',
        'Press Q/E or 1/2/3 for fast mode changes.',
      ]
    ).slice(0, 6);
    const starterPresetId = toyMeta?.starterPreset?.id;
    const starterPresetLabel = toyMeta?.starterPreset?.label;
    const audioInitState = buildAudioInitState(result);

    initAudioControls(audioControlsContainer, {
      onRequestMicrophone: async () => {
        startLoaderIfNeeded();
        await startToyAudioFromSource(toyWindow, { source: 'microphone' });
        setAudioActive(true, 'microphone');
      },
      onRequestDemoAudio: async () => {
        startLoaderIfNeeded();
        await startToyAudioFromSource(toyWindow, { source: 'demo' });
        setAudioActive(true, 'demo');
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
      desktopHints,
      touchHints,
      starterPresetId,
      starterPresetLabel,
      wowControl: toyMeta?.wowControl,
      recommendedCapability: toyMeta?.recommendedCapability,
      onApplyStarterPreset: starterPresetId
        ? () => {
            requestMilkdropPresetSelection(starterPresetId);
            startLoaderIfNeeded();
          }
        : undefined,
      ...audioInitState,
      preferDemoAudio:
        shouldPreferDemoAudio({
          forcePreferDemoAudio,
          audioInitPrefersDemoAudio: audioInitState.preferDemoAudio,
          recommendedCapability: toyMeta?.recommendedCapability,
        }) || undefined,
    });
  };

  const setupSystemControls = () => {
    if (!settingsContainer || settingsContainer.childElementCount > 0) return;
    initSystemControls(settingsContainer);
  };

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
    heading: 'Step 1 of 2 · System check',
    backHref: router.getLibraryHref(),
    openOnAttach: !shouldSkipPreflightForSession,
    onComplete: handlePreflightReady,
    onRetry: handlePreflightReady,
    host: document.body,
    showCloseButton: true,
  });

  if (shouldSkipPreflightForSession) {
    void preflight.run().then(handlePreflightReady);
  }

  window.addEventListener('pagehide', () => {
    // Cleanup if needed
  });
}
