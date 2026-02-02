/**
 * Agent-friendly API for programmatic interaction with toys.
 * Exposes state and control hooks on window.stimState for MCP tools and automation.
 */

export type StimState = {
  currentToy: string | null;
  audioActive: boolean;
  audioSource: 'microphone' | 'demo' | null;
  toyLoaded: boolean;
  isAgentMode: boolean;
  version: string;
};

export type StimAPI = {
  // Current state
  getState: () => StimState;

  // Control methods
  enableDemoAudio: () => Promise<void>;
  enableMicrophone: () => Promise<void>;
  returnToLibrary: () => void;

  // Event listeners
  onToyLoad: (callback: (slug: string) => void) => () => void;
  onAudioStart: (
    callback: (source: 'microphone' | 'demo') => void,
  ) => () => void;
  onAudioStop: (callback: () => void) => () => void;

  // Utility
  waitForToyLoad: () => Promise<string>;
  waitForAudioActive: () => Promise<'microphone' | 'demo'>;
};

type StimEventMap = {
  'toy:load': { slug: string };
  'audio:start': { source: 'microphone' | 'demo' };
  'audio:stop': undefined;
};

declare global {
  interface Window {
    stimState?: StimAPI;
  }
}

const state: StimState = {
  currentToy: null,
  audioActive: false,
  audioSource: null,
  toyLoaded: false,
  isAgentMode: false,
  version: '1.0.0',
};

const eventTarget =
  typeof window !== 'undefined' && window.EventTarget
    ? new window.EventTarget()
    : new EventTarget();

const addStimEventListener = <K extends keyof StimEventMap>(
  eventName: K,
  callback: (detail: StimEventMap[K]) => void,
) => {
  const handler = ((event: CustomEvent) => {
    callback(event.detail as StimEventMap[K]);
  }) as EventListener;

  eventTarget.addEventListener(eventName, handler);
  return () => eventTarget.removeEventListener(eventName, handler);
};

const waitForStimEvent = <K extends keyof StimEventMap>(eventName: K) =>
  new Promise<StimEventMap[K]>((resolve) => {
    const removeListener = addStimEventListener(eventName, (detail) => {
      removeListener();
      resolve(detail);
    });
  });

// Check for agent mode from URL
if (typeof window !== 'undefined') {
  const params = new URLSearchParams(window.location.search);
  state.isAgentMode = params.get('agent') === 'true';
}

export function initAgentAPI(): StimAPI {
  const api: StimAPI = {
    getState: () => ({ ...state }),

    enableDemoAudio: async () => {
      const demoBtn = document.querySelector(
        '[data-demo-audio-btn], #use-demo-audio',
      ) as HTMLButtonElement;

      if (!demoBtn) {
        throw new Error('Demo audio button not found');
      }

      demoBtn.click();
      await waitForAudioActive();
    },

    enableMicrophone: async () => {
      const micBtn = document.querySelector(
        '[data-mic-audio-btn], #start-audio-btn',
      ) as HTMLButtonElement;

      if (!micBtn) {
        throw new Error('Microphone button not found');
      }

      micBtn.click();
      await waitForAudioActive();
    },

    returnToLibrary: () => {
      const backBtn = document.querySelector(
        '[data-back-to-library]',
      ) as HTMLButtonElement;

      if (backBtn) {
        backBtn.click();
      } else {
        // Fallback: dispatch Escape key
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      }
    },

    onToyLoad: (callback) => {
      return addStimEventListener('toy:load', (detail) =>
        callback(detail.slug),
      );
    },

    onAudioStart: (callback) => {
      return addStimEventListener('audio:start', (detail) =>
        callback(detail.source),
      );
    },

    onAudioStop: (callback) => {
      return addStimEventListener('audio:stop', () => callback());
    },

    waitForToyLoad: () => waitForToyLoad(),
    waitForAudioActive: () => waitForAudioActive(),
  };

  // Expose globally for agents
  if (typeof window !== 'undefined') {
    window.stimState = api;
  }

  return api;
}

function waitForToyLoad(): Promise<string> {
  if (state.toyLoaded && state.currentToy) {
    return Promise.resolve(state.currentToy);
  }

  return waitForStimEvent('toy:load').then((detail) => detail.slug);
}

function waitForAudioActive(): Promise<'microphone' | 'demo'> {
  if (state.audioActive && state.audioSource) {
    return Promise.resolve(state.audioSource);
  }

  return waitForStimEvent('audio:start').then((detail) => detail.source);
}

// Public methods for other modules to update state
export function setCurrentToy(slug: string | null) {
  state.currentToy = slug;
  state.toyLoaded = slug !== null;

  if (slug) {
    eventTarget.dispatchEvent(
      new CustomEvent('toy:load', { detail: { slug } }),
    );

    // Add data attribute to body
    if (typeof document !== 'undefined') {
      document.body.dataset.currentToy = slug;
      document.body.dataset.toyLoaded = 'true';
    }
  } else {
    if (typeof document !== 'undefined') {
      delete document.body.dataset.currentToy;
      document.body.dataset.toyLoaded = 'false';
    }
  }
}

export function setAudioActive(
  active: boolean,
  source: 'microphone' | 'demo' | null = null,
) {
  state.audioActive = active;
  state.audioSource = source;

  if (active && source) {
    eventTarget.dispatchEvent(
      new CustomEvent('audio:start', { detail: { source } }),
    );

    if (typeof document !== 'undefined') {
      document.body.dataset.audioActive = 'true';
      document.body.dataset.audioSource = source;
    }
  } else {
    eventTarget.dispatchEvent(new CustomEvent('audio:stop'));

    if (typeof document !== 'undefined') {
      document.body.dataset.audioActive = 'false';
      delete document.body.dataset.audioSource;
    }
  }
}

export function isAgentMode(): boolean {
  return state.isAgentMode;
}
