import { scheduleAfterPaint } from '../utils/browser/idle-task.ts';

export type StimsLoadPhase =
  | 'app-module'
  | 'shell-rendered'
  | 'launch-rendered'
  | 'starter-catalog'
  | 'full-catalog'
  | 'runtime';

/** Phases already reported, so a late waiter does not miss one. */
const reached: Partial<Record<StimsLoadPhase, true>> = {};

export function reportLoadStatus(phase: StimsLoadPhase) {
  if (typeof window === 'undefined') return;
  reached[phase] = true;
  window.dispatchEvent(
    new CustomEvent('stims:load-status', {
      detail: { phase },
    }),
  );
}

/**
 * Run `callback` after `phase` has been reported and the browser has painted
 * it, or after `timeoutMs` if the phase never arrives (a lazy chunk that
 * failed to load must not strand whatever waits on it). Returns a cleanup.
 */
export function afterLoadPhasePainted(
  phase: StimsLoadPhase,
  callback: () => void,
  { timeoutMs }: { timeoutMs: number },
): () => void {
  if (typeof window === 'undefined') {
    callback();
    return () => {};
  }
  let cancelPaint: (() => void) | null = null;
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    window.removeEventListener('stims:load-status', onStatus);
    window.clearTimeout(timer);
    cancelPaint = scheduleAfterPaint(callback);
  };
  const onStatus = (event: Event) => {
    if ((event as CustomEvent<{ phase?: string }>).detail?.phase === phase) {
      run();
    }
  };
  const timer = window.setTimeout(run, timeoutMs);
  if (reached[phase]) {
    run();
  } else {
    window.addEventListener('stims:load-status', onStatus);
  }
  return () => {
    done = true;
    window.removeEventListener('stims:load-status', onStatus);
    window.clearTimeout(timer);
    cancelPaint?.();
  };
}
