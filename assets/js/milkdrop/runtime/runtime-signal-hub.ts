export function createMilkdropRuntimeSignalHub<TSnapshot>({
  getSnapshot,
  scheduleCatalogSync,
}: {
  getSnapshot: () => TSnapshot;
  scheduleCatalogSync: () => Promise<unknown> | undefined;
}) {
  let deferredCatalogSyncTimeoutId: number | null = null;
  const subscribers = new Set<(snapshot: TSnapshot) => void>();

  const emitChange = () => {
    const snapshot = getSnapshot();
    subscribers.forEach((subscriber) => subscriber(snapshot));
  };

  const clearDeferredCatalogSync = () => {
    if (deferredCatalogSyncTimeoutId === null) {
      return;
    }
    window.clearTimeout(deferredCatalogSyncTimeoutId);
    deferredCatalogSyncTimeoutId = null;
  };

  const scheduleDeferredCatalogSync = (delayMs = 180) => {
    clearDeferredCatalogSync();
    deferredCatalogSyncTimeoutId = window.setTimeout(() => {
      deferredCatalogSyncTimeoutId = null;
      void scheduleCatalogSync();
    }, delayMs);
  };

  const subscribe = (listener: (snapshot: TSnapshot) => void) => {
    subscribers.add(listener);
    listener(getSnapshot());
    return () => {
      subscribers.delete(listener);
    };
  };

  const dispose = () => {
    clearDeferredCatalogSync();
    subscribers.clear();
  };

  return {
    emitChange,
    clearDeferredCatalogSync,
    scheduleDeferredCatalogSync,
    subscribe,
    dispose,
  };
}
