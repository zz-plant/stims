import { describe, expect, test } from 'bun:test';
import {
  FallbackEvent,
  FallbackState,
  FallbackStateMachine,
  getInvalidTransitionMessage,
  isValidTransition,
  transition,
} from '../assets/js/core/fallback-state.ts';
import type { RenderScale } from '../assets/js/core/renderer-types.ts';
import {
  createRenderScale,
  isRenderScale,
} from '../assets/js/core/renderer-types.ts';

describe('fallback state machine - valid transitions', () => {
  const validTransitions: Array<[FallbackState, FallbackState]> = [
    [FallbackState.Initial, FallbackState.ProbingWebgl],
    [FallbackState.Initial, FallbackState.ErrorNoBackend],
    [FallbackState.ProbingWebgl, FallbackState.ProbingWebgpu],
    [FallbackState.ProbingWebgl, FallbackState.ErrorNoBackend],
    [FallbackState.ProbingWebgpu, FallbackState.RendererReady],
    [FallbackState.ProbingWebgpu, FallbackState.RendererTimeout],
    [FallbackState.ProbingWebgpu, FallbackState.ErrorNoBackend],
    [FallbackState.RendererTimeout, FallbackState.RendererReady],
    [FallbackState.RendererTimeout, FallbackState.ErrorNoBackend],
    [FallbackState.RendererReady, FallbackState.RendererDegraded],
    [FallbackState.RendererReady, FallbackState.RendererReady],
    [FallbackState.RendererReady, FallbackState.PoolingRenderer],
    [FallbackState.PoolingRenderer, FallbackState.RendererReady],
    [FallbackState.RendererReady, FallbackState.Initial],
    [FallbackState.RendererReady, FallbackState.AudioInitializing],
    [FallbackState.PoolingRenderer, FallbackState.AudioInitializing],
    [FallbackState.AudioInitializing, FallbackState.AudioReady],
    [FallbackState.AudioInitializing, FallbackState.ErrorNoAudio],
    [FallbackState.AudioReady, FallbackState.ErrorNoAudio],
    [FallbackState.AudioReady, FallbackState.RendererDegraded],
    [FallbackState.AudioReady, FallbackState.AudioReady],
    [FallbackState.RendererDegraded, FallbackState.RendererReady],
    [FallbackState.AudioReady, FallbackState.Ready],
    [FallbackState.ErrorNoAudio, FallbackState.RendererReady],
    [FallbackState.ErrorNoAudio, FallbackState.Ready],
    [FallbackState.RendererDegraded, FallbackState.PoolingRenderer],
    [FallbackState.RendererDegraded, FallbackState.RendererDegraded],
  ];

  test.each(validTransitions)('%s → %s is valid', (from, to) => {
    expect(isValidTransition(from, to)).toBe(true);
  });

  test.each(
    validTransitions,
  )('transition from %s to %s returns the target state', (from, to) => {
    expect(transition(from, to)).toBe(to);
  });
});

describe('fallback state machine - invalid transitions', () => {
  const invalidTransitions: Array<[FallbackState, FallbackState, string]> = [
    [
      FallbackState.Initial,
      FallbackState.AudioInitializing,
      'Audio requires a renderer for the Three.js AudioListener',
    ],
    [
      FallbackState.ProbingWebgpu,
      FallbackState.AudioInitializing,
      'Audio must not begin before the backend is resolved',
    ],
    [
      FallbackState.RendererReady,
      FallbackState.AudioReady,
      'Audio setup is async; no synchronous path from no-audio to audio-ready',
    ],
    [
      FallbackState.ErrorNoBackend,
      FallbackState.RendererReady,
      'Once no backend is available, only a page reload can re-probe',
    ],
    [
      FallbackState.RendererDegraded,
      FallbackState.ProbingWebgpu,
      'The degraded state is terminal for the session',
    ],
    [
      FallbackState.RendererTimeout,
      FallbackState.RendererTimeout,
      'A timeout can only resolve to a fallback or failure',
    ],
  ];

  test.each(invalidTransitions)('%s → %s is invalid', (from, to) => {
    expect(isValidTransition(from, to)).toBe(false);
  });

  test.each(
    invalidTransitions,
  )('transition from %s to %s throws', (from, to) => {
    expect(() => transition(from, to)).toThrow(
      `Invalid fallback state transition: ${from} → ${to}`,
    );
  });

  test.each(
    invalidTransitions,
  )('getInvalidTransitionMessage for %s → %s returns reason', (from, to, reason) => {
    expect(getInvalidTransitionMessage(from, to)).toBe(reason);
  });
});

describe('fallback state machine - self-transitions on valid states', () => {
  test('renderer-ready → renderer-ready is valid (recovery succeeds)', () => {
    expect(
      transition(FallbackState.RendererReady, FallbackState.RendererReady),
    ).toBe(FallbackState.RendererReady);
  });

  test('audio-ready → audio-ready is valid (context resumed)', () => {
    expect(transition(FallbackState.AudioReady, FallbackState.AudioReady)).toBe(
      FallbackState.AudioReady,
    );
  });

  test('renderer-degraded → renderer-degraded is valid (backend-fallback trigger)', () => {
    expect(
      transition(
        FallbackState.RendererDegraded,
        FallbackState.RendererDegraded,
      ),
    ).toBe(FallbackState.RendererDegraded);
  });
});

describe('fallback state machine - complete flow paths', () => {
  test('happy path: initial → probing-webgl → probing-webgpu → renderer-ready', () => {
    let state = transition(FallbackState.Initial, FallbackState.ProbingWebgl);
    state = transition(state, FallbackState.ProbingWebgpu);
    state = transition(state, FallbackState.RendererReady);
    expect(state).toBe(FallbackState.RendererReady);
  });

  test('timeout path: probing-webgpu → renderer-timeout → renderer-ready', () => {
    let state = transition(
      FallbackState.ProbingWebgpu,
      FallbackState.RendererTimeout,
    );
    state = transition(state, FallbackState.RendererReady);
    expect(state).toBe(FallbackState.RendererReady);
  });

  test('full audio path: renderer-ready → audio-initializing → audio-ready → ready', () => {
    let state = transition(
      FallbackState.RendererReady,
      FallbackState.AudioInitializing,
    );
    state = transition(state, FallbackState.AudioReady);
    state = transition(state, FallbackState.Ready);
    expect(state).toBe(FallbackState.Ready);
  });

  test('pool flow: renderer-ready → pooling-renderer → renderer-ready', () => {
    let state = transition(
      FallbackState.RendererReady,
      FallbackState.PoolingRenderer,
    );
    state = transition(state, FallbackState.RendererReady);
    expect(state).toBe(FallbackState.RendererReady);
  });

  test('error-no-audio fallback: error-no-audio → ready', () => {
    const state = transition(FallbackState.ErrorNoAudio, FallbackState.Ready);
    expect(state).toBe(FallbackState.Ready);
  });

  test('degraded pool: renderer-degraded → pooling-renderer', () => {
    const state = transition(
      FallbackState.RendererDegraded,
      FallbackState.PoolingRenderer,
    );
    expect(state).toBe(FallbackState.PoolingRenderer);
  });
});

describe('fallback state machine - unreachable flows', () => {
  test('cannot go from initial to audio-initializing directly', () => {
    expect(
      isValidTransition(FallbackState.Initial, FallbackState.AudioInitializing),
    ).toBe(false);
  });

  test('cannot go from error-no-backend to renderer-ready', () => {
    expect(
      isValidTransition(
        FallbackState.ErrorNoBackend,
        FallbackState.RendererReady,
      ),
    ).toBe(false);
  });

  test('cannot skip audio-initializing to reach audio-ready', () => {
    expect(
      isValidTransition(FallbackState.RendererReady, FallbackState.AudioReady),
    ).toBe(false);
  });
});

describe('fallback state - getInvalidTransitionMessage returns null for valid transitions', () => {
  test('returns null for a valid transition', () => {
    expect(
      getInvalidTransitionMessage(
        FallbackState.Initial,
        FallbackState.ProbingWebgl,
      ),
    ).toBeNull();
  });

  test('returns null for an unlisted but valid transition', () => {
    expect(
      getInvalidTransitionMessage(
        FallbackState.AudioReady,
        FallbackState.Ready,
      ),
    ).toBeNull();
  });
});

describe('renderer-types', () => {
  test('createRenderScale creates a branded number', () => {
    const scale = createRenderScale(0.75);
    expect(scale).toBe(0.75 as RenderScale);
    expect(typeof scale).toBe('number');
  });

  test('createRenderScale rejects zero', () => {
    expect(() => createRenderScale(0)).toThrow(
      'Invalid render scale: 0. Must be a positive finite number.',
    );
  });

  test('createRenderScale rejects negative', () => {
    expect(() => createRenderScale(-0.5)).toThrow(
      'Invalid render scale: -0.5. Must be a positive finite number.',
    );
  });

  test('createRenderScale rejects NaN', () => {
    expect(() => createRenderScale(Number.NaN)).toThrow(
      'Invalid render scale: NaN. Must be a positive finite number.',
    );
  });

  test('createRenderScale rejects Infinity', () => {
    expect(() => createRenderScale(Number.POSITIVE_INFINITY)).toThrow(
      'Invalid render scale: Infinity. Must be a positive finite number.',
    );
  });

  test('isRenderScale returns true for a branded value', () => {
    expect(isRenderScale(createRenderScale(1))).toBe(true);
  });

  test('isRenderScale returns false for non-finite numbers', () => {
    expect(isRenderScale(Number.NaN)).toBe(false);
    expect(isRenderScale(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isRenderScale(0)).toBe(false);
    expect(isRenderScale(-1)).toBe(false);
  });

  test('RenderScale type alias works with arithmetic', () => {
    const scale: RenderScale = createRenderScale(0.5);
    const doubled: RenderScale = createRenderScale(scale * 2);
    expect(doubled).toBe(1 as RenderScale);
  });
});

describe('FallbackStateMachine class', () => {
  test('initializes with default state', () => {
    const fsm = new FallbackStateMachine();
    expect(fsm.getState()).toBe(FallbackState.Initial);
  });

  test('initializes with custom state', () => {
    const fsm = new FallbackStateMachine(FallbackState.RendererReady);
    expect(fsm.getState()).toBe(FallbackState.RendererReady);
  });

  test('valid transition updates state and returns it', () => {
    const fsm = new FallbackStateMachine();
    const next = fsm.transition(FallbackEvent.CHECK_WEBGL);
    expect(next).toBe(FallbackState.ProbingWebgl);
    expect(fsm.getState()).toBe(FallbackState.ProbingWebgl);
  });

  test('invalid transition throws error with reason', () => {
    const fsm = new FallbackStateMachine();
    expect(() => fsm.transition(FallbackEvent.INIT_AUDIO)).toThrow(
      /Invalid fallback state transition from initial via event INIT_AUDIO: Audio requires a renderer for the Three.js AudioListener/,
    );
  });

  test('notifies listeners on transition', () => {
    const fsm = new FallbackStateMachine();
    let called = false;
    let statePassed: FallbackState | null = null;
    let eventPassed: FallbackEvent | null = null;

    fsm.onTransition((state, event) => {
      called = true;
      statePassed = state;
      eventPassed = event;
    });

    fsm.transition(FallbackEvent.CHECK_WEBGL);
    expect(called).toBe(true);
    expect(statePassed as unknown as FallbackState).toBe(
      FallbackState.ProbingWebgl,
    );
    expect(eventPassed as unknown as FallbackEvent).toBe(
      FallbackEvent.CHECK_WEBGL,
    );
  });

  test('unsubscribing listeners works', () => {
    const fsm = new FallbackStateMachine();
    let count = 0;
    const unsubscribe = fsm.onTransition(() => {
      count++;
    });

    fsm.transition(FallbackEvent.CHECK_WEBGL);
    expect(count).toBe(1);

    unsubscribe();
    fsm.transition(FallbackEvent.START_PROBE_WEBGPU);
    expect(count).toBe(1);
  });
});
