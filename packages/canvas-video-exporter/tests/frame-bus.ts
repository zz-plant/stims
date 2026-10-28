/** A frame notification the tests drive by hand, in place of animation frames. */
export function frameBus() {
  const listeners = new Set<() => void>();
  return {
    subscribe: (paint: () => void) => {
      listeners.add(paint);
      return () => {
        listeners.delete(paint);
      };
    },
    frame: () => {
      for (const paint of listeners) paint();
    },
    get listeners() {
      return listeners.size;
    },
  };
}
