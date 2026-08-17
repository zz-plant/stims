import { flushSync } from 'react-dom';
import { getActiveMotionPreference } from '../core/motion-preferences.ts';

let activeTransition: ViewTransition | null = null;

export function supportsViewTransitions(): boolean {
  return (
    typeof document !== 'undefined' &&
    typeof document.startViewTransition === 'function'
  );
}

/**
 * Whether a view transition should run right now. The View Transitions API
 * and the CSS names are safe across the browser baseline, but the animation
 * is motion and must respect both the OS reduced-motion flag and the app's
 * stored motion preference.
 */
export function isViewTransitionAllowed(): boolean {
  if (!supportsViewTransitions()) {
    return false;
  }
  if (!getActiveMotionPreference().enabled) {
    return false;
  }
  try {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return false;
    }
  } catch {
    // No matchMedia — treat as full motion.
  }
  return true;
}

/**
 * Run `update` inside a view transition when the browser supports it and the
 * user has motion on. Falls back to a plain synchronous update otherwise.
 *
 * The update callback uses flushSync so the DOM change is committed before
 * the browser captures the new snapshot. Nested calls (a second update while
 * a transition is already running) skip the transition and update directly —
 * `startViewTransition` throws on re-entry otherwise.
 */
export function runViewTransition(update: () => void): void {
  if (!isViewTransitionAllowed() || activeTransition) {
    update();
    return;
  }
  const transition = document.startViewTransition(() => {
    flushSync(update);
  });
  activeTransition = transition;
  transition.finished.then(
    () => {
      if (activeTransition === transition) {
        activeTransition = null;
      }
    },
    () => {
      if (activeTransition === transition) {
        activeTransition = null;
      }
    },
  );
}
