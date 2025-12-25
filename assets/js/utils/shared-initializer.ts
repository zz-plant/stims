/**
 * Build a shared initializer that only runs once until reset.
 * Useful for prewarming shared services where multiple consumers
 * may try to start the same work concurrently.
 */
export function createSharedInitializer<T>(initializer: () => T | Promise<T>) {
  let promise: Promise<T> | null = null;

  const run = async () => {
    if (!promise) {
      promise = Promise.resolve()
        .then(initializer)
        .catch((error) => {
          promise = null;
          throw error;
        });
    }
    return promise;
  };

  const reset = () => {
    promise = null;
  };

  return { run, reset } as const;
}
