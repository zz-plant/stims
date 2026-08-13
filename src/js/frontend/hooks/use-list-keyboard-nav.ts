// Roving-tabindex arrow-key navigation for button lists/grids that are
// otherwise Tab-only. Without this, reaching the Nth item in a long list
// costs O(N) Tab presses (worse when each row has more than one focusable
// control) — for the browse panel's preset list that's thousands of Tab
// presses at the catalog's full size. With it, Tab into the list costs one
// stop (landing on whichever item is currently "active"), and arrow
// keys/Home/End move within it — the standard pattern for listbox-like
// widgets (file browsers, mail clients, command palettes).
//
// Deliberately NOT a full ARIA listbox/grid implementation: the items stay
// plain <button>s (so click/Enter/Space activation, and any other
// focusable siblings per item like a favorite toggle, keep working exactly
// as before). This only adds an arrow-key fast path on top.

import { type RefObject, useEffect } from 'react';

export type ListKeyboardNavOrientation = 'vertical' | 'horizontal' | 'grid';

export function useListKeyboardNav<T extends HTMLElement>(
  containerRef: RefObject<T | null>,
  options: {
    itemSelector: string;
    orientation: ListKeyboardNavOrientation;
    /** Re-run item discovery when this changes (e.g. filtered list length). */
    deps?: readonly unknown[];
  },
) {
  const { itemSelector, orientation } = options;
  const deps = options.deps ?? [];

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const getItems = () =>
      Array.from(container.querySelectorAll<HTMLElement>(itemSelector));

    const syncTabIndex = (activeEl: HTMLElement, items: HTMLElement[]) => {
      for (const item of items) {
        item.tabIndex = item === activeEl ? 0 : -1;
      }
    };

    // One item must stay tabbable for the list to be Tab-reachable at all.
    // Prefer whichever item focus is already on (e.g. a prior arrow move),
    // else the first item, so re-scans don't fight an in-progress selection.
    const initialItems = getItems();
    if (initialItems.length > 0) {
      const activeElement = document.activeElement;
      const current =
        activeElement instanceof HTMLElement &&
        initialItems.includes(activeElement)
          ? activeElement
          : initialItems[0];
      syncTabIndex(current, initialItems);
    }

    // A row's row-count for grid Up/Down: count leading items that share the
    // first item's offsetTop. Cheap and re-derived per keypress rather than
    // cached, since grid reflow (resize, filter changes) would stale it.
    const computeColumns = (items: HTMLElement[]) => {
      if (items.length < 2) {
        return items.length;
      }
      const firstTop = items[0].offsetTop;
      let columns = 0;
      for (const item of items) {
        if (item.offsetTop !== firstTop) {
          break;
        }
        columns += 1;
      }
      return Math.max(1, columns);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const items = getItems();
      if (items.length === 0) {
        return;
      }
      const currentIndex = items.indexOf(event.target as HTMLElement);
      if (currentIndex === -1) {
        // Focus is on something else inside the container (e.g. a favorite
        // button) — arrow keys fall through to default browser behavior
        // rather than guessing which item "owns" it.
        return;
      }

      let nextIndex = -1;
      switch (event.key) {
        case 'ArrowDown':
          if (orientation === 'vertical') {
            nextIndex = currentIndex + 1;
          } else if (orientation === 'grid') {
            nextIndex = currentIndex + computeColumns(items);
          }
          break;
        case 'ArrowUp':
          if (orientation === 'vertical') {
            nextIndex = currentIndex - 1;
          } else if (orientation === 'grid') {
            nextIndex = currentIndex - computeColumns(items);
          }
          break;
        case 'ArrowRight':
          if (orientation === 'horizontal' || orientation === 'grid') {
            nextIndex = currentIndex + 1;
          }
          break;
        case 'ArrowLeft':
          if (orientation === 'horizontal' || orientation === 'grid') {
            nextIndex = currentIndex - 1;
          }
          break;
        case 'Home':
          nextIndex = 0;
          break;
        case 'End':
          nextIndex = items.length - 1;
          break;
        default:
          return;
      }

      if (nextIndex < 0 || nextIndex >= items.length) {
        return;
      }
      event.preventDefault();
      // Once this key is handled, it must not keep bubbling — verified
      // empirically that without this, something upstream in the panel
      // tree also reacts to the same keydown and moves focus a second
      // time, compounding on top of the move made here (e.g. ArrowDown
      // advancing two items instead of one per press).
      event.stopPropagation();
      const nextItem = items[nextIndex];
      syncTabIndex(nextItem, items);
      nextItem.focus();
      nextItem.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef, itemSelector, orientation, ...deps]);
}
