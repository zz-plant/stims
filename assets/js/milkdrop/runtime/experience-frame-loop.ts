import {
  createMilkdropPostprocessingComposer,
  type PostprocessingPipeline,
  resolveWebGLRenderer,
  shouldRenderMilkdropPostprocessing,
} from '../../core/postprocessing.ts';
import { isMilkdropCapturedVideoReady } from '../../core/services/captured-video-texture.ts';
import type {
  ToyRuntimeFrame,
  ToyRuntimeInstance,
} from '../../core/toy-runtime';
import type {
  MilkdropCapturedVideoReactiveState,
  MilkdropFrameState,
  MilkdropRuntimeSignals,
} from '../types';
import { applyMilkdropCapturedVideoFrameState } from './captured-video-frame.ts';
import { applyMilkdropEnhancedEffectsPolicy } from './enhanced-effects-policy.ts';
import {
  applyMilkdropInteractionResponse,
  buildMilkdropInputSignalOverrides,
  getMilkdropDetailScale,
} from './interaction-response.ts';
import {
  buildBlendStateForRender,
  buildRenderFrameState,
  shouldAutoAdvancePreset,
} from './lifecycle.ts';
import { estimateFrameBlendWorkload } from './session.ts';

export function createMilkdropExperienceFrameLoop({
  getRuntime,
  getAdapter,
  getActiveBackend,
  setCurrentFrameState,
  getBlendState,
  getBlendEndAtMs,
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
  overlay,
  getLastInspectorOverlaySyncAt,
  setLastInspectorOverlaySyncAt,
  presentationController,
  lowQualityPostOverride,
  mergedSignals,
  getPostprocessingPipeline,
  setPostprocessingPipeline,
  capturedVideoOverlay,
}: {
  getRuntime: () => ToyRuntimeInstance | null;
  getAdapter: () => {
    render: (args: {
      frameState: MilkdropFrameState;
      blendState: ReturnType<typeof buildBlendStateForRender>;
    }) => boolean;
  } | null;
  getActiveBackend: () => 'webgl' | 'webgpu';
  setCurrentFrameState: (frameState: MilkdropFrameState | null) => void;
  getBlendState: () => ReturnType<typeof buildBlendStateForRender> | null;
  getBlendEndAtMs: () => number;
  getBlendDuration: () => number;
  getTransitionMode: () => 'blend' | 'cut';
  getAutoplay: () => boolean;
  getLastPresetSwitchAt: () => number;
  updateAgentDebugSnapshot: (force?: boolean) => void;
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
  };
  signalTracker: {
    update: (args: {
      time: number;
      deltaMs: number;
      analyser: ToyRuntimeFrame['analyser'];
      frequencyData: Uint8Array;
      waveformData: Uint8Array;
    }) => Partial<MilkdropRuntimeSignals>;
  };
  capturedVideoReactivityTracker: {
    update: (args: {
      signals: MilkdropRuntimeSignals;
    }) => MilkdropCapturedVideoReactiveState;
  };
  navigation: {
    selectRandomPreset: () => Promise<void>;
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
      phases: {
        simulationMs: number;
        renderMs: number;
      };
    }) => void;
  } | null;
  overlay: {
    shouldRenderInspectorMetrics: () => boolean;
  } | null;
  getLastInspectorOverlaySyncAt: () => number;
  setLastInspectorOverlaySyncAt: (value: number) => void;
  presentationController: {
    syncInspectorState: () => void;
  };
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
}) {
  const disposePostprocessingPipeline = () => {
    getPostprocessingPipeline()?.dispose();
    setPostprocessingPipeline(null);
  };

  return {
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

      const now = performance.now();
      const frameStartAt = now;
      const activeBackend = getActiveBackend();
      const detailScale = getMilkdropDetailScale({
        backend: activeBackend,
        particleScale: quality.activeQuality.particleScale,
        particleBudget: frame.performance.particleBudget,
        shaderQuality: frame.performance.shaderQuality,
      });
      const adaptiveDensityMultiplier =
        activeBackend === 'webgpu'
          ? (runtime.toy.rendererInfo?.adaptiveDensityMultiplier ?? 1)
          : 1;
      vm.setDetailScale(detailScale * adaptiveDensityMultiplier);
      const baseSignals = signalTracker.update({
        time: frame.time,
        deltaMs: frame.deltaMs,
        analyser: frame.analyser,
        frequencyData: frame.frequencyData,
        waveformData: frame.waveformData,
      });
      Object.assign(mergedSignals, baseSignals);
      buildMilkdropInputSignalOverrides(frame.input, mergedSignals);
      if (options?.signalOverrides) {
        Object.assign(mergedSignals, options.signalOverrides);
      }
      const signals = mergedSignals as MilkdropRuntimeSignals;
      const capturedVideoReactivity = capturedVideoReactivityTracker.update({
        signals,
      });

      if (
        shouldAutoAdvancePreset({
          autoplay: getAutoplay(),
          catalogSize: catalogCoordinator.getCatalogEntries().length,
          now,
          lastPresetSwitchAt: getLastPresetSwitchAt(),
          blendDuration: getBlendDuration(),
        })
      ) {
        void navigation.selectRandomPreset();
      }

      const currentFrameState = applyMilkdropInteractionResponse(
        vm.step(signals),
        frame.input,
        activeBackend,
      );
      setCurrentFrameState(currentFrameState);
      if (agentModeEnabled) {
        updateAgentDebugSnapshot();
      }
      const canBlendCurrentFrame =
        estimateFrameBlendWorkload(currentFrameState) < 900;
      const activeBlendState = buildBlendStateForRender({
        transitionMode: getTransitionMode(),
        shaderQuality: frame.performance.shaderQuality,
        canBlendCurrentFrame,
        blendState: getBlendState(),
        now,
        blendEndAtMs: getBlendEndAtMs(),
        blendDuration: getBlendDuration(),
      });

      const renderFrameState = applyMilkdropEnhancedEffectsPolicy({
        frameState: buildRenderFrameState({
          frameState: applyMilkdropCapturedVideoFrameState({
            frameState: currentFrameState,
            capturedVideoReady: isMilkdropCapturedVideoReady(),
            reactivity: capturedVideoReactivity,
          }),
          shaderQuality: frame.performance.shaderQuality,
          lowQualityPostOverride,
        }),
        shaderQuality: frame.performance.shaderQuality,
        qualityPresetId: quality.activeQuality.id,
      });
      capturedVideoOverlay.update({
        camera: runtime.toy.camera,
        reactivity: capturedVideoReactivity,
      });

      const renderStartAt = performance.now();
      const adapterPresentedFrame = adapter.render({
        frameState: renderFrameState,
        blendState: activeBlendState,
      });
      if (!adapterPresentedFrame) {
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
            runtime.toy.render();
          }
        } else {
          disposePostprocessingPipeline();
          runtime.toy.render();
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
        phases: {
          simulationMs: renderStartAt - frameStartAt,
          renderMs: frameEndAt - renderStartAt,
        },
      });
      if (
        overlay?.shouldRenderInspectorMetrics() &&
        now - getLastInspectorOverlaySyncAt() >= 180
      ) {
        setLastInspectorOverlaySyncAt(now);
        presentationController.syncInspectorState();
      }
    },
  };
}
