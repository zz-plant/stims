/**
 * Binds hardware performance input to the engine: physical and virtual (MCP)
 * MIDI, the gamepad source, the live-performance runtime, and the hardware
 * crossfader.
 *
 * Extracted from App.tsx — the wiring is one concern: everything a hardware
 * controller needs to reach the visuals. It lives at the shell level for the
 * app's lifetime (it used to live inside PerformanceHardwareSection, which
 * only stayed mounted while Settings was open — closing Settings silently cut
 * the live wire between a controller and the visuals), but it does not need
 * to be in App.tsx to live that long.
 *
 * Deferred to idle: MIDI init and live performance setup are not needed for
 * first paint and can safely wait until the browser is idle.
 */
import { type RefObject, useEffect } from 'react';
import {
  VIRTUAL_CLAUDE_DEVICE_ID,
  webMidiService,
} from '../../core/services/webmidi-controller.ts';
import { deferToIdle } from '../../utils/browser/idle-task.ts';
import type { EngineSnapshot } from '../engine/engine-snapshot.ts';
import type { EngineContextValue } from '../engine-context.tsx';
import { installLivePerformance } from '../live-performance.ts';
import { watchPerformanceHardware } from '../performance-hardware-connect.ts';
import {
  bindMidiToMilkdropControls,
  createHardwareCrossfader,
  createPerformanceControlApplier,
  learnRangeFor,
} from '../performance-hardware-controls.ts';
import { startQueuedCrossfade } from '../workspace-actions.ts';
import type { WorkspaceContextValue } from '../workspace-context.tsx';

export function usePerformanceHardware({
  engine,
  uiRef,
  engineSnapshotRef,
}: {
  engine: EngineContextValue;
  /** Latest-value refs so the idle-scheduled wiring reads live values. */
  uiRef: RefObject<WorkspaceContextValue>;
  engineSnapshotRef: RefObject<EngineSnapshot | null>;
}): void {
  useEffect(() => {
    return deferToIdle(() => {
      webMidiService.initialize();

      // The live-performance runtime owns `window.__stims_live` (ramps, Strudel
      // patterns, signal measurement) on top of the four controls this effect
      // used to publish inline.
      const uninstallLive =
        typeof window === 'undefined'
          ? () => {}
          : installLivePerformance({
              setTarget: (target, value) => {
                engine.updateInspectorField(target, value);
              },
              injectMidiCC: (cc, value) => {
                webMidiService.injectControlChange(
                  VIRTUAL_CLAUDE_DEVICE_ID,
                  cc,
                  value,
                );
              },
              nextPreset: () => {
                engine.handleShufflePreset();
              },
              previousPreset: () => {
                engine.handlePreviousPreset();
              },
              startStreamAudio: async (stream) => {
                const nextRoute = {
                  ...uiRef.current.routeState,
                  audioSource: 'file' as const,
                };
                uiRef.current.commitRoute(nextRoute);
                await engine.startAudioSource({
                  source: 'file',
                  stream,
                  launchState: nextRoute,
                });
              },
            });

      const crossfader = createHardwareCrossfader({
        getPosition: () => engine.getCrossfade(),
        setPosition: (position) => engine.setCrossfade(position),
        startQueued: () =>
          startQueuedCrossfade({
            queue: uiRef.current.presetQueue,
            startManualCrossfade: () => engine.startManualCrossfade(),
            setRouteState: uiRef.current.setRouteState,
            activePresetId: engineSnapshotRef.current?.activePresetId ?? null,
          }),
        announce: (message) => uiRef.current.setStatusMessage(message),
      });
      const controls = createPerformanceControlApplier({
        setFieldLive: (target, value) => engine.updateFieldLive(target, value),
        commitField: (target, value) =>
          engine.updateInspectorField(target, value),
        crossfade: (position) => crossfader.move(position),
      });
      webMidiService.setLearnRangeResolver(learnRangeFor);
      const unbindMidi = bindMidiToMilkdropControls(
        webMidiService,
        controls.apply,
      );

      // A gamepad drives parameters through the same binding/learn machinery
      // as a MIDI controller — it arrives as the `virtual:gamepad` device, so
      // the line above already handles it once it starts injecting.
      let stopGamepad: (() => void) | null = null;
      void import('../../core/services/gamepad-performance-source.ts').then(
        (mod) => {
          if (!mod.isGamepadPerformanceSupported()) return;
          stopGamepad = mod.startGamepadPerformanceSource(webMidiService);
        },
      );

      // Neither of the two lines above used to say anything, so the only way
      // to find out a controller was live was to move one and watch.
      const stopHardwareWatch = watchPerformanceHardware({
        midi: webMidiService,
        announce: (message) => uiRef.current.setStatusMessage(message),
      });

      return () => {
        uninstallLive();
        unbindMidi();
        controls.dispose();
        webMidiService.setLearnRangeResolver(null);
        stopGamepad?.();
        stopHardwareWatch();
      };
    });
  }, [
    engine,
    uiRef.current.setRouteState,
    uiRef.current.commitRoute,
    uiRef.current.setStatusMessage,
    uiRef.current.routeState,
    uiRef.current.presetQueue,
    engineSnapshotRef.current?.activePresetId,
  ]);
}
