import { afterEach, describe, expect, test } from 'bun:test';
import { act, type RefObject, useEffect, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { useLatestRef } from '../../src/js/frontend/hooks/use-latest-ref.ts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Effects run child-first, so a child's effects fire before its parent's.
 * The render-time write the hook replaces made the parent's newest value
 * visible to those child effects; the hook has to keep that guarantee or a
 * listener installed by a child reads the previous render's value.
 */
function Child({
  latest,
  seen,
}: {
  latest: RefObject<string>;
  seen: { layout: string[]; passive: string[] };
}) {
  useLayoutEffect(() => {
    seen.layout.push(latest.current);
  });
  useEffect(() => {
    seen.passive.push(latest.current);
  });
  return null;
}

function Parent({
  value,
  seen,
}: {
  value: string;
  seen: { layout: string[]; passive: string[] };
}) {
  const latest = useLatestRef(value);
  return <Child latest={latest} seen={seen} />;
}

describe('useLatestRef', () => {
  test("a child's effects read the parent's value from the same render", () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const seen = { layout: [] as string[], passive: [] as string[] };

    act(() => root.render(<Parent value="first" seen={seen} />));
    act(() => root.render(<Parent value="second" seen={seen} />));
    act(() => root.render(<Parent value="third" seen={seen} />));

    expect(seen.layout).toEqual(['first', 'second', 'third']);
    expect(seen.passive).toEqual(['first', 'second', 'third']);
    act(() => root.unmount());
  });
});
