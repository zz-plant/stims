/**
 * Experience Frame Loop Driver — drives the continuous animation render loop for MilkDrop playback,
 * orchestrating VM simulation steps, GPU phase timings, postprocessing passes, and video capture.
 */

import { isLivePerformanceModeActive } from '../../core/live-performance-mode.ts';
import {
  createMilkdropPostprocessingComposer,
  type PostprocessingPipeline,
  resolveWebGLRenderer,
  shouldRenderMilkdropPostprocessing,
} from '../../core/postprocessing.ts';
import { getPowerSavingFrameCapHz } from '../../core/power-state.ts';
import { isMilkdropCapturedVideoReady } from '../../core/services/captured-video-texture.ts';
import { createGpuRenderTimingSampler } from '../../core/services/gpu-render-timing.ts';
import type {
  ToyRuntimeFrame,
  ToyRuntimeInstance,
} from '../../core/toy-runtime';
import {
  type OutputConversionRenderer,
  renderWithoutOutputConversion,
} from '../output-conversion-passthrough.ts';
import type {
  MilkdropBlendState,
  MilkdropCapturedVideoReactiveState,
  MilkdropFrameState,
  MilkdropRuntimeSignals,
} from '../types';
import type { MilkdropBeatClock } from './beat-clock.ts';
import { applyMilkdropCapturedVideoFrameState } from './captured-video-frame.ts';
import {
  type CapturedVideoSignals,
  updateCapturedVideoReactivityIfReady,
} from './captured-video-reactivity.ts';
import { createMilkdropEnhancedEffectsPolicy } from './enhanced-effects-policy.ts';
import {
  applyMilkdropInteractionResponse,
  buildMilkdropInputSignalOverrides,
  getMilkdropDetailScale,
} from './interaction-response.ts';
import {
  AUTO_ADVANCE_TEMPO_CONFIDENCE,
  createAutoAdvanceGate,
  createRenderFrameStateBuilder,
  shouldAutoAdvancePreset,
  shouldPrepareNextPreset,
} from './lifecycle.ts';
import { estimateFrameBlendWorkload, MAX_BLEND_WORKLOAD } from './session.ts';
import type { MilkdropTraceRecorder } from './trace-recorder.ts';
import type { MilkdropTransitionController } from './transition-controller.ts';

/**
 * Paints the MilkDrop scene straight to the canvas for presets that need no
 * feedback chain. MilkDrop colours are display-referred, so the renderer's
 * output tone mapping and colour encode have to stay off here exactly as they
 * do in the feedback manager's present pass — three's WebGPU renderer applies
 * both to every canvas-target render regardless of material flags.
 */
function renderMilkdropSceneDirect(runtime: {
  toy: { renderer: unknown; render: () => void };
}) {
  renderWithoutOutputConversion(
    runtime.toy.renderer as OutputConversionRenderer | null,
    () => {
      runtime.toy.render();
    },
  );
}

export function createMilkdropExperienceFrameLoop({
  getRuntime,
  getAdapter,
  getActiveBackend,
  setCurrentFrameState,
  transitionController,
  getBlendDuration,
  getTransitionMode,
  getAutoplay,
  getLastPresetSwitchAt,
  updateAgentDebugSnapshot,
  agentModeEnabled,
  quality,
  vm,
  signalTracker,
  capturedVideoReactivityTracker,
  navigation,
  catalogCoordinator,
  performanceTracker,
  getAdaptiveQualityController,
  lowQualityPostOverride,
  mergedSignals,
  getPostprocessingPipeline,
  setPostprocessingPipeline,
  capturedVideoOverlay,
  getFreezeFrame,
  traceRecorder,
  beatClock,
}: {
  getRuntime: () => ToyRuntimeInstance | null;
  getAdapter: () => {
    render: (args: {
      frameState: MilkdropFrameState;
      blendState: MilkdropBlendState | null;
      resetHistory?: boolean;
    }) => boolean;
    setTransitionBlend?: (alpha: number) => void;
    isPresetPresentable?: () => boolean;
  } | null;
  getActiveBackend: () => 'webgl' | 'webgpu';
  setCurrentFrameState: (frameState: MilkdropFrameState | null) => void;
  transitionController: MilkdropTransitionController;
  getBlendDuration: () => number;
  getTransitionMode: () => 'blend' | 'cut';
  getAutoplay: () => boolean;
  getLastPresetSwitchAt: () => number;
  updateAgentDebugSnapshot: (
    force?: boolean,
    renderFrameStateOverride?: MilkdropFrameState | null,
  ) => void;
  agentModeEnabled: boolean;
  quality: {
    activeQuality: {
      id: string;
      particleScale?: number;
    };
  };
  vm: {
    setDetailScale: (value: number) => void;
    step: (signals: MilkdropRuntimeSignals) => MilkdropFrameState;
    /** Re-runs per-frame init and restores base state — see the resetHistory
     * branch in the frame loop. */
    reset: () => void;
  };
  signalTracker: {
    update: (args: {
      time: number;
      deltaMs: number;
      analyser: ToyRuntimeFrame['analyser'];
      frequencyData: Uint8Array;
      waveformData: Uint8Array;
      target?: Partial<MilkdropRuntimeSignals>;
      relationshipLock?: boolean;
      bandOverride?: { bass: number; mid: number; treble: number };
    }) => Partial<MilkdropRuntimeSignals>;
  };
  capturedVideoReactivityTracker: {
    update: (args: {
      signals: CapturedVideoSignals;
    }) => MilkdropCapturedVideoReactiveState;
  };
  navigation: {
    selectRandomPreset: () => Promise<void>;
    prepareNextRandomPreset: () => void;
  };
  catalogCoordinator: {
    getCatalogEntries: () => unknown[];
  };
  performanceTracker: {
    recordFrame: (args: {
      frameMs: number;
      simulationMs: number;
      renderMs: number;
    }) => void;
  };
  getAdaptiveQualityController: () => {
    recordFrame: (args: {
      frameMs: number;
      cadenceMs?: number;
      gpuMs?: number;
      phases: {
        simulationMs: number;
        renderMs: number;
      };
    }) => void;
  } | null;
  lowQualityPostOverride: {
    shaderEnabled: boolean;
    videoEchoEnabled: boolean;
  };
  mergedSignals: Partial<MilkdropRuntimeSignals>;
  getPostprocessingPipeline: () => PostprocessingPipeline | null;
  setPostprocessingPipeline: (pipeline: PostprocessingPipeline | null) => void;
  capturedVideoOverlay: {
    update: (args: {
      camera: ToyRuntimeInstance['toy']['camera'];
      reactivity: MilkdropCapturedVideoReactiveState;
    }) => void;
  };
  getFreezeFrame: () => boolean;
  /** Agent-mode live trace capture; absent outside agent mode. */
  traceRecorder?: MilkdropTraceRecorder | null;
  /** Tempo/bar tracking. Owned by the runtime so its snapshot can publish
   * tempo without reaching into the frame loop. */
  beatClock: MilkdropBeatClock;
}) {
  let blendWorkloadFrameState: MilkdropFrameState | null = null;
  /** True while an autoplay advance is between trigger and transition. */
  let autoAdvanceInFlight = false;
  let consecutiveFrameFailures = 0;
  const autoAdvanceGate = createAutoAdvanceGate();
  const buildRenderFrameState = createRenderFrameStateBuilder();
  const applyMilkdropEnhancedEffectsPolicy =
    createMilkdropEnhancedEffectsPolicy();
  const gpuRenderTimingSampler = createGpuRenderTimingSampler();
  // `signals.beat` is a level, not an edge: it holds at 1 for as long as the
  // tracker considers the frame a beat, so feeding it straight to the clock
  // would count one kick several times and halve the estimated interval.
  let beatWasHigh = false;
  const getCurrentFrameWorkload = () =>
    estimateFrameBlendWorkload(blendWorkloadFrameState);

  const disposePostprocessingPipeline = () => {
    getPostprocessingPipeline()?.dispose();
    setPostprocessingPipeline(null);
  };

  return {
    /** True while an autoplay advance is waiting for a musical landing. */
    isAutoAdvanceArmed: () => autoAdvanceGate.isArmed(),
    update(
      frame: ToyRuntimeFrame,
      options?: {
        signalOverrides?: Partial<MilkdropRuntimeSignals>;
      },
    ) {
      const runtime = getRuntime();
      const adapter = getAdapter();
      if (!runtime || !adapter) {
        return;
      }

      // Hidden tabs skip frames to spare the GPU — with three exceptions:
      // agent mode, where automation (headless capture, browser-pane QA)
      // drives frames deliberately and a silent skip reads as a frozen/black
      // canvas; and an open picture-in-picture window, which is a LIVE
      // `canvas.captureStream()` of the stage (picture-in-picture-service.ts).
      // Switching tabs is precisely when PiP earns its keep, and that is also
      // exactly when `document.hidden` flips — so pausing here froze the one
      // surface the user had deliberately popped out to keep watching. And
      // live performance mode, where this tab is driving a projector: the
      // operator flipping to another tab to line up the next preset must
      // not black out the room.
      if (
        typeof document !== 'undefined' &&
        document.hidden &&
        document.documentElement.dataset.agentMode !== 'true' &&
        !isLivePerformanceModeActive() &&
        document.pictureInPictureElement === null
      ) {
        setCurrentFrameState(null);
        return;
      }

      if (getFreezeFrame()) {
        return;
      }

      // One crashing preset must not leave a frozen canvas: a throw anywhere
      // in the VM step or render path skips the frame, and a sustained
      // failure streak advances to another preset.
      try {
        const now = frame.realTimeMs;
        const frameStartAt = now;
        const activeBackend = getActiveBackend();
        const detailScale = getMilkdropDetailScale({
          backend: activeBackend,
          particleScale: quality.activeQuality.particleScale,
          particleBudget: frame.performance.particleBudget,
          shaderQuality: frame.performance.shaderQuality,
        });
        // Adaptive quality scales the CPU-side detail (mesh/wave/particle) on
        // every backend: the VM transform loop is the same single-threaded
        // cost whether WebGL or WebGPU rasterizes it.
        const adaptiveDensityMultiplier =
          runtime.toy.rendererInfo?.adaptiveDensityMultiplier ?? 1;
        vm.setDetailScale(detailScale * adaptiveDensityMultiplier);
        if (frame.resetHistory) {
          // A deterministic capture asked for a clean start. Clearing the GPU
          // feedback chain alone is not one: the VM's per-frame state — q/t
          // registers, per-frame accumulators, megabuf — carries the previous
          // pump's evolution, so two pumps with identical inputs rendered
          // different pictures. Measured on krash (whose feedback loop
          // amplifies any difference): three consecutive
          // `renderFrames({ startTime: 0 })` pumps came back at mean
          // luminance 2.4, 90.2, 167.9. With the VM re-initialised they
          // repeat exactly. This is also what made capture results bimodal —
          // the transition-settle loop racily pre-pumps frames, so whether
          // the main pump started from a virgin VM was a coin flip.
          vm.reset();
        }
        signalTracker.update({
          time: frame.time,
          deltaMs: frame.deltaMs,
          analyser: frame.analyser,
          frequencyData: frame.frequencyData,
          waveformData: frame.waveformData,
          target: mergedSignals,
          relationshipLock: frame.relationshipLock,
          bandOverride: frame.bandOverride,
        });
        mergedSignals.aspect =
          frame.toy.viewportWidth / Math.max(1, frame.toy.viewportHeight);
        mergedSignals.pixelsx = frame.toy.viewportWidth;
        mergedSignals.pixelsy = frame.toy.viewportHeight;
        buildMilkdropInputSignalOverrides(frame.input, mergedSignals);
        if (options?.signalOverrides) {
          Object.assign(mergedSignals, options.signalOverrides);
        }
        const signals = mergedSignals as MilkdropRuntimeSignals;
        const capturedVideoReady = isMilkdropCapturedVideoReady();
        const capturedVideoReactivity = updateCapturedVideoReactivityIfReady(
          capturedVideoReady,
          capturedVideoReactivityTracker,
          signals,
        );

        const beatIsHigh = (signals.beat ?? 0) >= 1;
        const beatEdge = beatIsHigh && !beatWasHigh;
        beatWasHigh = beatIsHigh;
        if (beatEdge) {
          beatClock.noteBeat(frameStartAt);
        }
        const beatSnapshot = beatClock.snapshot(frameStartAt);

        const autoAdvanceArgs = {
          autoplay: getAutoplay(),
          catalogSize: catalogCoordinator.getCatalogEntries().length,
          now: frameStartAt,
          lastPresetSwitchAt: getLastPresetSwitchAt(),
          blendDuration: getBlendDuration(),
        };
        // The dwell predicate only arms the advance now; the gate decides
        // which frame it actually lands on, so cuts fall on the music.
        const autoAdvanceDue = autoAdvanceGate.update({
          due: shouldAutoAdvancePreset(autoAdvanceArgs),
          now: frameStartAt,
          beat: beatEdge,
          downbeat: beatClock.isDownbeat(),
          tempoConfident:
            beatSnapshot.confidence >= AUTO_ADVANCE_TEMPO_CONFIDENCE,
        });
        if (!autoAdvanceInFlight && autoAdvanceDue) {
          // In-flight latch: lastPresetSwitchAt only moves once the switch
          // reaches beginPresetTransition (after fetch + compile), so without
          // it this branch fired selectRandomPreset on EVERY frame of that
          // window — a stampede of superseded fetch+compiles in which the
          // last random roll won, throwing away the planned, prefetched pick.
          autoAdvanceInFlight = true;
          void navigation
            .selectRandomPreset()
            .catch(() => {})
            .finally(() => {
              autoAdvanceInFlight = false;
            });
        } else if (shouldPrepareNextPreset(autoAdvanceArgs)) {
          // Idempotent: the controller keeps its planned pick until the
          // advance consumes it, so hitting this every frame in the lead
          // window costs two comparisons.
          navigation.prepareNextRandomPreset();
        }

        const rawFrameState = vm.step(signals);
        // Capture before the interaction response: replay re-runs vm.step
        // only, and the response mutates the frame state in place. Gated on
        // isRecording() so agent-mode sessions build this args object only
        // while a capture is actually running, not on every frame it exists.
        if (traceRecorder?.isRecording()) {
          traceRecorder.recordFrame({
            time: frame.time,
            deltaMs: frame.deltaMs,
            frequencyData: frame.frequencyData,
            waveformData: frame.waveformData,
            signals,
            frameState: rawFrameState,
            detailScale: detailScale * adaptiveDensityMultiplier,
          });
        }
        const currentFrameState = applyMilkdropInteractionResponse(
          rawFrameState,
          frame.input,
          activeBackend,
        );
        setCurrentFrameState(currentFrameState);
        blendWorkloadFrameState = currentFrameState;
        // Per-frame gates stay with the caller (they read live quality and
        // workload); the controller owns the clock, so a gated frame
        // suspends the blend instead of letting wall time race past it.
        // A hand-driven crossfade is a gesture the user is actively making,
        // so the transition-mode preference does not gate it — they asked for
        // this fade explicitly. The quality and workload gates still apply:
        // those are about whether the machine can draw two layers right now.
        const canBlendThisFrame =
          (getTransitionMode() === 'blend' ||
            transitionController.getPhase() === 'manual') &&
          frame.performance.shaderQuality !== 'low' &&
          getCurrentFrameWorkload() < MAX_BLEND_WORKLOAD;
        const activeBlendState = transitionController.tick({
          now: frameStartAt,
          canBlendThisFrame,
          presentable: adapter.isPresetPresentable?.() ?? true,
        });

        const renderFrameState = applyMilkdropEnhancedEffectsPolicy({
          frameState: buildRenderFrameState({
            frameState: applyMilkdropCapturedVideoFrameState({
              frameState: currentFrameState,
              capturedVideoReady,
              reactivity: capturedVideoReactivity,
            }),
            shaderQuality: frame.performance.shaderQuality,
            lowQualityPostOverride,
          }),
          shaderQuality: frame.performance.shaderQuality,
          qualityPresetId: quality.activeQuality.id,
        });
        if (agentModeEnabled) {
          updateAgentDebugSnapshot(false, renderFrameState);
        }
        if (capturedVideoReady) {
          capturedVideoOverlay.update({
            camera: runtime.toy.camera,
            reactivity: capturedVideoReactivity,
          });
        }

        const renderStartAt = performance.now();
        if (activeBlendState) {
          adapter.setTransitionBlend?.(activeBlendState.alpha);
        } else {
          adapter.setTransitionBlend?.(0);
        }
        const adapterPresentedFrame = adapter.render({
          frameState: renderFrameState,
          blendState: activeBlendState,
          resetHistory: frame.resetHistory,
        });
        if (!adapterPresentedFrame) {
          if (
            activeBackend === 'webgpu' &&
            renderFrameState.post.shaderEnabled
          ) {
            disposePostprocessingPipeline();
          } else {
            const profile = renderFrameState.post.postprocessingProfile ?? null;
            const webglRenderer = resolveWebGLRenderer(
              activeBackend,
              runtime.toy.renderer,
            );

            if (
              profile &&
              shouldRenderMilkdropPostprocessing({
                backend: activeBackend,
                renderer: runtime.toy.renderer,
                profile,
              }) &&
              webglRenderer
            ) {
              let postprocessingPipeline = getPostprocessingPipeline();
              if (!postprocessingPipeline) {
                postprocessingPipeline = createMilkdropPostprocessingComposer({
                  renderer: webglRenderer,
                  scene: runtime.toy.scene,
                  camera: runtime.toy.camera,
                  profile,
                });
                setPostprocessingPipeline(postprocessingPipeline);
              } else {
                postprocessingPipeline.applyProfile(profile);
              }

              if (postprocessingPipeline) {
                postprocessingPipeline.updateSize();
                postprocessingPipeline.render();
              } else {
                renderMilkdropSceneDirect(runtime);
              }
            } else {
              disposePostprocessingPipeline();
              renderMilkdropSceneDirect(runtime);
            }
          }
        } else {
          disposePostprocessingPipeline();
        }
        const frameEndAt = performance.now();
        performanceTracker.recordFrame({
          frameMs: frameEndAt - frameStartAt,
          simulationMs: renderStartAt - frameStartAt,
          renderMs: frameEndAt - renderStartAt,
        });
        getAdaptiveQualityController()?.recordFrame({
          frameMs: frameEndAt - frameStartAt,
          // Cadence is evidence the GPU is falling behind only when nothing is
          // deliberately slowing it down. Under a power-saver cap the wider
          // gap between frames is the whole point, and reporting it would read
          // as pressure and walk quality down for a problem that isn't there.
          // `frameMs` and the phase timings still measure real work, so genuine
          // overload is still caught.
          cadenceMs:
            getPowerSavingFrameCapHz() === null ? frame.deltaMs : undefined,
          gpuMs: gpuRenderTimingSampler.sample(runtime.toy.renderer),
          phases: {
            simulationMs: renderStartAt - frameStartAt,
            renderMs: frameEndAt - renderStartAt,
          },
        });
        consecutiveFrameFailures = 0;
      } catch (error) {
        consecutiveFrameFailures += 1;
        if (consecutiveFrameFailures === 1) {
          console.warn(
            '[milkdrop] Frame update failed; skipping frame.',
            error,
          );
        }
        if (consecutiveFrameFailures >= 120) {
          consecutiveFrameFailures = 0;
          console.warn(
            '[milkdrop] Preset kept failing; selecting another preset.',
          );
          void navigation.selectRandomPreset();
        }
      }
    },
  };
}
