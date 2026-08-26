/**
 * A suspended AudioContext is silent but looks active from every other
 * signal: the session reports `audioActive`, the stage animates, the analyser
 * reads zero. The deep-link path starts audio without a click on purpose, so
 * that state is reachable by design — this gate is what lets the UI say so
 * and take the message away the moment the click lands.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import {
  isAudioAwaitingGesture,
  reportAudioAwaitingGesture,
  resetAudioGestureGate,
  subscribeAudioGestureGate,
} from '../../src/js/core/audio-gesture-gate.ts';
import {
  registerAudioContext,
  unregisterAudioContext,
} from '../../src/js/core/audio-handler.ts';

afterEach(() => {
  resetAudioGestureGate();
});

describe('audio gesture gate', () => {
  test('starts closed, because nothing has started audio yet', () => {
    expect(isAudioAwaitingGesture()).toBe(false);
  });

  test('notifies subscribers when audio starts out suspended', () => {
    let notifications = 0;
    subscribeAudioGestureGate(() => {
      notifications += 1;
    });

    reportAudioAwaitingGesture(true);

    expect(notifications).toBe(1);
    expect(isAudioAwaitingGesture()).toBe(true);
  });

  test('does not re-notify on an unchanged value', () => {
    let notifications = 0;
    subscribeAudioGestureGate(() => {
      notifications += 1;
    });

    reportAudioAwaitingGesture(true);
    reportAudioAwaitingGesture(true);
    reportAudioAwaitingGesture(true);

    // Every `statechange` on every registered context calls through here; a
    // notify per event would re-render the whole shell on each one.
    expect(notifications).toBe(1);
  });

  test('closes again when the context resumes', () => {
    const seen: boolean[] = [];
    subscribeAudioGestureGate(() => {
      seen.push(isAudioAwaitingGesture());
    });

    reportAudioAwaitingGesture(true);
    reportAudioAwaitingGesture(false);

    expect(seen).toEqual([true, false]);
    expect(isAudioAwaitingGesture()).toBe(false);
  });

  test('unsubscribing stops notifications', () => {
    let notifications = 0;
    const unsubscribe = subscribeAudioGestureGate(() => {
      notifications += 1;
    });

    unsubscribe();
    reportAudioAwaitingGesture(true);

    expect(notifications).toBe(0);
    expect(isAudioAwaitingGesture()).toBe(true);
  });
});

describe('audio gesture gate wiring', () => {
  test('audio-handler publishes the gate from real context state', () => {
    // Drives the real registerAudioContext/unregisterAudioContext with a fake
    // context instead of grepping audio-handler's source. The gate must be
    // recomputed from the live contexts, not set optimistically at start: the
    // browser can resume on its own, and a stale `true` would leave "click
    // for sound" on screen over working audio.
    const listeners = new Set<() => void>();
    const fakeContext = {
      state: 'suspended' as AudioContextState,
      addEventListener: (_type: string, handler: () => void) => {
        listeners.add(handler);
      },
      removeEventListener: (_type: string, handler: () => void) => {
        listeners.delete(handler);
      },
    } as unknown as AudioContext;

    registerAudioContext(fakeContext);
    // Registering a suspended context publishes the gate immediately.
    expect(isAudioAwaitingGesture()).toBe(true);

    // The browser resumes on its own; the statechange handler must clear it.
    (fakeContext as { state: AudioContextState }).state = 'running';
    for (const handler of listeners) handler();
    expect(isAudioAwaitingGesture()).toBe(false);

    // Suspend again, then unregister: the notice cannot survive the session
    // it describes.
    (fakeContext as { state: AudioContextState }).state = 'suspended';
    for (const handler of listeners) handler();
    expect(isAudioAwaitingGesture()).toBe(true);
    unregisterAudioContext(fakeContext);
    expect(isAudioAwaitingGesture()).toBe(false);
  });
});
