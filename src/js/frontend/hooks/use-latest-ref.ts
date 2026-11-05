/**
 * A ref that always holds the latest render's value, for callbacks and
 * listeners that must not re-subscribe when the value changes.
 *
 * The usual spelling, `ref.current = value` in the render body, writes a ref
 * during render, which makes React Compiler skip the whole component (#1540).
 * This writes it in an insertion effect instead. Insertion effects run before
 * every layout and passive effect of the commit, children's included, so an
 * effect or event handler anywhere in the tree still reads the value from the
 * render that produced it. Only code reading `.current` during render would
 * see the previous value, and that is the pattern this exists to remove.
 */
import { type RefObject, useInsertionEffect, useRef } from 'react';

export function useLatestRef<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useInsertionEffect(() => {
    ref.current = value;
  });
  return ref;
}
