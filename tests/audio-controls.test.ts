import { beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  buildTryThisFirstRecommendation,
  initAudioControls,
} from '../assets/js/ui/audio-controls.ts';
import { YouTubeController } from '../assets/js/ui/youtube-controller.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('audio controls primary emphasis', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    localStorage.clear();
    const bootstrapScript = document.createElement('script');
    document.body.appendChild(bootstrapScript);
    globalThis.HTMLButtonElement =
      window.HTMLButtonElement as unknown as typeof HTMLButtonElement;
    window.matchMedia = ((query: string) =>
      ({
        media: query,
        matches: query === '(pointer: coarse)',
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;
  });

  test('highlights demo row when preferDemoAudio is true', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      preferDemoAudio: true,
    });

    const micRow = container.querySelector('[data-audio-row="mic"]');
    const demoRow = container.querySelector('[data-audio-row="demo"]');

    expect(micRow?.classList.contains('control-panel__row--primary')).toBe(
      false,
    );
    expect(demoRow?.classList.contains('control-panel__row--primary')).toBe(
      true,
    );
    expect(
      (
        container.querySelector(
          '[data-recommended-for="demo"]',
        ) as HTMLElement | null
      )?.hidden,
    ).toBe(false);
    expect(
      (
        container.querySelector(
          '[data-recommended-for="mic"]',
        ) as HTMLElement | null
      )?.hidden,
    ).toBe(true);
    expect(container.classList.contains('control-panel--audio')).toBe(true);
  });

  test('keeps microphone row primary by default', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    const micRow = container.querySelector('[data-audio-row="mic"]');
    const demoRow = container.querySelector('[data-audio-row="demo"]');

    expect(micRow?.classList.contains('control-panel__row--primary')).toBe(
      true,
    );
    expect(demoRow?.classList.contains('control-panel__row--primary')).toBe(
      false,
    );
  });

  test('shows comparison guidance and recommended source badge', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    expect(container.textContent).toContain(
      'Use demo for the fastest first run. Switch to mic once you want live response.',
    );

    const micBadge = container.querySelector('[data-recommended-for="mic"]');
    const demoBadge = container.querySelector('[data-recommended-for="demo"]');

    expect((micBadge as HTMLElement | null)?.hidden).toBe(false);
    expect((demoBadge as HTMLElement | null)?.hidden).toBe(true);
  });

  test('keeps advanced sources collapsed and post-start guidance hidden by default', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      onRequestTabAudio: async () => {},
    });

    const postStartGuidance = container.querySelector(
      '[data-post-start-guidance]',
    ) as HTMLElement;
    const advancedInputs = container.querySelector(
      '[data-advanced-inputs]',
    ) as HTMLDetailsElement;

    expect(postStartGuidance.hidden).toBe(true);
    expect(advancedInputs.open).toBe(false);
    expect(postStartGuidance.textContent).toContain('Next');
    expect(advancedInputs.textContent).toContain('Other audio sources');
  });

  test('persists advanced inputs disclosure state', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      onRequestTabAudio: async () => {},
    });

    const advancedInputs = container.querySelector(
      '[data-advanced-inputs]',
    ) as HTMLDetailsElement;

    advancedInputs.open = true;
    advancedInputs.dispatchEvent(new window.Event('toggle'));

    expect(sessionStorage.getItem('stims-audio-advanced-open')).toBe('true');
  });

  test('keeps the start surface focused by omitting duplicate browser shortcut cards', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      onRequestTabAudio: async () => {},
      onRequestYouTubeAudio: async () => {},
    });

    expect(
      container.querySelector('[data-browser-audio-shortcuts]'),
    ).toBeNull();
  });

  test('restores advanced disclosure state from session storage', () => {
    const container = document.createElement('section');
    sessionStorage.setItem('stims-audio-advanced-open', 'true');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      onRequestTabAudio: async () => {},
    });

    const advancedInputs = container.querySelector(
      '[data-advanced-inputs]',
    ) as HTMLDetailsElement;
    expect(advancedInputs.open).toBe(true);
  });

  test('reveals touch gesture hints after audio starts on touch-capable devices', async () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      gestureHints: ['Pinch/rotate gestures', 'Drag to steer'],
    });

    const hintPanel = container.querySelector(
      '[data-gesture-hints]',
    ) as HTMLElement;
    expect(hintPanel.hidden).toBe(true);

    const demoButton = container.querySelector(
      '#use-demo-audio',
    ) as HTMLButtonElement;
    demoButton.click();
    await flush();

    expect(hintPanel.hidden).toBe(false);
    expect(hintPanel.textContent).toContain('Touch gestures');
    expect(hintPanel.textContent).toContain('Pinch/rotate gestures');
  });

  test('shows desktop control legend by default on laptop-like devices', () => {
    window.matchMedia = ((query: string) =>
      ({
        media: query,
        matches: false,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;

    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      desktopHints: ['Move to steer', 'Press Q/E for mode changes'],
      touchHints: ['Pinch to change scale'],
    });

    const desktopHints = container.querySelector(
      '[data-desktop-hints]',
    ) as HTMLElement | null;
    const touchHints = container.querySelector(
      '[data-gesture-hints]',
    ) as HTMLElement | null;

    expect(desktopHints?.textContent).toContain('Desktop controls');
    expect(desktopHints?.textContent).toContain('Move to steer');
    expect(touchHints?.hidden).toBe(true);
  });
  test('does not auto-hide the try-this-first spotlight before user dismisses it', () => {
    const container = document.createElement('section');
    const originalSetTimeout = window.setTimeout;
    let timeoutCalls = 0;
    window.setTimeout = ((...args: Parameters<typeof window.setTimeout>) => {
      timeoutCalls += 1;
      return originalSetTimeout(...args);
    }) as typeof window.setTimeout;

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    const firstSteps = container.querySelector(
      '[data-quickstart-spotlight]',
    ) as HTMLElement;
    expect(firstSteps.hidden).toBe(false);
    expect(timeoutCalls).toBe(0);

    window.setTimeout = originalSetTimeout;
  });

  test('renders the start-here spotlight with concise first-run guidance', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      firstRunHint: 'Try turning the main knob slowly for smoother motion.',
    });

    const firstSteps = container.querySelector(
      '[data-quickstart-spotlight]',
    ) as HTMLElement;
    expect(firstSteps.hidden).toBe(false);
    expect(firstSteps.textContent).toContain('Start here');
    expect(firstSteps.textContent).toContain(
      'Try turning the main knob slowly for smoother motion.',
    );
  });

  test('auto-starts microphone when permission is already granted', async () => {
    const container = document.createElement('section');
    const onRequestMicrophone = mock(async () => {});

    const permissions = navigator.permissions;
    const mediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: mock(async () => ({}) as MediaStream),
      },
    });
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: {
        query: mock(async () => ({ state: 'granted' })),
      },
    });

    initAudioControls(container, {
      onRequestMicrophone,
      onRequestDemoAudio: async () => {},
    });

    await flush();

    expect(onRequestMicrophone).toHaveBeenCalledTimes(1);
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: permissions,
    });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: mediaDevices,
    });
  });
  test('builds one concise try-this-first recommendation from toy metadata', () => {
    expect(
      buildTryThisFirstRecommendation({
        recommendedCapability: 'demoAudio',
        starterPresetLabel: 'Aurora starter',
        wowControl: 'Q/E mood cycling',
      }),
    ).toEqual({
      summary: 'Start with demo audio for the fastest first run.',
      detail:
        'Try Aurora starter once the toy opens. Then explore Q/E mood cycling.',
    });
  });

  test('keeps a single visible start-here prompt instead of stacked quick-start tips', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      starterTips: ['Tip one', 'Tip two'],
    });

    const quickstart = container.querySelector(
      '[data-quickstart-spotlight]',
    ) as HTMLElement;
    expect(quickstart.hidden).toBe(false);
    expect(container.querySelector('[data-quickstart-panel]')).toBeNull();
    expect(quickstart.textContent).toContain('Start here');
  });

  test('applies low-motion starter preset from first-steps quick action', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    const starterPresetButton = container.querySelector(
      '[data-apply-starter-preset]',
    ) as HTMLButtonElement;
    starterPresetButton.click();

    expect(localStorage.getItem('stims:quality-preset')).toBe('low-motion');

    const status = container.querySelector('#audio-status') as HTMLElement;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain('calm starter preset applied');
  });

  test('applies custom starter preset id when provided', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      starterPresetId: 'performance',
      starterPresetLabel: 'best-of starter',
    });

    const starterPresetButton = container.querySelector(
      '[data-apply-starter-preset]',
    ) as HTMLButtonElement;
    starterPresetButton.click();

    expect(localStorage.getItem('stims:quality-preset')).toBe('performance');

    const status = container.querySelector('#audio-status') as HTMLElement;
    expect(status.textContent).toContain('best-of starter applied');
  });

  test('uses custom starter preset label and callback when provided', () => {
    const container = document.createElement('section');
    let applied = false;

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      starterPresetLabel: 'best-of starter',
      onApplyStarterPreset: () => {
        applied = true;
      },
    });

    const starterPresetButton = container.querySelector(
      '[data-apply-starter-preset]',
    ) as HTMLButtonElement;
    expect(starterPresetButton.textContent).toContain('best-of starter');

    starterPresetButton.click();
    expect(applied).toBe(true);

    const status = container.querySelector('#audio-status') as HTMLElement;
    expect(status.textContent).toContain('best-of starter applied');
  });

  test('hides gesture hints when dismissed by user', async () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      gestureHints: ['Pinch/rotate gestures', 'Drag to steer'],
    });

    const demoButton = container.querySelector(
      '#use-demo-audio',
    ) as HTMLButtonElement;
    demoButton.click();
    await flush();

    const hintPanel = container.querySelector(
      '[data-gesture-hints]',
    ) as HTMLElement;
    expect(hintPanel.hidden).toBe(false);

    const dismiss = hintPanel.querySelector(
      '[data-dismiss-gesture-hints]',
    ) as HTMLButtonElement;
    dismiss.click();

    expect(hintPanel.hidden).toBe(true);
    expect(sessionStorage.getItem('stims-gesture-hints-dismissed')).toBe(
      'true',
    );
  });

  test('falls back to demo recommendation when microphone is unsupported', async () => {
    const container = document.createElement('section');
    const originalNavigator = globalThis.navigator;

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        ...originalNavigator,
        mediaDevices: undefined,
        permissions: undefined,
      },
    });

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    await flush();

    const micRow = container.querySelector('[data-audio-row="mic"]');
    const demoRow = container.querySelector('[data-audio-row="demo"]');
    const status = container.querySelector('#audio-status') as HTMLElement;
    const micButton = container.querySelector(
      '#start-audio-btn',
    ) as HTMLButtonElement;

    expect(micRow?.classList.contains('control-panel__row--primary')).toBe(
      false,
    );
    expect(demoRow?.classList.contains('control-panel__row--primary')).toBe(
      true,
    );
    expect(micButton.disabled).toBe(true);
    expect(status.textContent).toContain(
      'Microphone is unavailable in this browser',
    );

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
  });

  test('updates onboarding source copy when demo is preferred', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      preferDemoAudio: true,
    });

    const sourceStep = container.querySelector('[data-first-step-source]');
    expect(sourceStep?.textContent).toContain(
      'Demo is best for the fastest first run.',
    );
  });

  test('disables YouTube load until a valid link is entered', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      onRequestYouTubeAudio: async () => {},
    });

    const input = container.querySelector('#youtube-url') as HTMLInputElement;
    const loadButton = container.querySelector(
      '#load-youtube',
    ) as HTMLButtonElement;

    expect(loadButton.disabled).toBe(true);

    input.value = 'not-a-valid-url';
    input.dispatchEvent(new Event('input'));
    expect(loadButton.disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');

    input.value = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
    input.dispatchEvent(new Event('input'));
    expect(loadButton.disabled).toBe(false);
    expect(input.getAttribute('aria-invalid')).toBe('false');
  });

  test('restores stored YouTube URL with ready-to-load state', () => {
    sessionStorage.setItem(
      'stims-youtube-url',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
    );
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      onRequestYouTubeAudio: async () => {},
    });

    const loadButton = container.querySelector(
      '#load-youtube',
    ) as HTMLButtonElement;
    const feedback = container.querySelector(
      '[data-youtube-url-feedback]',
    ) as HTMLElement;

    expect(loadButton.disabled).toBe(false);
    expect(feedback.textContent).toContain('Link looks good');
  });

  test('pressing Enter in YouTube URL field triggers load action', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      onRequestYouTubeAudio: async () => {},
    });

    const input = container.querySelector('#youtube-url') as HTMLInputElement;
    const loadButton = container.querySelector(
      '#load-youtube',
    ) as HTMLButtonElement;
    let clickCount = 0;
    loadButton.addEventListener('click', () => {
      clickCount += 1;
    });

    input.value = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));

    expect(clickCount).toBe(1);
  });

  test('clicking a recent YouTube chip updates stored URL and validity state', () => {
    const originalGetRecentVideos = YouTubeController.prototype.getRecentVideos;
    const originalLoadVideo = YouTubeController.prototype.loadVideo;

    YouTubeController.prototype.getRecentVideos = () => [
      {
        id: 'dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        timestamp: Date.now(),
      },
    ];
    YouTubeController.prototype.loadVideo = async () => {};

    const container = document.createElement('section');
    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      onRequestYouTubeAudio: async () => {},
    });

    const recentChip = container.querySelector(
      '.control-panel__chip',
    ) as HTMLButtonElement;
    const loadButton = container.querySelector(
      '#load-youtube',
    ) as HTMLButtonElement;
    const input = container.querySelector('#youtube-url') as HTMLInputElement;

    recentChip.click();

    expect(input.value).toContain('dQw4w9WgXcQ');
    expect(loadButton.disabled).toBe(false);
    expect(sessionStorage.getItem('stims-youtube-url')).toContain(
      'dQw4w9WgXcQ',
    );

    YouTubeController.prototype.getRecentVideos = originalGetRecentVideos;
    YouTubeController.prototype.loadVideo = originalLoadVideo;
  });

  test('keeps YouTube capture disabled before a video is ready', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      onRequestYouTubeAudio: async () => {},
    });

    const captureButton = container.querySelector(
      '#use-youtube-audio',
    ) as HTMLButtonElement;

    expect(captureButton.disabled).toBe(true);
    expect(captureButton.getAttribute('aria-disabled')).toBe('true');
  });

  test('switches emphasis to demo row after successful demo start', async () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    const demoButton = container.querySelector(
      '#use-demo-audio',
    ) as HTMLButtonElement;
    demoButton.click();
    await flush();

    const micRow = container.querySelector('[data-audio-row="mic"]');
    const demoRow = container.querySelector('[data-audio-row="demo"]');
    const firstSteps = container.querySelector(
      '[data-quickstart-spotlight]',
    ) as HTMLElement;

    expect(micRow?.classList.contains('control-panel__row--primary')).toBe(
      false,
    );
    expect(demoRow?.classList.contains('control-panel__row--primary')).toBe(
      true,
    );
    expect(firstSteps.hidden).toBe(true);
  });

  test('switches emphasis back to microphone after successful mic start', async () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      preferDemoAudio: true,
    });

    const micButton = container.querySelector(
      '#start-audio-btn',
    ) as HTMLButtonElement;
    micButton.click();
    await flush();

    const micRow = container.querySelector('[data-audio-row="mic"]');
    const demoRow = container.querySelector('[data-audio-row="demo"]');

    expect(micRow?.classList.contains('control-panel__row--primary')).toBe(
      true,
    );
    expect(demoRow?.classList.contains('control-panel__row--primary')).toBe(
      false,
    );
  });

  test('shows inline YouTube URL feedback copy as validity changes', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      onRequestYouTubeAudio: async () => {},
    });

    const input = container.querySelector('#youtube-url') as HTMLInputElement;
    const feedback = container.querySelector(
      '[data-youtube-url-feedback]',
    ) as HTMLElement;

    expect(input.getAttribute('aria-describedby')).toBe('youtube-url-feedback');
    expect(feedback.textContent).toContain('Paste a full YouTube link');

    input.value = 'bad';
    input.dispatchEvent(new Event('input'));
    expect(feedback.textContent).toContain('not recognized');

    input.value = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
    input.dispatchEvent(new Event('input'));
    expect(feedback.textContent).toContain('Link looks good');
  });

  test('switches emphasis to demo row after microphone failure', async () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {
        throw new Error('Mic denied');
      },
      onRequestDemoAudio: async () => {},
    });

    const micButton = container.querySelector(
      '#start-audio-btn',
    ) as HTMLButtonElement;
    micButton.click();
    await flush();

    const micRow = container.querySelector('[data-audio-row="mic"]');
    const demoRow = container.querySelector('[data-audio-row="demo"]');

    expect(micRow?.classList.contains('control-panel__row--primary')).toBe(
      false,
    );
    expect(demoRow?.classList.contains('control-panel__row--primary')).toBe(
      true,
    );
    expect(
      (
        container.querySelector(
          '[data-recommended-for="demo"]',
        ) as HTMLElement | null
      )?.hidden,
    ).toBe(false);
    expect(
      (
        container.querySelector(
          '[data-recommended-for="mic"]',
        ) as HTMLElement | null
      )?.hidden,
    ).toBe(true);
  });
});
