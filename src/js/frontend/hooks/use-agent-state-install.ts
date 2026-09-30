/**
 * The machine-readable surface for automation: `window.__stims_agent`
 * (snapshot, status log, run-palette-action-by-id) and a selector-waitable
 * `data-engine-state` attribute on <body>.
 *
 * Moved out of the app shell unchanged. Everything it reads goes through
 * latest-value refs, so the global installs exactly once; re-installing on
 * each snapshot tore the bridge's listeners down mid-session.
 */
import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { resolvePresetId } from '../../milkdrop/preset-id-resolution.ts';
import { getAgentTelemetry } from '../agent-bridge.ts';
import {
  type AgentCoreSnapshot,
  installAgentStateGlobal,
} from '../agent-state.ts';
import type { CommandAction } from '../command-palette-registry.ts';
import type { EngineSnapshot } from '../engine/engine-snapshot.ts';
import { getAudioEnergy } from '../engine-audio-energy-store.ts';
import type { EngineContextValue } from '../engine-context.tsx';
import { pinTarget, unpinTarget } from '../perform-pins.ts';
import type { WorkspaceContextValue } from '../workspace-context.tsx';

export function useAgentStateInstall({
  paletteActionsRef,
  engineSnapshotRef,
  engineBridgeRef,
  uiRef,
  liveMode,
  engineReady,
}: {
  paletteActionsRef: RefObject<CommandAction[]>;
  engineSnapshotRef: RefObject<EngineSnapshot | null>;
  engineBridgeRef: RefObject<EngineContextValue>;
  uiRef: RefObject<WorkspaceContextValue>;
  liveMode: boolean;
  engineReady: boolean;
}) {
  const liveModeRef = useRef(liveMode);
  liveModeRef.current = liveMode;
  const engineReadyRef = useRef(engineReady);
  engineReadyRef.current = engineReady;
  const buildAgentCoreSnapshot = useCallback((): AgentCoreSnapshot => {
    const snap = engineSnapshotRef.current;
    const live = liveModeRef.current;
    const ready = engineReadyRef.current;
    return {
      engineState: live ? 'live' : ready ? 'ready' : 'booting',
      engineReady: ready,
      liveMode: live,
      backend: snap?.backend ?? null,
      panel: uiRef.current.routeState.panel ?? null,
      presetId: snap?.activePresetId ?? null,
      presetTitle: engineBridgeRef.current.selectedPreset?.title ?? null,
      catalogSize: snap?.catalogEntries.length ?? 0,
      audioSource: snap?.audioSource ?? null,
      playbackPaused: snap?.playbackPaused ?? false,
      audioEnergy: getAudioEnergy(),
      autoplay: snap?.autoplay ?? null,
      transition: {
        mode: snap?.transitionMode ?? null,
        blendDuration: snap?.blendDuration ?? null,
      },
      shaderExecution: snap?.shaderExecution ?? null,
    };
  }, [
    engineSnapshotRef.current,
    uiRef.current.routeState.panel,
    engineBridgeRef.current.selectedPreset?.title,
  ]);

  useEffect(() => {
    return installAgentStateGlobal({
      getActions: () => paletteActionsRef.current,
      getSnapshot: buildAgentCoreSnapshot,
      getTelemetry: getAgentTelemetry,
      selectPreset: (presetId) =>
        engineBridgeRef.current.handlePresetSelection(presetId),
      // Same resolver and catalog the route sync uses, so the agent verb
      // accepts exactly the ids the app would (aliases, slugs) and no others.
      resolvePresetId: (candidate) =>
        resolvePresetId(
          engineSnapshotRef.current?.catalogEntries ?? [],
          candidate,
        ),
      getPresetIds: () =>
        (engineSnapshotRef.current?.catalogEntries ?? []).map(
          (entry) => entry.id,
        ),
      setField: (key, value) =>
        engineBridgeRef.current.updateFieldLive(key, value),
      setCrossfade: (position) =>
        engineBridgeRef.current.setCrossfade(position),
      pinParameter: (field) => pinTarget(field),
      unpinParameter: (field) => unpinTarget(field),
      getStageCanvas: () =>
        uiRef.current.stageRef.current?.querySelector('canvas') ?? null,
    });
  }, [
    buildAgentCoreSnapshot,
    engineBridgeRef.current.setCrossfade,
    paletteActionsRef.current,
    engineBridgeRef.current.updateFieldLive,
    uiRef.current.stageRef.current?.querySelector,
    engineSnapshotRef.current?.catalogEntries,
    engineBridgeRef.current.handlePresetSelection,
  ]);

  useEffect(() => {
    document.body.dataset.engineState = liveMode
      ? 'live'
      : engineReady
        ? 'ready'
        : 'booting';
  }, [liveMode, engineReady]);

  // The shell also emits a commit notification with this snapshot.
  return buildAgentCoreSnapshot;
}
