import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';
import {
  getFocusableElements,
  restoreFocusIfPresent,
  trapFocusWithin,
} from '../../core/modal-utils.ts';

export type UseFocusTrapOptions<T extends HTMLElement = HTMLDivElement> = {
  active: boolean;
  autoFocus?: boolean;
  restoreFocusOnUnmount?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  externalContainerRef?: RefObject<T | null>;
  // Non-modal surfaces (stage-anchored panels) keep autofocus and focus
  // restore but must not fence focus in: the stage and its dock stay
  // interactive beside the panel for keyboard users too.
  trapFocus?: boolean;
  /**
   * Where autofocus lands when no `initialFocusRef` is supplied.
   *
   * `'first'` takes the first focusable descendant. For a panel whose header
   * comes first in DOM order that is the close button — so opening a panel
   * lit up its own dismiss control, and a screen reader announced "Close,
   * button" instead of the panel you just asked for.
   *
   * `'container'` focuses the dialog element itself (it must carry
   * `tabIndex={-1}`), which is the standard dialog behaviour: the accessible
   * name is announced, and the first Tab moves into the content rather than
   * out of the close button.
   */
  initialFocus?: 'first' | 'container';
};

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>({
  active,
  autoFocus = true,
  restoreFocusOnUnmount = true,
  initialFocusRef,
  externalContainerRef,
  trapFocus = true,
  initialFocus = 'first',
}: UseFocusTrapOptions<T>): RefObject<T | null> {
  const localContainerRef = useRef<T | null>(null);
  const containerRef = externalContainerRef ?? localContainerRef;
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      previouslyFocusedRef.current = activeElement;
    }

    const container = containerRef.current;
    if (!container) return;

    if (autoFocus) {
      const initialTarget = initialFocusRef?.current;
      if (initialTarget && container.contains(initialTarget)) {
        initialTarget.focus();
      } else if (initialFocus === 'container') {
        container.focus();
      } else {
        const focusables = getFocusableElements(container);
        if (focusables.length > 0) {
          focusables[0].focus();
        } else {
          container.focus();
        }
      }
    }

    const cleanupTrap = trapFocus ? trapFocusWithin(container) : undefined;

    return () => {
      cleanupTrap?.();
      if (restoreFocusOnUnmount) {
        const el = previouslyFocusedRef.current;
        previouslyFocusedRef.current = null;
        if (
          el?.isConnected &&
          !document.activeElement?.closest('[role="dialog"]')
        ) {
          restoreFocusIfPresent(el);
        }
      }
    };
  }, [
    active,
    autoFocus,
    restoreFocusOnUnmount,
    initialFocusRef,
    containerRef,
    trapFocus,
    initialFocus,
  ]);

  return containerRef;
}
