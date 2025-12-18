type DisposableToy = { dispose?: () => void } | null;

let activeToy: DisposableToy = null;

export function getActiveToy<T extends DisposableToy = DisposableToy>() {
  return activeToy as T;
}

export function setActiveToy<T extends DisposableToy = DisposableToy>(
  nextToy: T,
  { disposeExisting = true }: { disposeExisting?: boolean } = {}
) {
  if (activeToy && disposeExisting && activeToy !== nextToy) {
    try {
      activeToy.dispose?.();
    } catch (error) {
      console.error('Error disposing previous toy during replacement', error);
    }
  }

  activeToy = nextToy ?? null;
  return activeToy;
}

export function disposeActiveToy() {
  if (!activeToy) return;

  try {
    activeToy.dispose?.();
  } catch (error) {
    console.error('Error disposing active toy', error);
  } finally {
    activeToy = null;
  }
}
