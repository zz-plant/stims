type ActiveToyObject = { dispose?: () => void };

export type ActiveToyCandidate = ActiveToyObject | (() => void);

type ActiveToyRecord = { ref: ActiveToyCandidate; dispose?: () => void } | null;

const isActiveToyObject = (candidate: unknown): candidate is ActiveToyObject =>
  typeof candidate === 'object' && candidate !== null;

const isActiveToyCandidate = (
  candidate: unknown,
): candidate is ActiveToyCandidate =>
  typeof candidate === 'function' || isActiveToyObject(candidate);

function normalizeActiveToy(candidate: unknown): ActiveToyRecord {
  if (!candidate) return null;

  if (!isActiveToyCandidate(candidate)) return null;

  if (typeof candidate === 'function') {
    return { ref: candidate, dispose: candidate };
  }

  const dispose = candidate.dispose;
  return {
    ref: candidate,
    dispose: dispose ? dispose.bind(candidate) : undefined,
  };
}

export type ToyLifecycle = {
  getActiveToy: () => ActiveToyRecord;
  adoptActiveToy: (candidate?: unknown) => ActiveToyRecord;
  disposeActiveToy: () => void;
  unregisterActiveToy: (candidate?: unknown) => void;
  attachEscapeHandler: (onBack?: () => void) => void;
  removeEscapeHandler: () => void;
  reset: () => void;
};

export function createToyLifecycle(): ToyLifecycle {
  let activeToy: ActiveToyRecord = null;
  let escapeHandler: ((event: KeyboardEvent) => void) | null = null;

  const getWindow = () => (typeof window === 'undefined' ? null : window);

  const setActiveToy = (candidate?: unknown) => {
    activeToy = normalizeActiveToy(candidate ?? null);
    return activeToy;
  };

  const disposeActiveToy = () => {
    const current = activeToy;
    activeToy = null;

    if (current?.dispose) {
      try {
        current.dispose();
      } catch (error) {
        console.error('Error disposing active toy', error);
      }
    }
  };

  const unregisterActiveToy = (candidate?: unknown) => {
    const normalized = normalizeActiveToy(candidate ?? null);
    if (activeToy && normalized && normalized.ref === activeToy.ref) {
      activeToy = null;
    }
  };

  const attachEscapeHandler = (onBack?: () => void) => {
    const win = getWindow();
    if (!win) return;

    if (escapeHandler) {
      win.removeEventListener('keydown', escapeHandler);
      escapeHandler = null;
    }

    if (!onBack) return;

    escapeHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onBack();
      }
    };

    win.addEventListener('keydown', escapeHandler);
  };

  const removeEscapeHandler = () => {
    const win = getWindow();
    if (escapeHandler && win) {
      win.removeEventListener('keydown', escapeHandler);
    }
    escapeHandler = null;
  };

  return {
    getActiveToy: () => activeToy,
    adoptActiveToy: (candidate?: unknown) =>
      candidate !== undefined ? setActiveToy(candidate) : activeToy,
    disposeActiveToy,
    unregisterActiveToy,
    attachEscapeHandler,
    removeEscapeHandler,
    reset: () => {
      removeEscapeHandler();
      activeToy = null;
    },
  };
}

export const defaultToyLifecycle = createToyLifecycle();
