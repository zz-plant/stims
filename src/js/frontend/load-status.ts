export type StimsLoadPhase =
  | 'app-module'
  | 'shell-rendered'
  | 'starter-catalog'
  | 'full-catalog'
  | 'runtime';

export function reportLoadStatus(phase: StimsLoadPhase) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('stims:load-status', {
      detail: { phase },
    }),
  );
}
