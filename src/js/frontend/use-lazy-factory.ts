type Factory<T> = () => Promise<T>;
type Cleanup<T> = (instance: T) => void;

export function createLazyFactory<T>({
  name,
  factory,
  getRef,
  setRef,
  getPromiseRef,
  setPromiseRef,
  cleanup,
  isDisposed,
}: {
  name: string;
  factory: Factory<T>;
  getRef: () => T | null;
  setRef: (value: T) => void;
  getPromiseRef: () => Promise<T> | null;
  setPromiseRef: (value: Promise<T> | null) => void;
  cleanup?: Cleanup<T>;
  isDisposed?: () => boolean;
}) {
  return async () => {
    const cached = getRef();
    if (cached) return cached;

    let promise = getPromiseRef();
    if (!promise) {
      promise = factory()
        .then((instance) => {
          if (isDisposed?.()) {
            cleanup?.(instance);
            throw new Error(`${name}: session has been disposed.`);
          }
          setRef(instance);
          return instance;
        })
        .catch((error) => {
          setPromiseRef(null);
          throw error;
        });
      setPromiseRef(promise);
    }

    return promise;
  };
}
