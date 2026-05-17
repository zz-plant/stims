import {
  type Dispatch,
  type SetStateAction,
  startTransition,
  useEffect,
} from 'react';
import { resolvePresetId } from '../../milkdrop/preset-id-resolution.ts';
import type { SessionRouteState } from '../contracts.ts';
import type { EngineSnapshot } from '../engine/milkdrop-engine-adapter.ts';

export function usePresetRouteSync({
  engineSnapshot,
  pendingPresetIdRef,
  routeState,
  setRouteState,
}: {
  engineSnapshot: EngineSnapshot | null;
  pendingPresetIdRef: { current: string | null };
  routeState: SessionRouteState;
  setRouteState: Dispatch<SetStateAction<SessionRouteState>>;
}) {
  // Sync active preset from engine → URL
  useEffect(() => {
    if (!engineSnapshot?.activePresetId || !engineSnapshot?.runtimeReady) {
      return;
    }

    const shareableActivePresetId = resolvePresetId(
      engineSnapshot.catalogEntries,
      engineSnapshot.activePresetId,
    );
    if (!shareableActivePresetId) {
      return;
    }

    if (pendingPresetIdRef.current) {
      if (shareableActivePresetId === pendingPresetIdRef.current) {
        pendingPresetIdRef.current = null;
      }
      return;
    }

    startTransition(() => {
      setRouteState((current) => {
        if (current.presetId === shareableActivePresetId) {
          return current;
        }
        return { ...current, presetId: shareableActivePresetId };
      });
    });
  }, [
    engineSnapshot?.activePresetId,
    engineSnapshot?.catalogEntries,
    engineSnapshot?.runtimeReady,
    pendingPresetIdRef,
    setRouteState,
  ]);

  // Resolve preset IDs from engine catalog
  useEffect(() => {
    if (
      !routeState.presetId ||
      routeState.invalidExperienceSlug ||
      !engineSnapshot?.runtimeReady
    ) {
      return;
    }

    const resolvedPresetId = resolvePresetId(
      engineSnapshot?.catalogEntries ?? [],
      routeState.presetId,
    );
    if (!resolvedPresetId) {
      return;
    }

    startTransition(() => {
      setRouteState((current) => {
        if (current.presetId === resolvedPresetId) {
          return current;
        }
        return { ...current, presetId: resolvedPresetId };
      });
    });
  }, [
    engineSnapshot?.catalogEntries,
    engineSnapshot?.runtimeReady,
    routeState.invalidExperienceSlug,
    routeState.presetId,
    setRouteState,
  ]);
}
