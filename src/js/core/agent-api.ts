/**
 * Agent-friendly API for programmatic interaction with toys.
 * Exposes state and control hooks on window.stimState for MCP tools and automation.
 */

import { resetAllOverrides } from './reset-overrides.ts';
import { isAgentMode as readAgentModeFromURL } from './url-params.ts';

export type StimState = {
  currentToy: string | null;
  audioActive: boolean;
  audioSource: 'microphone' | 'demo' | 'tab' | 'youtube' | 'file' | null;
  toyLoaded: boolean;
  isAgentMode: boolean;
  vibeMode: boolean;
  version: string;
};

export type StimAPI = {
  // Current state
  getState: () => StimState;
  getDebugSnapshot: (key: string) => unknown | null;

  // Control methods
  enableDemoAudio: () => Promise<void>;
  enableMicrophone: () => Promise<void>;
  returnToLibrary: () => void;

  // Event listeners
  onToyLoad: (callback: (slug: string) => void) => () => void;
  onAudioStart: (
    callback: (
      source: 'microphone' | 'demo' | 'tab' | 'youtube' | 'file',
    ) => void,
  ) => () => void;
  onAudioStop: (callback: () => void) => () => void;

  // Utility
  waitForToyLoad: () => Promise<string>;
  waitForAudioActive: () => Promise<
    'microphone' | 'demo' | 'tab' | 'youtube' | 'file'
  >;
  activateVibeMode: (durationMs?: number) => Promise<void>;
  resetOverrides: () => { clearedKeys: string[] };
};

type StimEventMap = {
  'toy:load': { slug: string };
  'audio:start': { source: 'microphone' | 'demo' | 'tab' | 'youtube' | 'file' };
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
  vibeMode: false,
  version: '1.0.0',
};

const DEFAULT_VIBE_MODE_DURATION = 3500;

const eventTarget =
  typeof window !== 'undefined' && window.EventTarget
    ? new window.EventTarget()
    : new EventTarget();
const debugSnapshots = new Map<string, unknown>();

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
  state.isAgentMode = readAgentModeFromURL();
}

/**
 * Reveals a control that is inside a collapsed `<details>` before clicking it.
 *
 * The home page's alternative audio sources (mic, tab, file, YouTube) now sit
 * behind a disclosure so the primary CTA can rank above them. `.click()` on a
 * `display:none` descendant does nothing, so every automation path that
 * targets those buttons by id — this API, and the e2e suite — has to open
 * the disclosure the same way a person would. Walking ancestors keeps that
 * true if the markup is nested differently later.
 */
function revealForClick(element: HTMLElement): void {
  let node: HTMLElement | null = element.parentElement;
  while (node) {
    if (node instanceof HTMLDetailsElement) node.open = true;
    node = node.parentElement;
  }
}

/**
 * Picks the on-screen match when a control legitimately appears more than
 * once.
 *
 * AudioSourcePanel renders in both the home page and the Settings sheet, and
 * both are mounted at the same time whenever Settings is open — so these
 * selectors match twice. `querySelector` alone returns the first in document
 * order, which is the home copy, i.e. the one *behind* the panel the user is
 * actually looking at. Preferring a visible match makes the automation act on
 * the surface in front of the user; falling back to the first keeps the
 * previous behaviour when everything is hidden (a collapsed disclosure, which
 * revealForClick then opens).
 */
function findClickTarget(selector: string): HTMLElement | null {
  const matches = [...document.querySelectorAll<HTMLElement>(selector)];
  if (matches.length === 0) return null;
  return matches.find((el) => el.offsetParent !== null) ?? matches[0];
}

export function initAgentAPI(): StimAPI {
  const api: StimAPI = {
    getState: () => ({ ...state }),
    getDebugSnapshot: (key) => {
      return debugSnapshots.get(key) ?? null;
    },

    enableDemoAudio: async () => {
      // The id is a fallback for the home CTA only; the data attribute is
      // the contract and is what both AudioSourcePanel copies carry.
      const demoBtn = findClickTarget('[data-demo-audio-btn], #use-demo-audio');

      if (!demoBtn) {
        throw new Error('Demo audio button not found');
      }

      revealForClick(demoBtn);
      demoBtn.click();
      await waitForAudioActive();
    },

    enableMicrophone: async () => {
      // data-mic-audio-btn was referenced here long before anything set it,
      // so this had been silently falling through to #start-audio-btn — a
      // duplicated id that resolved to whichever copy came first in the DOM.
      // The attribute now exists on the mic card itself.
      const micBtn = findClickTarget('[data-mic-audio-btn], #start-audio-btn');

      if (!micBtn) {
        throw new Error('Microphone button not found');
      }

      revealForClick(micBtn);
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
    activateVibeMode: async (durationMs = DEFAULT_VIBE_MODE_DURATION) => {
      if (typeof document === 'undefined') {
        return;
      }

      const root = document.documentElement;
      const clampedDuration = Math.max(500, durationMs);
      const clampedIntensity = Math.max(
        0.8,
        Math.min(2.2, clampedDuration / 1800),
      );

      state.vibeMode = true;
      root.dataset.agentVibeMode = 'true';
      root.style.setProperty(
        '--agent-vibe-intensity',
        clampedIntensity.toFixed(2),
      );

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          state.vibeMode = false;
          delete root.dataset.agentVibeMode;
          root.style.removeProperty('--agent-vibe-intensity');
          resolve();
        }, clampedDuration);
      });
    },
    resetOverrides: () => resetAllOverrides(),
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

function waitForAudioActive(): Promise<
  'microphone' | 'demo' | 'tab' | 'youtube' | 'file'
> {
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
  source: 'microphone' | 'demo' | 'tab' | 'youtube' | 'file' | null = null,
) {
  state.audioActive = active;
  state.audioSource = source;

  if (active && source) {
    eventTarget.dispatchEvent(
      new CustomEvent('audio:start', { detail: { source } }),
    );

    if (typeof document !== 'undefined') {
      document.body.dataset.audioActive = 'true';
      document
        .querySelector('[data-audio-controls]')
        ?.setAttribute('hidden', '');
    }
  } else {
    eventTarget.dispatchEvent(new CustomEvent('audio:stop'));

    if (typeof document !== 'undefined') {
      document.body.dataset.audioActive = 'false';
      document
        .querySelector('[data-audio-controls]')
        ?.removeAttribute('hidden');
    }
  }
}

export function isAgentMode(): boolean {
  return state.isAgentMode;
}

export function setDebugSnapshot(key: string, value: unknown) {
  debugSnapshots.set(key, value);
}

export function clearDebugSnapshot(key: string) {
  debugSnapshots.delete(key);
}
