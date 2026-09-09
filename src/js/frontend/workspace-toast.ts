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
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const toastExitTimerRef = useRef<number | null>(null);
  const shownToastKeysRef = useRef(new Set<string>());

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
    (message: string, tone: 'info' | 'warn' | 'error' = 'info') => {
      setToast({ message, tone });
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
          'Could not reconnect the graphics context. Reload the page if visuals stay frozen.',
          'error',
        );
      }
    };
    window.addEventListener('stims:renderer-status', handleRendererStatus);
    return () =>
      window.removeEventListener('stims:renderer-status', handleRendererStatus);
  }, []);

  useEffect(() => {
    const runtimeMessage = statusMessage ?? engineSnapshot?.status;
    if (
      !runtimeMessage ||
      runtimeMessage.startsWith('WebGPU rollout flags active:')
    ) {
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
      runtimeMessage.includes(routeState.presetId)
    ) {
      return;
    }

    const resolvedTone =
      statusMessage &&
      /^(Unable to|error|failed|denied|blocked)/i.test(statusMessage)
        ? 'error'
        : statusMessage &&
            /limit live mic access|Started with Demo Audio/i.test(statusMessage)
          ? 'warn'
          : 'info';
    const key = `${resolvedTone}:${runtimeMessage}`;
    if (shownToastKeysRef.current.has(key)) {
      return;
    }

    shownToastKeysRef.current.add(key);
    showToast(runtimeMessage, resolvedTone);
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
