import { useEffect } from 'react';

/**
 * Marks a horizontal scroller with which side actually has content off-screen.
 *
 * `.ctl-scroller` fades both edges unconditionally, which reads as decoration
 * rather than an affordance: the left edge is faded even when you are already
 * at the start with nothing hidden there, and because the scrollbar is
 * `display: none` the fade is the only signal there is. That matters most on
 * the collection chips, which hide ~900px — over three screens — at phone
 * widths, with no indication any of it exists.
 *
 * Sets `data-overflow` to `none` | `start` | `end` | `both`, which the
 * stylesheet turns into a mask on only the side that has something to reveal.
 *
 * Writes the attribute directly rather than going through state: this runs on
 * every scroll frame, and re-rendering a list of chips per frame to change one
 * attribute is exactly the kind of cost the rest of this panel just shed.
 */
export function useScrollerOverflow(
  ref: { current: HTMLElement | null },
  deps: unknown[] = [],
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `deps` is the caller's own re-measure trigger (chip count, catalog load); ref identity is stable
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const update = () => {
      // 1px slack: fractional layout widths otherwise leave a permanent
      // "end" state on a scroller that is not actually overflowing.
      const maxScroll = node.scrollWidth - node.clientWidth;
      if (maxScroll <= 1) {
        node.dataset.overflow = 'none';
        return;
      }
      const atStart = node.scrollLeft <= 1;
      const atEnd = node.scrollLeft >= maxScroll - 1;
      node.dataset.overflow = atStart ? 'end' : atEnd ? 'start' : 'both';
    };

    update();
    node.addEventListener('scroll', update, { passive: true });

    // Content can change width without the element resizing (chips arriving
    // with the catalog), so observe the element itself for both cases.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(node);

    return () => {
      node.removeEventListener('scroll', update);
      observer?.disconnect();
    };
    // Spread into a literal so the dependency check can see the array;
    // callers name whatever changes their own content width.
  }, [...deps]);
}
