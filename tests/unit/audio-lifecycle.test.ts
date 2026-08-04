/**
 * Tests for the audio lifecycle contract — the three invariants that
 * recurred as bugs in the last 400 commits:
 *
 *  A. Leak  — AudioContext created but never closed (`e6141ae1`).
 *  B. Permission ordering — mic permission requested after mount (`6eb0e141`).
 *  C. Generation race — disposed session resurrected (`d2fac61b`, `f4861a68`).
 */
import { describe, expect, test } from 'bun:test';
import {
  type AudioContextLike,
  AudioGenerationToken,
  AudioLifecycleTracker,
} from '../../src/js/core/audio-lifecycle.ts';

function makeFakeContext(): AudioContextLike {
  let state = 'running';
  return {
    get state() {
      return state;
    },
    close() {
      state = 'closed';
    },
  };
}

describe('AudioLifecycleTracker — invariant A (no leaked contexts)', () => {
  test('passes when every created context is closed', () => {
    const tracker = new AudioLifecycleTracker();
    const ctx = makeFakeContext();
    tracker.transition('awaiting-gesture');
    tracker.transition('context-created');
    tracker.trackContextCreate(ctx, 'demo');
    tracker.trackActive();
    tracker.transition('draining');
    tracker.trackContextClose(ctx);
    tracker.trackDispose();
    expect(() => tracker.assertNoLeakedContexts()).not.toThrow();
  });

  test('fails when a context is left open', () => {
    const tracker = new AudioLifecycleTracker();
    const ctx = makeFakeContext();
    tracker.transition('awaiting-gesture');
    tracker.transition('context-created');
    tracker.trackContextCreate(ctx, 'demo');
    tracker.trackActive();
    tracker.transition('draining');
    tracker.trackDispose();
    expect(() => tracker.assertNoLeakedContexts()).toThrow(/leak/);
  });
});

describe('AudioLifecycleTracker — invariant B (permission before context)', () => {
  test('passes when mic permission is requested before context creation', () => {
    const tracker = new AudioLifecycleTracker();
    tracker.transition('awaiting-gesture');
    tracker.trackPermissionRequest('microphone');
    tracker.transition('context-created');
    tracker.trackContextCreate(makeFakeContext(), 'microphone');
    expect(() =>
      tracker.assertPermissionBeforeContext('microphone'),
    ).not.toThrow();
  });

  test('fails when context is created before mic permission', () => {
    const tracker = new AudioLifecycleTracker();
    tracker.transition('awaiting-gesture');
    tracker.transition('context-created');
    tracker.trackContextCreate(makeFakeContext(), 'microphone');
    tracker.trackPermissionRequest('microphone');
    expect(() => tracker.assertPermissionBeforeContext('microphone')).toThrow(
      /before permission/,
    );
  });

  test('skips the check for non-permission sources (demo)', () => {
    const tracker = new AudioLifecycleTracker();
    tracker.transition('awaiting-gesture');
    tracker.transition('context-created');
    tracker.trackContextCreate(makeFakeContext(), 'demo');
    expect(() => tracker.assertPermissionBeforeContext('demo')).not.toThrow();
  });
});

describe('AudioLifecycleTracker — invariant C (generation race)', () => {
  test('a disposed session stays terminal', () => {
    const tracker = new AudioLifecycleTracker();
    tracker.transition('awaiting-gesture');
    tracker.transition('context-created');
    tracker.trackContextCreate(makeFakeContext(), 'demo');
    tracker.trackActive();
    tracker.transition('draining');
    tracker.trackDispose();
    expect(() => tracker.assertTerminalAfterDispose()).not.toThrow();
  });

  test('rejects invalid transitions from disposed', () => {
    const tracker = new AudioLifecycleTracker();
    tracker.transition('awaiting-gesture');
    tracker.transition('context-created');
    tracker.transition('active');
    tracker.transition('draining');
    tracker.trackDispose();
    expect(() => tracker.transition('active')).toThrow(/invalid transition/);
  });
});

describe('AudioLifecycleTracker — state machine', () => {
  test('idle can go to awaiting-gesture but not active', () => {
    const tracker = new AudioLifecycleTracker();
    expect(() => tracker.transition('active')).toThrow(/invalid transition/);
    expect(() => tracker.transition('awaiting-gesture')).not.toThrow();
  });
});

describe('AudioGenerationToken', () => {
  test('a superseded generation is not current', () => {
    const token = new AudioGenerationToken();
    const gen0 = token.bump();
    expect(token.isCurrent(gen0)).toBe(true);
    token.bump();
    expect(token.isCurrent(gen0)).toBe(false);
  });

  test('simulates StrictMode double-mount detection', () => {
    const token = new AudioGenerationToken();
    const mountGen = token.bump();
    // StrictMode unmounts and remounts — bump the generation.
    token.bump();
    // The stale mount promise resolves; it must detect it is superseded.
    expect(token.isCurrent(mountGen)).toBe(false);
  });
});
