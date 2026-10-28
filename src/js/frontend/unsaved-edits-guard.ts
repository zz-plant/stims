import { isRendererFallbackReloadInFlight } from '../core/state/renderer-fallback-reload.ts';

/**
 * The browser's leave-page prompt, for editor work a reload would lose:
 * broken text, or a draft whose save is pending or failed (App.tsx decides
 * when that is).
 *
 * @returns the cleanup that removes it.
 */
export function installUnsavedEditsGuard(target: Window) {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    // The WebGL fallback's own reload: the editor's text rides along in the
    // #code= hash the reload keeps, and "Stay" could only strand the visitor on a
    // renderer that cannot draw this preset, behind a prompt with no cause
    // they could see.
    if (isRendererFallbackReloadInFlight()) return;
    event.preventDefault();
    // Browsers show their own copy and ignore any string we return; the
    // assignment is only here because older engines still gate on it.
    event.returnValue = '';
  };
  target.addEventListener('beforeunload', onBeforeUnload);
  return () => target.removeEventListener('beforeunload', onBeforeUnload);
}
