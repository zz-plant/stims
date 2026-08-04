/**
 * Audio lifecycle contract — the single source of truth for the ordering
 * invariants that broke repeatedly in the last 400 commits:
 *
 *  - **Leak** (`e6141ae1`): AudioContext created but never closed on dispose.
 *  - **Permission ordering** (`6eb0e141`): mic permission requested *after*
 *    engine mount instead of *before*, so the first activation failed on
 *    mobile autoplay policy.
 *  - **Race / generation** (`d2fac61b`, `f4861a68`): a mount from a torn-down
 *    React StrictMode generation resolved after the remount and resurrected
 *    a second live renderer that fought the active one for the canvas.
 *
 * This module formalises the three invariants as a state machine + tracker
 * so they can be asserted in tests without a GPU or browser. The existing
 * `registerAudioContext` / `unregisterAudioContext` / `stopAllAudioForBfcache`
 * in `audio-handler.ts` remain the implementation; this contract sits above
 * them and is the only place the *ordering rules* are documented.
 */

export type AudioLifecycleState =
  | 'idle' // no audio source requested yet
  | 'awaiting-gesture' // source requested before a user gesture (autoplay blocked)
  | 'permission-requested' // mic permission prompt is in flight
  | 'context-created' // AudioContext exists and is registered
  | 'active' // audio graph is running, analyser producing data
  | 'draining' // source stopped, context winding down
  | 'disposed'; // context closed, streams stopped, unregistered

export type AudioSourceKind =
  | 'demo'
  | 'microphone'
  | 'tab'
  | 'youtube'
  | 'file';

export const PERMISSION_REQUIRED_SOURCES: ReadonlySet<AudioSourceKind> =
  new Set(['microphone']);

/**
 * Valid transitions. Any transition not listed is a contract violation.
 */
const VALID_TRANSITIONS: Record<
  AudioLifecycleState,
  Set<AudioLifecycleState>
> = {
  idle: new Set([
    'awaiting-gesture',
    'permission-requested',
    'context-created',
  ]),
  'awaiting-gesture': new Set([
    'permission-requested',
    'context-created',
    'disposed',
  ]),
  'permission-requested': new Set(['context-created', 'disposed']),
  'context-created': new Set(['active', 'draining', 'disposed']),
  active: new Set(['draining', 'disposed']),
  draining: new Set(['disposed', 'active']),
  disposed: new Set([]),
};

type LifecycleEvent =
  | { type: 'create-context'; context: AudioContextLike }
  | { type: 'close-context'; context: AudioContextLike }
  | { type: 'request-permission'; source: AudioSourceKind }
  | { type: 'transition'; from: AudioLifecycleState; to: AudioLifecycleState };

export interface AudioContextLike {
  readonly state: string;
  close(): void | Promise<void>;
}

/**
 * Tracks AudioContext and stream lifecycle so tests can assert the three
 * invariants hold. Not a runtime guard — a test-only contract verifier.
 */
export class AudioLifecycleTracker {
  private state: AudioLifecycleState = 'idle';
  private readonly events: LifecycleEvent[] = [];
  private readonly openContexts = new Set<AudioContextLike>();

  getState(): AudioLifecycleState {
    return this.state;
  }

  transition(next: AudioLifecycleState): void {
    if (next === this.state) return;
    const allowed = VALID_TRANSITIONS[this.state];
    if (!allowed.has(next)) {
      throw new Error(
        `AudioLifecycle: invalid transition ${this.state} → ${next}. ` +
          `Valid: ${[...allowed].join(', ') || '(terminal)'}`,
      );
    }
    this.events.push({ type: 'transition', from: this.state, to: next });
    this.state = next;
  }

  trackPermissionRequest(source: AudioSourceKind): void {
    this.events.push({ type: 'request-permission', source });
    if (this.state === 'idle' || this.state === 'awaiting-gesture') {
      this.transition('permission-requested');
    }
  }

  trackContextCreate(
    context: AudioContextLike,
    _source: AudioSourceKind,
  ): void {
    this.openContexts.add(context);
    this.events.push({ type: 'create-context', context });
    if (this.state !== 'active') {
      this.transition('context-created');
    }
  }

  trackContextClose(context: AudioContextLike): void {
    this.openContexts.delete(context);
    this.events.push({ type: 'close-context', context });
  }

  trackActive(): void {
    if (this.state === 'context-created') {
      this.transition('active');
    }
  }

  trackDispose(): void {
    this.transition('disposed');
  }

  /** Invariant A: no leaked AudioContexts — every created context was closed. */
  assertNoLeakedContexts(): void {
    if (this.openContexts.size > 0) {
      throw new Error(
        `AudioLifecycle leak: ${this.openContexts.size} open AudioContext(s) ` +
          `at dispose. Every registerAudioContext() must pair with a close().`,
      );
    }
  }

  /**
   * Invariant B: permission requested before context for mic source.
   * Mobile autoplay + permission gating requires the prompt to start before
   * the AudioContext graph is built, so the first resume() lands inside the
   * gesture that granted the mic.
   */
  assertPermissionBeforeContext(source: AudioSourceKind): void {
    if (!PERMISSION_REQUIRED_SOURCES.has(source)) return;
    const permIndex = this.events.findIndex(
      (e) => e.type === 'request-permission' && e.source === source,
    );
    const ctxIndex = this.events.findIndex((e) => e.type === 'create-context');
    if (ctxIndex !== -1 && (permIndex === -1 || permIndex > ctxIndex)) {
      throw new Error(
        `AudioLifecycle ordering: AudioContext created before permission ` +
          `for "${source}". Request permission first on mobile.`,
      );
    }
  }

  /** Invariant C: a disposed session never transitions back to active. */
  assertTerminalAfterDispose(): void {
    if (this.state !== 'disposed') return;
    const postDispose = this.events.filter(
      (e) =>
        e.type === 'transition' && e.from === 'disposed' && e.to !== 'disposed',
    );
    if (postDispose.length > 0) {
      throw new Error(
        'AudioLifecycle: session transitioned out of disposed — ' +
          'a torn-down generation resurrected audio.',
      );
    }
  }

  getEvents(): readonly LifecycleEvent[] {
    return this.events;
  }
}

/**
 * Invariant C helper for the React layer: returns a generation token that
 * mount promises compare against to detect a superseded session. Mirrors
 * the pattern in `workspace-hooks.ts` `sessionGenerationRef`.
 */
export class AudioGenerationToken {
  private current = 0;

  bump(): number {
    this.current += 1;
    return this.current;
  }

  isCurrent(generation: number): boolean {
    return generation === this.current;
  }

  get value(): number {
    return this.current;
  }
}
