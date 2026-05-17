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

const VALID_TRANSITIONS = new Set([
  'initial->probing-webgl',
  'initial->error-no-backend',
  'probing-webgl->probing-webgpu',
  'probing-webgl->error-no-backend',
  'probing-webgpu->renderer-ready',
  'probing-webgpu->renderer-timeout',
  'probing-webgpu->error-no-backend',
  'renderer-timeout->renderer-ready',
  'renderer-timeout->error-no-backend',
  'renderer-ready->renderer-degraded',
  'renderer-ready->renderer-ready',
  'renderer-ready->pooling-renderer',
  'pooling-renderer->renderer-ready',
  'renderer-ready->initial',
  'renderer-ready->audio-initializing',
  'pooling-renderer->audio-initializing',
  'audio-initializing->audio-ready',
  'audio-initializing->error-no-audio',
  'audio-ready->error-no-audio',
  'audio-ready->renderer-degraded',
  'audio-ready->audio-ready',
  'renderer-degraded->renderer-ready',
  'audio-ready->ready',
  'error-no-audio->renderer-ready',
  'error-no-audio->ready',
  'renderer-degraded->pooling-renderer',
  'renderer-degraded->renderer-degraded',
]);

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
