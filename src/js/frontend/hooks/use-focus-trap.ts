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
};

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>({
  active,
  autoFocus = true,
  restoreFocusOnUnmount = true,
  initialFocusRef,
  externalContainerRef,
  trapFocus = true,
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
  ]);

  return containerRef;
}
