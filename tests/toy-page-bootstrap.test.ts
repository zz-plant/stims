import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  applyMilkdropLaunchIntents,
  isPresetFirstToySession,
  parseRequestedPresetId,
  shouldCombineFocusedSessionPanels,
  shouldPreferDemoAudio,
} from '../assets/js/bootstrap/toy-page.ts';

const freshImport = async () =>
  import(
    `../assets/js/bootstrap/toy-page.ts?ts=${Date.now()}-${Math.random()}`
  );

describe('toy page demo-audio preference', () => {
  test('prefers demo audio when the toy metadata recommends it', () => {
    expect(
      shouldPreferDemoAudio({
        forcePreferDemoAudio: false,
        recommendedCapability: 'demoAudio',
      }),
    ).toBe(true);
  });

  test('keeps microphone-first when no inputs request demo audio', () => {
    expect(
      shouldPreferDemoAudio({
        forcePreferDemoAudio: false,
        audioInitPrefersDemoAudio: false,
        recommendedCapability: 'microphone',
      }),
    ).toBe(false);
  });

  test('force flag still wins over toy metadata', () => {
    expect(
      shouldPreferDemoAudio({
        forcePreferDemoAudio: true,
        recommendedCapability: 'microphone',
      }),
    ).toBe(true);
  });

  test('treats milkdrop as a preset-first session', () => {
    expect(isPresetFirstToySession('milkdrop')).toBe(true);
    expect(isPresetFirstToySession(null)).toBe(true);
  });

  test('combines focused session panels for milkdrop only', () => {
    expect(shouldCombineFocusedSessionPanels('milkdrop')).toBe(true);
    expect(shouldCombineFocusedSessionPanels(null)).toBe(true);
    expect(shouldCombineFocusedSessionPanels('seary')).toBe(false);
  });
});

describe('milkdrop launch intent parsing', () => {
  test('returns a trimmed preset id when requested in the query', () => {
    const searchParams = new URLSearchParams('preset=  signal-bloom  ');

    expect(parseRequestedPresetId(searchParams)).toBe('signal-bloom');
  });

  test('ignores blank preset ids', () => {
    const searchParams = new URLSearchParams('preset=   ');

    expect(parseRequestedPresetId(searchParams)).toBeNull();
  });

  test('routes preset launch intents only for milkdrop', () => {
    const requestMilkdropPresetSelection = mock();

    mock.module('../assets/js/milkdrop/public/launch-intents.ts', () => ({
      requestMilkdropPresetSelection,
    }));

    applyMilkdropLaunchIntents({
      toySlug: 'milkdrop',
      requestedOverlayTab: null,
      requestedCollectionTag: null,
      requestedPresetId: 'signal-bloom',
    });
    applyMilkdropLaunchIntents({
      toySlug: 'seary',
      requestedOverlayTab: null,
      requestedCollectionTag: null,
      requestedPresetId: 'ignored-preset',
    });

    expect(requestMilkdropPresetSelection).toHaveBeenCalledTimes(1);
    expect(requestMilkdropPresetSelection).toHaveBeenCalledWith('signal-bloom');
  });
});

describe('toy page query-driven startup', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    mock.restore();
  });

  test('passes demo auto-start through to audio controls for /milkdrop/?audio=demo', async () => {
    let receivedAudioOptions:
      | {
          autoStartSource?: 'demo';
          preferDemoAudio?: boolean;
        }
      | undefined;
    const loadFromQuery = mock(async () => {});
    const initNavigation = mock();

    mock.module('../assets/js/core/capability-preflight.ts', () => ({
      attachCapabilityPreflight: ({
        onComplete,
      }: {
        onComplete: (result: {
          canProceed: boolean;
          performance: { recommendedQualityPresetId: string };
        }) => void;
      }) => ({
        open: mock(),
        run: async () => {
          onComplete({
            canProceed: true,
            performance: { recommendedQualityPresetId: 'balanced' },
          });
        },
      }),
    }));
    mock.module('../assets/js/ui/audio-controls.ts', () => ({
      initAudioControls: (
        _container: HTMLElement,
        options: {
          autoStartSource?: 'demo';
          preferDemoAudio?: boolean;
        },
      ) => {
        receivedAudioOptions = options;
      },
    }));
    mock.module('../assets/js/ui/system-controls.ts', () => ({
      initSystemControls: mock(),
    }));
    const requestMilkdropCollectionSelection = mock();
    const requestMilkdropOverlayTab = mock();
    const requestMilkdropPresetSelection = mock();
    const initTopNav = mock();
    mock.module('../assets/js/milkdrop/public/launch-intents.ts', () => ({
      requestMilkdropCollectionSelection,
      requestMilkdropOverlayTab,
      requestMilkdropPresetSelection,
    }));
    mock.module('../assets/js/ui/nav.ts', () => ({
      initNavigation: initTopNav,
    }));

    const { bootToyPage } = await freshImport();
    (
      window as Window & { happyDOM?: { setURL?: (url: string) => void } }
    ).happyDOM?.setURL?.(
      'https://example.com/milkdrop/?audio=demo&panel=browse&collection=cream-of-the-crop&preset=signal-bloom',
    );
    document.body.innerHTML = `
      <button data-open-preflight type="button">Run quick check</button>
      <div data-top-nav-container></div>
      <section data-audio-controls></section>
      <section data-settings-panel></section>
    `;

    bootToyPage({
      router: {
        getCurrentRoute: () => ({
          view: 'experience' as const,
          slug: 'milkdrop',
        }),
        getLibraryHref: () => '/',
      },
      loadFromQuery,
      initNavigation,
      navContainer: document.querySelector('[data-top-nav-container]'),
      audioControlsContainer: document.querySelector('[data-audio-controls]'),
      settingsContainer: document.querySelector('[data-settings-panel]'),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(initNavigation).toHaveBeenCalledTimes(1);
    expect(loadFromQuery).toHaveBeenCalledTimes(1);
    expect(receivedAudioOptions?.autoStartSource).toBe('demo');
    expect(receivedAudioOptions?.preferDemoAudio).toBe(true);
    expect(document.documentElement.dataset.sessionDisplayMode).toBe(
      'immersive',
    );
    expect(document.documentElement.dataset.sessionChrome).toBe('hidden');
    expect(requestMilkdropOverlayTab).toHaveBeenCalledWith('browse');
    expect(requestMilkdropCollectionSelection).toHaveBeenCalledWith(
      'cream-of-the-crop',
    );
    expect(requestMilkdropPresetSelection).toHaveBeenCalledWith('signal-bloom');
    expect(initTopNav).toHaveBeenCalledWith(
      document.querySelector('[data-top-nav-container]'),
      expect.objectContaining({
        mode: 'library',
        utilityLink: {
          href: '/',
          label: 'Back home',
        },
      }),
    );
  });

  test('embeds tune controls into the start panel for the focused milkdrop session', async () => {
    const initSystemControls = mock();

    mock.module('../assets/js/core/capability-preflight.ts', () => ({
      attachCapabilityPreflight: ({
        onComplete,
      }: {
        onComplete: (result: {
          canProceed: boolean;
          performance: { recommendedQualityPresetId: string };
        }) => void;
      }) => ({
        open: mock(),
        run: async () => {
          onComplete({
            canProceed: true,
            performance: { recommendedQualityPresetId: 'balanced' },
          });
        },
      }),
    }));
    mock.module('../assets/js/ui/audio-controls.ts', () => ({
      initAudioControls: mock(),
    }));
    mock.module('../assets/js/ui/system-controls.ts', () => ({
      initSystemControls,
    }));
    mock.module('../assets/js/milkdrop/public/launch-intents.ts', () => ({
      requestMilkdropCollectionSelection: mock(),
      requestMilkdropOverlayTab: mock(),
      requestMilkdropPresetSelection: mock(),
    }));

    const { bootToyPage } = await freshImport();
    (
      window as Window & { happyDOM?: { setURL?: (url: string) => void } }
    ).happyDOM?.setURL?.('https://example.com/milkdrop/');
    document.body.innerHTML = `
      <button data-open-preflight type="button">Run quick check</button>
      <section data-audio-controls></section>
      <section data-settings-panel></section>
    `;

    bootToyPage({
      router: {
        getCurrentRoute: () => ({
          view: 'experience' as const,
          slug: 'milkdrop',
        }),
        getLibraryHref: () => '/',
      },
      loadFromQuery: mock(async () => {}),
      initNavigation: mock(),
      navContainer: null,
      audioControlsContainer: document.querySelector('[data-audio-controls]'),
      settingsContainer: document.querySelector('[data-settings-panel]'),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(initSystemControls).toHaveBeenCalledTimes(1);
    expect(initSystemControls.mock.calls[0]?.[0]).toBe(
      document.querySelector('[data-audio-controls]'),
    );
    expect(initSystemControls.mock.calls[0]?.[1]).toMatchObject({
      variant: 'embedded',
    });
    expect(document.documentElement.dataset.sessionDisplayMode).toBe('setup');
    expect(document.documentElement.dataset.sessionChrome).toBe('visible');
  });
});
