import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { YouTubeController } from '../assets/js/ui/youtube-controller.ts';
import { flushTasks, importFresh } from './test-helpers.ts';

const flush = () => flushTasks();

let initAudioControls: typeof import('../assets/js/ui/audio-controls.ts').initAudioControls;
let buildTryThisFirstRecommendation: typeof import('../assets/js/ui/audio-controls.ts').buildTryThisFirstRecommendation;
let resolveTouchGestureHints: typeof import('../assets/js/ui/audio-controls.ts').resolveTouchGestureHints;

const baselineNavigator = globalThis.navigator;
const baselineNavigatorPermissions = baselineNavigator.permissions;
const baselineNavigatorMediaDevices = baselineNavigator.mediaDevices;
const baselineMatchMedia = window.matchMedia;

function restoreNavigatorBaseline() {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: baselineNavigator,
  });
  Object.defineProperty(globalThis.navigator, 'permissions', {
    configurable: true,
    value: {
      ...baselineNavigatorPermissions,
      query: mock(async () => ({ state: 'prompt' })),
    },
  });
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      ...baselineNavigatorMediaDevices,
      getUserMedia: mock(async () => ({}) as MediaStream),
    },
  });
}

describe('audio controls primary emphasis', () => {
  afterEach(() => {
    restoreNavigatorBaseline();
    window.matchMedia = baselineMatchMedia;
    document.body.innerHTML = '';
  });

  beforeEach(async () => {
    restoreNavigatorBaseline();
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
    const audioControlsModule = await importFresh<
      typeof import('../assets/js/ui/audio-controls.ts')
    >('../assets/js/ui/audio-controls.ts');
    initAudioControls = audioControlsModule.initAudioControls;
    buildTryThisFirstRecommendation =
      audioControlsModule.buildTryThisFirstRecommendation;
    resolveTouchGestureHints = audioControlsModule.resolveTouchGestureHints;
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
    expect(container.querySelector('[data-first-step-source]')).toBeNull();
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

  test('shows concise source guidance and recommended source badge', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    expect(container.textContent).toContain(
      'Demo gets you in fastest. Use mic when you want the room to drive the picture.',
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
    expect(postStartGuidance.textContent).toContain('After start');
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
    expect(hintPanel.textContent).toContain('Touch moves');
    expect(hintPanel.textContent).toContain('Pinch/rotate gestures');
  });

  test('falls back to shared touch gestures instead of filtering starter tips', async () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      starterTips: ['Press Q/E for mode changes', 'Import preset files'],
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
    expect(hintPanel.textContent).toContain('Drag to bend the scene.');
    expect(hintPanel.textContent).toContain(
      'Pinch to swell or compress the depth.',
    );
    expect(hintPanel.textContent).not.toContain('Press Q/E');
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

    expect(desktopHints?.textContent).toContain('Try this next');
    expect(desktopHints?.textContent).toContain('Move to steer');
    expect(touchHints?.hidden).toBe(true);
  });
  test('does not render a duplicate pre-start spotlight card', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
    });

    expect(container.querySelector('[data-quickstart-spotlight]')).toBeNull();
    expect(container.querySelector('[data-first-step-source]')).toBeNull();
  });

  test('keeps first-run guidance inside the post-start panel', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      firstRunHint: 'Try turning the main knob slowly for smoother motion.',
    });

    const postStartGuidance = container.querySelector(
      '[data-post-start-guidance]',
    ) as HTMLElement | null;
    expect(postStartGuidance?.hidden).toBe(true);
    expect(postStartGuidance?.textContent).toContain(
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

  test('auto-starts demo audio when requested by the route', async () => {
    const container = document.createElement('section');
    const onRequestDemoAudio = mock(async () => {});

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio,
      autoStartSource: 'demo',
      preferDemoAudio: true,
    });

    await flush();

    expect(onRequestDemoAudio).toHaveBeenCalledTimes(1);
    expect(
      (
        container.querySelector('[data-audio-row="demo"]') as HTMLElement | null
      )?.classList.contains('control-panel__row--primary'),
    ).toBe(true);
    expect(
      (container.querySelector('#audio-status') as HTMLElement | null)
        ?.textContent,
    ).toContain('Demo audio started.');
    expect(
      (
        container.querySelector(
          '[data-post-start-guidance]',
        ) as HTMLElement | null
      )?.hidden,
    ).toBe(false);
  });

  test('builds one concise try-this-first recommendation from toy metadata', () => {
    expect(
      buildTryThisFirstRecommendation({
        recommendedCapability: 'demoAudio',
        starterPresetLabel: 'Aurora starter',
        wowControl: 'Q/E mood cycling',
      }),
    ).toEqual({
      summary: 'Start with demo audio for the fastest first look.',
      detail:
        'Try Aurora starter once the visualizer opens. Then explore Q/E mood cycling.',
    });
  });

  test('builds touch-first recommendation when mobile guidance is preferred', () => {
    expect(
      buildTryThisFirstRecommendation({
        recommendedCapability: 'touch',
        firstRunHint: 'Open the preset browser after the first gesture burst.',
      }),
    ).toEqual({
      summary:
        'Start audio, then use touch gestures to bend, scale, and twist the scene.',
      detail: 'Open the preset browser after the first gesture burst.',
    });
  });

  test('keeps explicit touch hints ahead of shared fallback hints', () => {
    expect(
      resolveTouchGestureHints({
        touchHints: [
          'Drag to bend the scene hard.',
          'Rotate to twist the image.',
        ],
        gestureHints: ['Pinch to change scale'],
      }),
    ).toEqual(['Drag to bend the scene hard.', 'Rotate to twist the image.']);
  });

  test('keeps the start surface focused instead of stacking quick-start prompts', () => {
    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      starterTips: ['Tip one', 'Tip two'],
    });

    expect(container.querySelector('[data-quickstart-spotlight]')).toBeNull();
    expect(container.querySelector('[data-quickstart-panel]')).toBeNull();
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

  test('clicking a recent YouTube chip updates stored URL and validity state', async () => {
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

    expect(recentChip.textContent).toContain('Never Gonna Give You Up');
    expect(recentChip.textContent).toContain('dQw4w9WgXcQ');
    expect(recentChip.getAttribute('aria-label')).toContain(
      'Never Gonna Give You Up',
    );

    recentChip.click();
    await flush();

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

  test('updates source emphasis for unsupported mic and successful audio starts', async () => {
    const originalNavigator = globalThis.navigator;
    const scenarios = [
      {
        label: 'unsupported microphone',
        setupEnvironment() {
          Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            value: {
              ...originalNavigator,
              mediaDevices: undefined,
              permissions: undefined,
            },
          });
        },
        options: {
          onRequestMicrophone: async () => {},
          onRequestDemoAudio: async () => {},
        },
        trigger: async () => {
          await flush();
        },
        assert(container: HTMLElement) {
          expect(
            (
              container.querySelector(
                '[data-audio-row="mic"]',
              ) as HTMLElement | null
            )?.classList.contains('control-panel__row--primary'),
          ).toBe(false);
          expect(
            (
              container.querySelector(
                '[data-audio-row="demo"]',
              ) as HTMLElement | null
            )?.classList.contains('control-panel__row--primary'),
          ).toBe(true);
          expect(
            (container.querySelector('#start-audio-btn') as HTMLButtonElement)
              .disabled,
          ).toBe(true);
          expect(
            (container.querySelector('#audio-status') as HTMLElement)
              .textContent,
          ).toContain('Microphone is unavailable in this browser');
        },
      },
      {
        label: 'successful demo start',
        setupEnvironment() {},
        options: {
          onRequestMicrophone: async () => {},
          onRequestDemoAudio: async () => {},
        },
        trigger: async (container: HTMLElement) => {
          (
            container.querySelector('#use-demo-audio') as HTMLButtonElement
          ).click();
          await flush();
        },
        assert(container: HTMLElement) {
          expect(
            (
              container.querySelector(
                '[data-audio-row="mic"]',
              ) as HTMLElement | null
            )?.classList.contains('control-panel__row--primary'),
          ).toBe(false);
          expect(
            (
              container.querySelector(
                '[data-audio-row="demo"]',
              ) as HTMLElement | null
            )?.classList.contains('control-panel__row--primary'),
          ).toBe(true);
          expect(
            (
              container.querySelector(
                '[data-post-start-guidance]',
              ) as HTMLElement | null
            )?.hidden,
          ).toBe(false);
        },
      },
      {
        label: 'successful microphone start',
        setupEnvironment() {},
        options: {
          onRequestMicrophone: async () => {},
          onRequestDemoAudio: async () => {},
          preferDemoAudio: true,
        },
        trigger: async (container: HTMLElement) => {
          (
            container.querySelector('#start-audio-btn') as HTMLButtonElement
          ).click();
          await flush();
        },
        assert(container: HTMLElement) {
          expect(
            (
              container.querySelector(
                '[data-audio-row="mic"]',
              ) as HTMLElement | null
            )?.classList.contains('control-panel__row--primary'),
          ).toBe(true);
          expect(
            (
              container.querySelector(
                '[data-audio-row="demo"]',
              ) as HTMLElement | null
            )?.classList.contains('control-panel__row--primary'),
          ).toBe(false);
        },
      },
    ] as const;

    for (const scenario of scenarios) {
      restoreNavigatorBaseline();
      scenario.setupEnvironment();
      const container = document.createElement('section');
      initAudioControls(container, scenario.options);
      await scenario.trigger(container);
      scenario.assert(container);
    }

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: originalNavigator,
    });
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
    expect(feedback.textContent).toContain('Paste a YouTube link or video ID');

    input.value = 'bad';
    input.dispatchEvent(new Event('input'));
    expect(feedback.textContent).toContain('not recognized');

    input.value = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
    input.dispatchEvent(new Event('input'));
    expect(feedback.textContent).toContain('Link looks good');
  });

  test('preserves timestamped YouTube links when loading the player', async () => {
    const originalLoadVideo = YouTubeController.prototype.loadVideo;
    let capturedVideo:
      | string
      | {
          id: string;
          startSeconds: number;
          canonicalUrl: string;
        }
      | null = null;

    YouTubeController.prototype.loadVideo = async (
      _containerId,
      video,
      onStateChange,
    ) => {
      capturedVideo = video as typeof capturedVideo;
      onStateChange?.(1);
    };

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

    input.value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s';
    input.dispatchEvent(new Event('input'));
    loadButton.click();
    await flush();

    expect(capturedVideo).not.toBeNull();
    const parsedVideo = capturedVideo as unknown as {
      id: string;
      startSeconds: number;
      canonicalUrl: string;
    };
    expect(parsedVideo.id).toBe('dQw4w9WgXcQ');
    expect(parsedVideo.startSeconds).toBe(43);
    expect(parsedVideo.canonicalUrl).toBe(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=43s',
    );

    YouTubeController.prototype.loadVideo = originalLoadVideo;
  });

  test('updates YouTube feedback after a player finishes loading', async () => {
    const originalGetRecentVideos = YouTubeController.prototype.getRecentVideos;
    const originalLoadVideo = YouTubeController.prototype.loadVideo;

    YouTubeController.prototype.getRecentVideos = () => [
      {
        id: 'dQw4w9WgXcQ',
        title: 'Never Gonna Give You Up',
        timestamp: Date.now(),
      },
    ];
    YouTubeController.prototype.loadVideo = async (
      _containerId,
      _video,
      onStateChange,
    ) => {
      onStateChange?.(1);
    };

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
    const feedback = container.querySelector(
      '[data-youtube-url-feedback]',
    ) as HTMLElement;
    const captureButton = container.querySelector(
      '#use-youtube-audio',
    ) as HTMLButtonElement;

    input.value = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
    input.dispatchEvent(new Event('input'));
    loadButton.click();
    await flush();

    expect(feedback.textContent).toContain('Video is ready');
    expect(captureButton.disabled).toBe(false);

    YouTubeController.prototype.getRecentVideos = originalGetRecentVideos;
    YouTubeController.prototype.loadVideo = originalLoadVideo;
  });

  test('prepares the MilkDrop context before loading YouTube playback', async () => {
    const originalLoadVideo = YouTubeController.prototype.loadVideo;
    const prepareContext = mock(() => {});

    YouTubeController.prototype.loadVideo = async (
      _containerId,
      _video,
      onStateChange,
    ) => {
      onStateChange?.(1);
    };

    const container = document.createElement('section');

    initAudioControls(container, {
      onRequestMicrophone: async () => {},
      onRequestDemoAudio: async () => {},
      onRequestYouTubeAudio: async () => {},
      onPrepareYouTubeContext: prepareContext,
    });

    const input = container.querySelector('#youtube-url') as HTMLInputElement;
    const loadButton = container.querySelector(
      '#load-youtube',
    ) as HTMLButtonElement;

    input.value = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
    input.dispatchEvent(new Event('input'));
    loadButton.click();
    await flush();

    expect(prepareContext).toHaveBeenCalledTimes(1);

    YouTubeController.prototype.loadVideo = originalLoadVideo;
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
