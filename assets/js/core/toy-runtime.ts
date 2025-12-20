type RuntimeState = 'idle' | 'loading' | 'active' | 'error';

type Toy = {
  slug: string;
  title?: string;
};

type ActiveToyCandidate = { dispose?: () => void } | (() => void);

type RuntimeError =
  | { type: 'capability'; toy?: Toy; options?: Record<string, unknown> }
  | { type: 'import'; toy?: Toy; options?: Record<string, unknown> };

type LoadingEvent = { toy?: Toy; onBack?: () => void };
type ActiveEvent = { toy?: Toy; activeRef?: ActiveToyCandidate | null; container?: HTMLElement | null };
type ErrorEvent = { toy?: Toy; error: RuntimeError };
type DisposedEvent = { reason: 'swap' | 'library' | 'error'; toy?: Toy };

type ListenerPayloads = {
  onLoading: LoadingEvent;
  onActive: ActiveEvent;
  onError: ErrorEvent;
  onDisposed: DisposedEvent;
};

type ListenerMap = {
  [K in keyof ListenerPayloads]: Set<(event: ListenerPayloads[K]) => void>;
};

type ToyRuntime = {
  getState: () => RuntimeState;
  getActiveToy: () => ActiveToyCandidate | null;
  getContainer: () => HTMLElement | null;
  setContainer: (container: HTMLElement | null) => void;
  startLoading: (event: LoadingEvent) => void;
  setActiveToy: (candidate: unknown) => ActiveToyCandidate | null;
  setError: (error: RuntimeError) => void;
  dispose: (event?: { reason?: DisposedEvent['reason'] }) => void;
  onLoading: (listener: (event: LoadingEvent) => void) => () => void;
  onActive: (listener: (event: ActiveEvent) => void) => () => void;
  onError: (listener: (event: ErrorEvent) => void) => () => void;
  onDisposed: (listener: (event: DisposedEvent) => void) => () => void;
};

const globalKey = '__activeWebToy';

const normalizeActiveToy = (
  candidate: unknown
): { ref: ActiveToyCandidate; dispose?: () => void } | null => {
  if (!candidate) return null;

  if (typeof candidate === 'function') {
    return { ref: candidate, dispose: candidate };
  }

  if (typeof candidate === 'object') {
    const dispose = (candidate as { dispose?: unknown }).dispose;
    return {
      ref: candidate as ActiveToyCandidate,
      dispose: typeof dispose === 'function' ? dispose.bind(candidate) : undefined,
    };
  }

  return null;
};

const setGlobalActiveToy = (candidate: ActiveToyCandidate | null) => {
  if (candidate) {
    (globalThis as Record<string, unknown>)[globalKey] = candidate;
  } else {
    delete (globalThis as Record<string, unknown>)[globalKey];
  }
};

export function createToyRuntime(): ToyRuntime {
  let state: RuntimeState = 'idle';
  let activeToy: { ref: ActiveToyCandidate; dispose?: () => void } | null = null;
  let container: HTMLElement | null = null;
  let currentToy: Toy | undefined;
  const listeners: ListenerMap = {
    onLoading: new Set(),
    onActive: new Set(),
    onError: new Set(),
    onDisposed: new Set(),
  };

  const emit = <K extends keyof ListenerMap>(event: K, payload: ListenerPayloads[K]) => {
    listeners[event].forEach((listener) => listener(payload as never));
  };

  const getGlobalActiveToy = () =>
    (globalThis as typeof globalThis & { __activeWebToy?: ActiveToyCandidate }).__activeWebToy;

  const setActiveToy = (candidate: unknown) => {
    const normalized = normalizeActiveToy(candidate ?? getGlobalActiveToy());
    activeToy = normalized;
    setGlobalActiveToy(normalized?.ref ?? null);
    return normalized?.ref ?? null;
  };

  const startLoading = (event: LoadingEvent) => {
    currentToy = event.toy ?? currentToy;
    container = null;
    state = 'loading';
    emit('onLoading', { toy: currentToy, onBack: event.onBack });
  };

  const setError = (error: RuntimeError) => {
    state = 'error';
    emit('onError', { toy: currentToy, error });
  };

  const setContainer = (next: HTMLElement | null) => {
    container = next;
  };

  const dispose = (event: { reason?: DisposedEvent['reason'] } = {}) => {
    const reason = event.reason ?? 'library';
    const current = activeToy ?? normalizeActiveToy(getGlobalActiveToy());

    if (current?.dispose) {
      try {
        current.dispose();
      } catch (error) {
        console.error('Error disposing active toy', error);
      }
    }

    activeToy = null;
    setGlobalActiveToy(null);
    const previousToy = currentToy;
    currentToy = undefined;
    container = null;

    if (state !== 'idle') {
      state = 'idle';
      emit('onDisposed', { reason, toy: previousToy });
    }
  };

  const setActive = (candidate: unknown) => {
    const normalized = setActiveToy(candidate);
    state = 'active';
    emit('onActive', { toy: currentToy, activeRef: normalized, container });
    return normalized;
  };

  const addListener = <K extends keyof ListenerMap>(event: K, listener: (event: ListenerPayloads[K]) => void) => {
    listeners[event].add(listener as never);
    return () => listeners[event].delete(listener as never);
  };

  return {
    getState: () => state,
    getActiveToy: () => activeToy?.ref ?? null,
    getContainer: () => container,
    setContainer,
    startLoading,
    setActiveToy: setActive,
    setError,
    dispose,
    onLoading: (listener) => addListener('onLoading', listener),
    onActive: (listener) => addListener('onActive', listener),
    onError: (listener) => addListener('onError', listener),
    onDisposed: (listener) => addListener('onDisposed', listener),
  };
}
