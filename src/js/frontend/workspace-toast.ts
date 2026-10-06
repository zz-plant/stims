import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { resolvePresetId } from '../milkdrop/preset-id-resolution.ts';
import type { SessionRouteState } from './contracts.ts';
import type { EngineSnapshot } from './engine/milkdrop-engine-adapter.ts';

/**
 * How long the toast's exit animation runs, matching `toast-exit` in
 * app-shell.css. The stylesheet has had that keyframe and a reduced-motion
 * variant for a long time, both keyed on `data-exit="true"` — an attribute
 * nothing ever set, so every toast animated in and then vanished between
 * frames.
 */
const TOAST_EXIT_MS = 250;

/**
 * A load with nothing to add: "Loaded <title>." The stage's title card and
 * the dock already show the name, so drawing it a third time was noise. It is
 * still announced, because the title card is hidden from assistive tech and
 * this is the only place a screen reader hears that the preset changed. A
 * load that carries news ("— shader text approximated on WebGPU.") shows.
 */
const PLAIN_PRESET_LOAD = /^Loaded (?:(?! — ).)+\.$/u;

export function useWorkspaceToast({
  engineSnapshot,
  routeState,
  statusMessage,
}: {
  engineSnapshot: EngineSnapshot | null;
  routeState: SessionRouteState;
  statusMessage: string | null;
}) {
  const [toast, setToast] = useState<{
    message: string;
    tone: 'info' | 'warn' | 'error';
    exiting?: boolean;
    quiet?: boolean;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const toastExitTimerRef = useRef<number | null>(null);
  // Two channels feed the one toast: the shell's own status line (a setter
  // handlers call) and the runtime's status (a field on every snapshot).
  // Each is shown when it *changes*, not whenever it is set. The shell's
  // line is sticky — nothing clears it — so the earlier `shell ?? runtime`
  // pick meant one Space press ("Paused…", then "Resumed.") shadowed every
  // runtime line for the rest of the session: no "Loaded <preset>", no
  // blend refusal, no shader-approximation notice. Tracking the last value
  // of each also gives the old guarantee back without a set of seen
  // strings: a snapshot re-run with the same runtime status shows nothing,
  // while pausing twice says "Paused" twice.
  const lastShellMessageRef = useRef<string | null>(statusMessage);
  const lastRuntimeStatusRef = useRef<string | null>(
    engineSnapshot?.status ?? null,
  );

  const clearToastTimer = () => {
    if (toastExitTimerRef.current !== null) {
      window.clearTimeout(toastExitTimerRef.current);
      toastExitTimerRef.current = null;
    }
    if (toastTimerRef.current === null) {
      return;
    }

    window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = null;
  };

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (toastExitTimerRef.current !== null) {
        window.clearTimeout(toastExitTimerRef.current);
      }
    };
  }, []);

  // No boot-time backend toast. WebGL is the designed default on most
  // devices, and announcing it as a warning made an apology the first thing
  // every mobile visitor read — over a stage that hadn't painted yet. The
  // curious can see the backend and the WebGPU fallback reason in
  // Settings → Graphics; mid-session renderer trouble still surfaces through
  // the context-loss toasts below.

  const showToast = useEffectEvent(
    (
      message: string,
      tone: 'info' | 'warn' | 'error' = 'info',
      quiet = false,
    ) => {
      setToast({ message, tone, quiet });
      clearToastTimer();
      // Warn/error toasts carry more important, often longer copy (e.g. an
      // audio source substitution) — give visitors more time to read them.
      const duration = tone === 'info' ? 4200 : 7000;
      toastTimerRef.current = window.setTimeout(() => {
        toastTimerRef.current = null;
        // Mark it exiting, let the animation play, then drop it.
        setToast((current) => (current ? { ...current, exiting: true } : null));
        toastExitTimerRef.current = window.setTimeout(() => {
          toastExitTimerRef.current = null;
          setToast(null);
        }, TOAST_EXIT_MS);
      }, duration);
    },
  );

  // The renderer service (core/services/render-service.ts) has no direct
  // dependency on the frontend layer, so it reports WebGL context loss via a
  // DOM event rather than a callback/prop — same pattern as
  // `stims:load-status`. Without this, a lost context just freezes the
  // canvas with no on-screen explanation.
  useEffect(() => {
    const handleRendererStatus = (event: Event) => {
      const status = (event as CustomEvent<{ status?: string }>).detail?.status;
      if (status === 'context-lost') {
        showToast(
          'Visuals paused — the graphics connection was lost. Reconnecting…',
          'warn',
        );
      } else if (status === 'context-restored') {
        showToast('Visuals reconnected.', 'info');
      } else if (status === 'context-restore-failed') {
        showToast(
          'Could not restore the graphics connection. Reload the page if the visuals stay frozen.',
          'error',
        );
      }
    };
    window.addEventListener('stims:renderer-status', handleRendererStatus);
    return () =>
      window.removeEventListener('stims:renderer-status', handleRendererStatus);
  }, []);

  useEffect(() => {
    const runtimeStatus = engineSnapshot?.status ?? null;
    const shellChanged = statusMessage !== lastShellMessageRef.current;
    const runtimeChanged = runtimeStatus !== lastRuntimeStatusRef.current;
    lastShellMessageRef.current = statusMessage;
    lastRuntimeStatusRef.current = runtimeStatus;
    // Whichever channel spoke wins; a re-run for any other reason (the
    // catalog landing, the route moving) shows nothing.
    const fromShell = shellChanged && statusMessage !== null;
    const message = fromShell
      ? statusMessage
      : runtimeChanged
        ? runtimeStatus
        : null;
    if (!message || message.startsWith('WebGPU rollout flags active:')) {
      return;
    }

    const unresolvedRequestedPreset = routeState.presetId
      ? !resolvePresetId(
          engineSnapshot?.catalogEntries ?? [],
          routeState.presetId,
        )
      : false;
    if (
      unresolvedRequestedPreset &&
      routeState.presetId &&
      message.includes(routeState.presetId)
    ) {
      return;
    }

    const resolvedTone =
      fromShell && /^(Unable to|error|failed|denied|blocked)/i.test(message)
        ? 'error'
        : fromShell &&
            /limit live mic access|Started with Demo Audio/i.test(message)
          ? 'warn'
          : 'info';
    showToast(
      message,
      resolvedTone,
      !fromShell && PLAIN_PRESET_LOAD.test(message),
    );
  }, [
    engineSnapshot?.catalogEntries,
    engineSnapshot?.status,
    routeState.presetId,
    statusMessage,
  ]);

  return {
    clearToastTimer,
    dismissToast: () => {
      clearToastTimer();
      setToast(null);
    },
    toast,
  };
}
