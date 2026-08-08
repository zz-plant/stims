type Factory<T> = () => Promise<T>;
type Cleanup<T> = (instance: T) => void;

/**
 * Build an expensive instance at most once per session, tolerating React
 * StrictMode's dev-only mount/unmount/mount and real route churn.
 *
 * The liveness check is *promise identity*, not a boolean flag. A shared
 * `isDisposed()` boolean cannot express what we need: a newer session resets it
 * to `false`, so an in-flight factory belonging to an already-torn-down session
 * sees the new session's liveness and installs itself over the live instance,
 * leaving an orphan that is still mounted and still rendering. Comparing
 * against the promise the session is currently awaiting is immune to that —
 * whoever cleared or replaced `promiseRef` has already disowned this call:
 *
 *  - StrictMode remount joins the same in-flight promise, so `promiseRef` is
 *    unchanged and the instance installs normally (no duplicate work).
 *  - A genuine teardown nulls `promiseRef`, so the instance disposes itself.
 *  - A newer session stores its own promise, so the older one steps aside.
 *
 * `install` runs only after that check passes. Side effects that touch shared
 * refs (subscriptions, registries) belong there rather than in `factory`, so a
 * superseded instance can never clobber the live session's state on its way out.
 */
export function createLazyFactory<T>({
  name,
  factory,
  getRef,
  setRef,
  getPromiseRef,
  setPromiseRef,
  install,
  cleanup,
  isDisposed,
}: {
  name: string;
  factory: Factory<T>;
  getRef: () => T | null;
  setRef: (value: T) => void;
  getPromiseRef: () => Promise<T> | null;
  setPromiseRef: (value: Promise<T> | null) => void;
  install?: (instance: T) => void;
  cleanup?: Cleanup<T>;
  isDisposed?: () => boolean;
}) {
  return async () => {
    const cached = getRef();
    if (cached) return cached;

    let promise = getPromiseRef();
    if (!promise) {
      // Declared before assignment so the continuation can compare against its
      // own promise; `.then` never runs before the assignment completes.
      const created: Promise<T> = factory()
        .then((instance) => {
          if (getPromiseRef() !== created || isDisposed?.()) {
            cleanup?.(instance);
            throw new Error(`${name}: superseded before it could be used.`);
          }
          setRef(instance);
          install?.(instance);
          return instance;
        })
        .catch((error) => {
          // Only disown the slot if it is still ours; a newer session's promise
          // must survive our failure.
          if (getPromiseRef() === created) {
            setPromiseRef(null);
          }
          throw error;
        });
      promise = created;
      setPromiseRef(created);
    }

    return promise;
  };
}
