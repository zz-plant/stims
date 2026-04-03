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
import { requestMilkdropPresetSelection } from '../milkdrop/public/launch-intents.ts';
import {
  resolveTouchGestureHints,
  supportsTouchLikeInput,
} from '../ui/audio-control-policy.ts';
import { initAudioControls } from '../ui/audio-controls.ts';
import { initNavigation as initTopNav } from '../ui/nav.ts';
import { initSystemControls } from '../ui/system-controls.ts';
import { isSmartTvDevice } from '../utils/device-detect.ts';
import { buildExperienceAudioInitState } from './experience-audio-init.ts';
import {
  applyMilkdropLaunchIntents,
  parseRequestedOverlayTab,
  parseRequestedPresetId,
} from './milkdrop-launch-intents.ts';

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
  if (!slug) {
    return 'MilkDrop Visualizer';
  }
  return toys.find((toy) => toy.slug === slug)?.title ?? slug;
};

function resolveTouchHints(toyMeta: ToyWithControls | null) {
  return resolveTouchGestureHints({ touchHints: toyMeta?.touchHints });
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

export function shouldCombineFocusedSessionPanels(toySlug: string | null) {
  return isPresetFirstToySession(toySlug);
}

export function bootExperienceShell({
  router,
  loadFromQuery,
  initNavigation,
  navContainer,
  audioControlsContainer,
  settingsContainer,
}: {
  router: {
    getCurrentRoute: () => {
      view: 'library' | 'experience';
      slug: string | null;
    };
    getLibraryHref: () => string;
  };
  loadFromQuery: LoaderApi['loadFromQuery'];
  initNavigation: LoaderApi['initNavigation'];
  navContainer: HTMLElement | null;
  audioControlsContainer: HTMLElement | null;
  settingsContainer: HTMLElement | null;
}) {
  let loaderStarted = false;
  let focusedSessionMode: 'off' | 'launch' | 'live' = 'off';
  let sessionChromeVisibility: 'visible' | 'hidden' = 'visible';
  const searchParams = new URLSearchParams(window.location.search);
  const currentRoute = router.getCurrentRoute();
  const root = document.documentElement;

  const setFocusedSessionMode = (mode: 'off' | 'launch' | 'live') => {
    if (focusedSessionMode === mode) {
      return;
    }

    focusedSessionMode = mode;
    if (mode === 'off') {
      delete root.dataset.focusedSession;
      return;
    }

    root.dataset.focusedSession = mode;
  };

  const setSessionDisplayMode = (mode: 'setup' | 'immersive' | 'tools') => {
    root.dataset.sessionDisplayMode = mode;
    root.dataset.sessionChrome = sessionChromeVisibility;
  };

  const setSessionChromeVisibility = (visibility: 'visible' | 'hidden') => {
    sessionChromeVisibility = visibility;
    root.dataset.sessionChrome = visibility;
  };

  const startLoaderIfNeeded = () => {
    if (loaderStarted) {
      return;
    }
    loaderStarted = true;
    initNavigation();
    void loadFromQuery();
  };

  const toyWindow = window as unknown as ToyWindow;
  const toySlug =
    searchParams.get('experience') ??
    (currentRoute.view === 'experience' ? currentRoute.slug : null) ??
    'milkdrop';
  const requestedAudioSource = searchParams.get('audio')?.trim().toLowerCase();
  const requestedOverlayTab = parseRequestedOverlayTab(searchParams);
  const requestedCollectionTag = searchParams.get('collection')?.trim() ?? null;
  const requestedPresetId = parseRequestedPresetId(searchParams);
  const shouldCombineLaunchPanels = shouldCombineFocusedSessionPanels(toySlug);
  const shouldAutoBootFocusedSession =
    shouldCombineLaunchPanels &&
    (requestedAudioSource === 'demo' ||
      requestedOverlayTab !== null ||
      requestedCollectionTag !== null ||
      requestedPresetId !== null);
  const toyTitle = resolveToyTitle(toySlug, toyManifest as Toy[]);
  document.title = `${toyTitle} · Stims`;

  if (navContainer) {
    initTopNav(navContainer, {
      mode: 'library',
      sectionLinks: [
        { href: '#main-content', label: 'Overview' },
        { href: '#launch-panels', label: 'Launch' },
      ],
      utilityLink: null,
    });
  }

  applyMilkdropLaunchIntents({
    toySlug,
    requestedOverlayTab,
    requestedCollectionTag,
    requestedPresetId,
  });

  if (shouldCombineLaunchPanels) {
    setSessionDisplayMode('setup');
    setSessionChromeVisibility('visible');
  }

  const collapseFocusedSessionPanels = () => {
    if (!shouldCombineLaunchPanels) {
      return;
    }
    setSessionDisplayMode('immersive');
    setFocusedSessionMode('live');
    setSessionChromeVisibility('hidden');
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
    if (!audioControlsContainer) {
      return;
    }

    const toyMeta = (() => {
      if (!toySlug) {
        return null;
      }
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
    const touchHints = resolveTouchHints(toyMeta ?? null);
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
    const audioInitState = buildExperienceAudioInitState(result);

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
      recommendedCapability:
        supportsTouchLikeInput() && !isSmartTvDevice() && touchHints.length > 0
          ? 'touch'
          : toyMeta?.recommendedCapability,
      initialShortcut:
        requestedAudioSource === 'tab' || requestedAudioSource === 'youtube'
          ? requestedAudioSource
          : undefined,
      autoStartSource: requestedAudioSource === 'demo' ? 'demo' : undefined,
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
    const host = shouldCombineLaunchPanels
      ? audioControlsContainer
      : settingsContainer;

    if (!host) {
      return;
    }

    const existingPanel = host.querySelector('.control-panel--embedded');
    if (shouldCombineLaunchPanels && existingPanel) {
      return;
    }
    if (!shouldCombineLaunchPanels && host.childElementCount > 0) {
      return;
    }

    initSystemControls(host, {
      title: 'Defaults',
      description: 'Choose startup settings for this device.',
      qualityLabel: 'Startup look',
      qualityHint: 'Used before the live view opens.',
      defaultPresetId:
        result?.performance.recommendedQualityPresetId ?? undefined,
      variant: shouldCombineLaunchPanels ? 'embedded' : 'inline',
    });

    if (shouldCombineLaunchPanels && settingsContainer) {
      settingsContainer.hidden = true;
    }
  };

  const handlePreflightReady = (result: CapabilityPreflightResult) => {
    if (!result.canProceed) {
      setFocusedSessionMode('off');
      setSessionDisplayMode('setup');
      setSessionChromeVisibility('visible');
      preflight.open(undefined, { rerun: false });
      return;
    }

    const shouldAutoStartDemo = requestedAudioSource === 'demo';
    if (shouldAutoBootFocusedSession) {
      setSessionDisplayMode(shouldAutoStartDemo ? 'immersive' : 'setup');
      setFocusedSessionMode(shouldAutoStartDemo ? 'live' : 'launch');
      setSessionChromeVisibility(shouldAutoStartDemo ? 'hidden' : 'visible');
      startLoaderIfNeeded();
    }

    setupAudio(result, {
      forcePreferDemoAudio: isPresetFirstToySession(toySlug),
    });
    setupSystemControls(result);

    if (shouldAutoStartDemo) {
      collapseFocusedSessionPanels();
    }
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
    // Cleanup if needed.
  });
}
