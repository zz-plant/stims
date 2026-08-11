import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { resolvePresetId } from '../milkdrop/preset-id-resolution.ts';
import type { SessionRouteState } from './contracts.ts';
import type { EngineSnapshot } from './engine/milkdrop-engine-adapter.ts';

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
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const webglWarningShownRef = useRef(false);
  const shownToastKeysRef = useRef(new Set<string>());

  const clearToastTimer = () => {
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
    };
  }, []);

  useEffect(() => {
    if (
      !engineSnapshot?.runtimeReady ||
      engineSnapshot.backend !== 'webgl' ||
      webglWarningShownRef.current
    ) {
      return;
    }

    webglWarningShownRef.current = true;
    setToast({ message: 'Using lighter visual mode.', tone: 'warn' });
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 4200);
  }, [engineSnapshot?.backend, engineSnapshot?.runtimeReady]);

  const showToast = useEffectEvent(
    (message: string, tone: 'info' | 'warn' | 'error' = 'info') => {
      setToast({ message, tone });
      clearToastTimer();
      // Warn/error toasts carry more important, often longer copy (e.g. an
      // audio source substitution) — give visitors more time to read them.
      const duration = tone === 'info' ? 4200 : 7000;
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
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
