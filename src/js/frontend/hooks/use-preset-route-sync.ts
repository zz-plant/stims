import {
  type Dispatch,
  type SetStateAction,
  startTransition,
  useEffect,
} from 'react';
import { resolvePresetId } from '../../milkdrop/preset-id-resolution.ts';
import type { SessionRouteState } from '../contracts.ts';
import type { EngineSnapshot } from '../engine/milkdrop-engine-adapter.ts';
import { decideEngineRoutePublish } from '../engine-route-publish.ts';

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
    const snapshot = engineSnapshot;
    if (
      !snapshot?.activePresetId ||
      decideEngineRoutePublish({
        runtimeReady: snapshot.runtimeReady,
        activePresetId: snapshot.activePresetId,
        audioActive: snapshot.audioActive,
        routePresetId: routeState.presetId,
      }) !== 'publish'
    ) {
      return;
    }

    // `activePresetId` is the id of a preset the engine actually compiled and
    // applied (`compiled.source.id`), so it is already canonical. The catalog
    // pass only normalizes it further when an entry exists; falling back to
    // the engine's own id matters because the runtime catalog can legitimately
    // be empty here (it hydrates lazily — a session that never opens Browse
    // keeps `catalogEntries: []`). Requiring a catalog hit meant the URL
    // silently stopped tracking the engine in exactly those sessions, so
    // autoplay advanced the visuals while the address bar stayed on whatever
    // preset the visitor last navigated to — an unshareable, stale link.
    const shareableActivePresetId =
      resolvePresetId(snapshot.catalogEntries, snapshot.activePresetId) ??
      snapshot.activePresetId;

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
  }, [engineSnapshot, routeState.presetId, pendingPresetIdRef, setRouteState]);

  // Resolve preset IDs from engine catalog
  useEffect(() => {
    if (!routeState.presetId || !engineSnapshot?.runtimeReady) {
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
    routeState.presetId,
    setRouteState,
  ]);
}
