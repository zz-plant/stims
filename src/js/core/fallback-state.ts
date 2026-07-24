export enum FallbackState {
  Initial = 'initial',
  ProbingWebgl = 'probing-webgl',
  ProbingWebgpu = 'probing-webgpu',
  RendererReady = 'renderer-ready',
  RendererTimeout = 'renderer-timeout',
  RendererDegraded = 'renderer-degraded',
  PoolingRenderer = 'pooling-renderer',
  AudioInitializing = 'audio-initializing',
  AudioReady = 'audio-ready',
  Ready = 'ready',
  ErrorNoBackend = 'error-no-backend',
  ErrorNoAudio = 'error-no-audio',
}

export enum FallbackEvent {
  CHECK_WEBGL = 'CHECK_WEBGL',
  START_PROBE_WEBGPU = 'START_PROBE_WEBGPU',
  RESOLVE_WEBGPU = 'RESOLVE_WEBGPU',
  TIMEOUT_WEBGPU = 'TIMEOUT_WEBGPU',
  FAIL_BACKEND = 'FAIL_BACKEND',
  DEGRADE_RENDERER = 'DEGRADE_RENDERER',
  POOL_RENDERER = 'POOL_RENDERER',
  INIT_AUDIO = 'INIT_AUDIO',
  AUDIO_SUCCESS = 'AUDIO_SUCCESS',
  AUDIO_FAIL = 'AUDIO_FAIL',
  COMPLETE = 'COMPLETE',
  RESET = 'RESET',
}

export const STATE_TRANSITIONS: Record<
  FallbackState,
  Partial<Record<FallbackEvent, FallbackState>>
> = {
  [FallbackState.Initial]: {
    [FallbackEvent.CHECK_WEBGL]: FallbackState.ProbingWebgl,
    [FallbackEvent.FAIL_BACKEND]: FallbackState.ErrorNoBackend,
  },
  [FallbackState.ProbingWebgl]: {
    [FallbackEvent.START_PROBE_WEBGPU]: FallbackState.ProbingWebgpu,
    [FallbackEvent.FAIL_BACKEND]: FallbackState.ErrorNoBackend,
  },
  [FallbackState.ProbingWebgpu]: {
    [FallbackEvent.RESOLVE_WEBGPU]: FallbackState.RendererReady,
    [FallbackEvent.TIMEOUT_WEBGPU]: FallbackState.RendererTimeout,
    [FallbackEvent.FAIL_BACKEND]: FallbackState.ErrorNoBackend,
  },
  [FallbackState.RendererTimeout]: {
    [FallbackEvent.RESOLVE_WEBGPU]: FallbackState.RendererReady,
    [FallbackEvent.FAIL_BACKEND]: FallbackState.ErrorNoBackend,
  },
  [FallbackState.RendererReady]: {
    [FallbackEvent.DEGRADE_RENDERER]: FallbackState.RendererDegraded,
    [FallbackEvent.RESOLVE_WEBGPU]: FallbackState.RendererReady,
    [FallbackEvent.POOL_RENDERER]: FallbackState.PoolingRenderer,
    [FallbackEvent.RESET]: FallbackState.Initial,
    [FallbackEvent.INIT_AUDIO]: FallbackState.AudioInitializing,
  },
  [FallbackState.PoolingRenderer]: {
    [FallbackEvent.RESOLVE_WEBGPU]: FallbackState.RendererReady,
    [FallbackEvent.INIT_AUDIO]: FallbackState.AudioInitializing,
  },
  [FallbackState.AudioInitializing]: {
    [FallbackEvent.AUDIO_SUCCESS]: FallbackState.AudioReady,
    [FallbackEvent.AUDIO_FAIL]: FallbackState.ErrorNoAudio,
  },
  [FallbackState.AudioReady]: {
    [FallbackEvent.AUDIO_FAIL]: FallbackState.ErrorNoAudio,
    [FallbackEvent.DEGRADE_RENDERER]: FallbackState.RendererDegraded,
    [FallbackEvent.AUDIO_SUCCESS]: FallbackState.AudioReady,
    [FallbackEvent.COMPLETE]: FallbackState.Ready,
  },
  [FallbackState.RendererDegraded]: {
    [FallbackEvent.RESOLVE_WEBGPU]: FallbackState.RendererReady,
    [FallbackEvent.POOL_RENDERER]: FallbackState.PoolingRenderer,
    [FallbackEvent.DEGRADE_RENDERER]: FallbackState.RendererDegraded,
  },
  [FallbackState.ErrorNoAudio]: {
    [FallbackEvent.RESOLVE_WEBGPU]: FallbackState.RendererReady,
    [FallbackEvent.COMPLETE]: FallbackState.Ready,
  },
  [FallbackState.Ready]: {},
  [FallbackState.ErrorNoBackend]: {},
};

const VALID_TRANSITIONS = new Set<string>();
for (const [from, transitions] of Object.entries(STATE_TRANSITIONS)) {
  for (const to of Object.values(transitions)) {
    if (to) {
      VALID_TRANSITIONS.add(`${from}->${to}`);
    }
  }
}

export function isValidTransition(
  from: FallbackState,
  to: FallbackState,
): boolean {
  return VALID_TRANSITIONS.has(`${from}->${to}`);
}

export function transition(
  from: FallbackState,
  to: FallbackState,
): FallbackState {
  if (!isValidTransition(from, to)) {
    throw new Error(`Invalid fallback state transition: ${from} → ${to}`);
  }
  return to;
}

const KNOWN_INVALID_TRANSITIONS: ReadonlyArray<
  readonly [FallbackState, FallbackState, string]
> = [
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

export function getInvalidTransitionMessage(
  from: FallbackState,
  to: FallbackState,
): string | null {
  const entry = KNOWN_INVALID_TRANSITIONS.find(
    ([f, t]) => f === from && t === to,
  );
  return entry?.[2] ?? null;
}

const EVENT_TARGET_STATES: Record<FallbackEvent, FallbackState> = {
  [FallbackEvent.CHECK_WEBGL]: FallbackState.ProbingWebgl,
  [FallbackEvent.START_PROBE_WEBGPU]: FallbackState.ProbingWebgpu,
  [FallbackEvent.RESOLVE_WEBGPU]: FallbackState.RendererReady,
  [FallbackEvent.TIMEOUT_WEBGPU]: FallbackState.RendererTimeout,
  [FallbackEvent.FAIL_BACKEND]: FallbackState.ErrorNoBackend,
  [FallbackEvent.DEGRADE_RENDERER]: FallbackState.RendererDegraded,
  [FallbackEvent.POOL_RENDERER]: FallbackState.PoolingRenderer,
  [FallbackEvent.INIT_AUDIO]: FallbackState.AudioInitializing,
  [FallbackEvent.AUDIO_SUCCESS]: FallbackState.AudioReady,
  [FallbackEvent.AUDIO_FAIL]: FallbackState.ErrorNoAudio,
  [FallbackEvent.COMPLETE]: FallbackState.Ready,
  [FallbackEvent.RESET]: FallbackState.Initial,
};

export function getInvalidTransitionMessageForEvent(
  from: FallbackState,
  event: FallbackEvent,
): string | null {
  const to = EVENT_TARGET_STATES[event];
  if (to) {
    return getInvalidTransitionMessage(from, to);
  }
  return null;
}

export class FallbackStateMachine {
  private currentState: FallbackState;
  private listeners: Set<(state: FallbackState, event: FallbackEvent) => void> =
    new Set();

  constructor(initialState: FallbackState = FallbackState.Initial) {
    this.currentState = initialState;
  }

  getState(): FallbackState {
    return this.currentState;
  }

  transition(event: FallbackEvent): FallbackState {
    const nextState = STATE_TRANSITIONS[this.currentState]?.[event];
    if (!nextState) {
      const reason = getInvalidTransitionMessageForEvent(
        this.currentState,
        event,
      );
      throw new Error(
        `Invalid fallback state transition from ${this.currentState} via event ${event}${
          reason ? `: ${reason}` : ''
        }`,
      );
    }
    this.currentState = nextState;
    for (const listener of this.listeners) {
      try {
        listener(this.currentState, event);
      } catch (err) {
        console.error('Error in state machine listener:', err);
      }
    }
    return this.currentState;
  }

  onTransition(
    listener: (state: FallbackState, event: FallbackEvent) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
