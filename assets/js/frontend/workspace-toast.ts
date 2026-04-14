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
      routeState.invalidExperienceSlug ||
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
  }, [
    engineSnapshot?.backend,
    engineSnapshot?.runtimeReady,
    routeState.invalidExperienceSlug,
  ]);

  const showToast = useEffectEvent(
    (message: string, tone: 'info' | 'warn' | 'error' = 'info') => {
      setToast({ message, tone });
      clearToastTimer();
      toastTimerRef.current = window.setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, 4200);
    },
  );

  useEffect(() => {
    const runtimeMessage = statusMessage ?? engineSnapshot?.status;
    if (!runtimeMessage) {
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

    const key = `${statusMessage ? 'error' : 'info'}:${runtimeMessage}`;
    if (shownToastKeysRef.current.has(key)) {
      return;
    }

    shownToastKeysRef.current.add(key);
    showToast(runtimeMessage, statusMessage ? 'error' : 'info');
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
