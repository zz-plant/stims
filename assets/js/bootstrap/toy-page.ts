import { setAudioActive } from '../core/agent-api.ts';
import {
  attachCapabilityPreflight,
  type CapabilityPreflightResult,
} from '../core/capability-preflight.ts';
import { startToyAudioFromSource } from '../core/toy-audio-startup.ts';
import type { ToyWindow } from '../core/toy-globals.ts';
import toyManifest from '../data/toy-manifest.ts';
import type { ToyEntry } from '../data/toy-schema.ts';
import type { createLoader } from '../loader.ts';
import {
  type MilkdropOverlayTab,
  requestMilkdropOverlayTab,
} from '../milkdrop/overlay-intent.ts';
import { requestMilkdropPresetSelection } from '../milkdrop/preset-selection.ts';
import { initAudioControls } from '../ui/audio-controls.ts';
import { initSystemControls } from '../ui/system-controls.ts';
import { isSmartTvDevice } from '../utils/device-detect.ts';

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
  if (!slug) return 'MilkDrop Visualizer';
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

export function isPresetFirstToySession(toySlug: string | null) {
  return (toySlug ?? 'milkdrop') === 'milkdrop';
}

export function bootToyPage({
  router,
  loadFromQuery,
  initNavigation,
  audioControlsContainer,
  settingsContainer,
}: {
  router: {
    getCurrentRoute: () => {
      view: 'library' | 'toy';
      slug: string | null;
    };
    getLibraryHref: () => string;
  };
  loadFromQuery: LoaderApi['loadFromQuery'];
  initNavigation: LoaderApi['initNavigation'];
  audioControlsContainer: HTMLElement | null;
  settingsContainer: HTMLElement | null;
}) {
  let loaderStarted = false;
  const searchParams = new URLSearchParams(window.location.search);
  const currentRoute = router.getCurrentRoute();

  const startLoaderIfNeeded = () => {
    if (loaderStarted) return;
    loaderStarted = true;
    initNavigation();
    void loadFromQuery();
  };

  const toyWindow = window as unknown as ToyWindow;
  const toySlug =
    searchParams.get('toy') ??
    (currentRoute.view === 'toy' ? currentRoute.slug : null) ??
    'milkdrop';
  const requestedAudioSource = searchParams.get('audio')?.trim().toLowerCase();
  const requestedOverlayTab = (() => {
    const value = searchParams.get('panel')?.trim().toLowerCase();
    if (value === 'browse' || value === 'editor' || value === 'inspector') {
      return value as MilkdropOverlayTab;
    }
    return null;
  })();
  const shouldCollapseShellPanelsAfterAudio = isPresetFirstToySession(toySlug);
  const toyTitle = resolveToyTitle(toySlug, toyManifest as Toy[]);
  document.title = `${toyTitle} · Stims`;

  if (requestedOverlayTab && toySlug === 'milkdrop') {
    requestMilkdropOverlayTab(requestedOverlayTab);
  }

  const collapseFocusedSessionPanels = () => {
    if (!shouldCollapseShellPanelsAfterAudio) {
      return;
    }
    if (audioControlsContainer) {
      audioControlsContainer.hidden = true;
    }
    if (settingsContainer) {
      settingsContainer.hidden = true;
    }
  };

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
      onSuccess: collapseFocusedSessionPanels,
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
      initialShortcut:
        requestedAudioSource === 'tab' || requestedAudioSource === 'youtube'
          ? requestedAudioSource
          : undefined,
      onApplyStarterPreset: starterPresetId
        ? () => {
            requestMilkdropPresetSelection(starterPresetId);
            startLoaderIfNeeded();
          }
        : undefined,
      ...audioInitState,
      preferDemoAudio:
        requestedAudioSource === 'demo' ||
        shouldPreferDemoAudio({
          forcePreferDemoAudio,
          audioInitPrefersDemoAudio: audioInitState.preferDemoAudio,
          recommendedCapability: toyMeta?.recommendedCapability,
        }) ||
        undefined,
    });
  };

  const setupSystemControls = (result: CapabilityPreflightResult | null) => {
    if (!settingsContainer || settingsContainer.childElementCount > 0) return;
    initSystemControls(settingsContainer, {
      title: 'Tune',
      description: 'Keep the visualizer comfortable and responsive.',
      defaultPresetId:
        result?.performance.recommendedQualityPresetId ?? undefined,
      variant: 'inline',
    });
  };

  const handlePreflightReady = (result: CapabilityPreflightResult) => {
    if (!result.canProceed) {
      preflight.open(undefined, { rerun: false });
      return;
    }

    setupAudio(result, {
      forcePreferDemoAudio: isPresetFirstToySession(toySlug),
    });
    setupSystemControls(result);
  };

  const preflight = attachCapabilityPreflight({
    heading: 'Quick check',
    backHref: router.getLibraryHref(),
    openOnAttach: false,
    onComplete: handlePreflightReady,
    onRetry: handlePreflightReady,
    host: document.body,
    showCloseButton: true,
  });

  document
    .querySelectorAll<HTMLElement>('[data-open-preflight]')
    .forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        preflight.open(trigger);
      });
    });

  void preflight.run();

  window.addEventListener('pagehide', () => {
    // Cleanup if needed
  });
}
