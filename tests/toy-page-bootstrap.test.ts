import { afterEach, describe, expect, mock, test } from 'bun:test';
import {
  isPresetFirstToySession,
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
    mock.module('../assets/js/milkdrop/overlay-intent.ts', () => ({
      requestMilkdropOverlayTab: mock(),
    }));
    mock.module('../assets/js/milkdrop/preset-selection.ts', () => ({
      requestMilkdropPresetSelection: mock(),
    }));

    const { bootToyPage } = await freshImport();
    (
      window as Window & { happyDOM?: { setURL?: (url: string) => void } }
    ).happyDOM?.setURL?.('https://example.com/milkdrop/?audio=demo');
    document.body.innerHTML = `
      <button data-open-preflight type="button">Run quick check</button>
      <section data-audio-controls></section>
      <section data-settings-panel></section>
    `;

    bootToyPage({
      router: {
        getCurrentRoute: () => ({ view: 'toy' as const, slug: 'milkdrop' }),
        getLibraryHref: () => '/',
      },
      loadFromQuery: mock(async () => {}),
      initNavigation: mock(),
      audioControlsContainer: document.querySelector('[data-audio-controls]'),
      settingsContainer: document.querySelector('[data-settings-panel]'),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(receivedAudioOptions?.autoStartSource).toBe('demo');
    expect(receivedAudioOptions?.preferDemoAudio).toBe(true);
  });
});
