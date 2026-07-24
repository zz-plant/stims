export type DomainStoreSubscriber<T> = (value: T) => void;

export interface DomainStore<T> {
  get(): T;
  set(value: T): void;
  subscribe(subscriber: DomainStoreSubscriber<T>): () => void;
  reset(): void;
}

export function createDomainStore<T>(
  initialValue: T,
  _config?: { storageKey?: string },
): DomainStore<T> {
  const subscribers = new Set<DomainStoreSubscriber<T>>();
  let activeValue: T | null = null;

  function notify(value: T) {
    for (const subscriber of subscribers) {
      subscriber(value);
    }
  }

  return {
    get(): T {
      if (activeValue === null) {
        activeValue = initialValue;
      }
      return activeValue;
    },

    set(value: T) {
      activeValue = value;
      notify(value);
    },

    subscribe(subscriber: DomainStoreSubscriber<T>) {
      subscribers.add(subscriber);
      subscriber(activeValue !== null ? activeValue : initialValue);
      return () => {
        subscribers.delete(subscriber);
      };
    },

    reset() {
      activeValue = null;
      subscribers.clear();
    },
  };
}
