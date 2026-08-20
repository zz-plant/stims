import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { setMotionPreference } from '../../src/js/core/motion-preferences.ts';
import {
  isViewTransitionAllowed,
  runViewTransition,
  supportsViewTransitions,
} from '../../src/js/frontend/view-transition.ts';

const originalStartViewTransition = globalThis.document.startViewTransition;
const originalMatchMedia = globalThis.window.matchMedia;

let startCalls: Array<() => void>;
let finishTransition: (() => void) | null;

function installStartViewTransition() {
  startCalls = [];
  finishTransition = null;
  Object.defineProperty(globalThis.document, 'startViewTransition', {
    configurable: true,
    writable: true,
    value: mock((update: () => void) => {
      startCalls.push(update);
      let resolveFinished!: () => void;
      const finished = new Promise<void>((resolve) => {
        resolveFinished = resolve;
      });
      finishTransition = resolveFinished;
      return { finished } as ViewTransition;
    }),
  });
}

function setReducedMotion(reduced: boolean) {
  globalThis.window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: reduced,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

function removeStartViewTransition() {
  delete (
    globalThis.document as unknown as {
      startViewTransition?: unknown;
    }
  ).startViewTransition;
}

beforeEach(() => {
  setMotionPreference({ enabled: true });
  setReducedMotion(false);
  installStartViewTransition();
});

afterEach(async () => {
  finishTransition?.();
  await Promise.resolve();
  if (originalStartViewTransition === undefined) {
    removeStartViewTransition();
  } else {
    globalThis.document.startViewTransition = originalStartViewTransition;
  }
  if (originalMatchMedia) {
    globalThis.window.matchMedia = originalMatchMedia;
  }
  setMotionPreference({ enabled: true });
});

describe('view-transition helper', () => {
  it('reports no support without document.startViewTransition', () => {
    removeStartViewTransition();
    expect(supportsViewTransitions()).toBe(false);
  });

  it('reports support when startViewTransition exists', () => {
    expect(supportsViewTransitions()).toBe(true);
  });

  it('disallows when unsupported', () => {
    removeStartViewTransition();
    expect(isViewTransitionAllowed()).toBe(false);
  });

  it('disallows when the app motion preference is off', () => {
    setMotionPreference({ enabled: false });
    expect(isViewTransitionAllowed()).toBe(false);
  });

  it('disallows when the OS prefers reduced motion', () => {
    setReducedMotion(true);
    expect(isViewTransitionAllowed()).toBe(false);
  });

  it('allows when supported, motion on, and no reduced motion', () => {
    expect(isViewTransitionAllowed()).toBe(true);
  });

  it('falls back to a direct update when not allowed', () => {
    setMotionPreference({ enabled: false });
    const update = mock(() => {});
    runViewTransition(update);
    expect(update).toHaveBeenCalled();
    expect(startCalls).toHaveLength(0);
  });

  it('runs the update inside startViewTransition when allowed', () => {
    const update = mock(() => {});
    runViewTransition(update);
    expect(startCalls).toHaveLength(1);
    startCalls[0]?.();
    expect(update).toHaveBeenCalled();
  });

  it('clears the active transition when it finishes', async () => {
    const update = mock(() => {});
    runViewTransition(update);
    finishTransition?.();
    await Promise.resolve();
    runViewTransition(update);
    expect(startCalls).toHaveLength(2);
  });

  it('updates directly instead of re-entering a running transition', () => {
    const first = mock(() => {});
    runViewTransition(first);
    const second = mock(() => {});
    runViewTransition(second);
    expect(second).toHaveBeenCalled();
    expect(startCalls).toHaveLength(1);
  });
});
