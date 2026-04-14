import { getCachedRendererCapabilities } from '../../core/renderer-capabilities.ts';
import { createAdaptiveQualityController } from '../../core/services/adaptive-quality-controller.ts';
import type { ToyRuntimeInstance } from '../../core/toy-runtime';
import { createMilkdropRendererAdapter } from '../renderer-adapter-factory.ts';
import type { MilkdropRendererAdapter } from '../renderer-types';
import type { MilkdropCompiledPreset } from '../types';
import {
  getDisabledMilkdropWebGpuOptimizationFlags,
  type MilkdropWebGpuOptimizationFlags,
} from '../webgpu-optimization-flags.ts';

export function createMilkdropExperienceAttachmentController({
  lifetime,
  getRuntime,
  setRuntime,
  getAdapter,
  setAdapter,
  activeCompiled,
  setActiveBackend,
  setDocumentActiveBackend,
  vm,
  disposePostprocessingPipeline,
  capturedVideoOverlay,
  createAdaptiveController,
  setAdaptiveQualityController,
  setAdaptiveQualityUnsubscribe,
  setAdaptiveQualityState,
  updateAgentDebugSnapshot,
  shouldFallbackToWebgl,
  triggerWebglFallback,
  scheduleCatalogSync,
  emitChange,
  setOverlayStatus,
  disabledWebGpuOptimizationFlags,
  webgpuOptimizationFlags,
  ensureKeyboardShortcuts,
}: {
  lifetime: {
    isActive: () => boolean;
    beginAttachment: () => number;
    isCurrentAttachment: (revision: number) => boolean;
  };
  getRuntime: () => ToyRuntimeInstance | null;
  setRuntime: (runtime: ToyRuntimeInstance | null) => void;
  getAdapter: () => MilkdropRendererAdapter | null;
  setAdapter: (adapter: MilkdropRendererAdapter | null) => void;
  activeCompiled: () => MilkdropCompiledPreset;
  setActiveBackend: (backend: 'webgl' | 'webgpu') => void;
  setDocumentActiveBackend: (backend: 'webgl' | 'webgpu') => void;
  vm: {
    setRenderBackend: (backend: 'webgl' | 'webgpu') => void;
  };
  disposePostprocessingPipeline: () => void;
  capturedVideoOverlay: {
    attach: (camera: ToyRuntimeInstance['toy']['camera']) => void;
  };
  createAdaptiveController?: typeof createAdaptiveQualityController;
  setAdaptiveQualityController: (
    controller: ReturnType<typeof createAdaptiveQualityController> | null,
  ) => void;
  setAdaptiveQualityUnsubscribe: (unsubscribe: (() => void) | null) => void;
  setAdaptiveQualityState: (state: unknown) => void;
  updateAgentDebugSnapshot: (force?: boolean) => void;
  shouldFallbackToWebgl: (compiled: MilkdropCompiledPreset) => boolean;
  triggerWebglFallback: (args: { presetId: string; reason: string }) => void;
  scheduleCatalogSync: () => void;
  emitChange: () => void;
  setOverlayStatus: (message: string) => void;
  disabledWebGpuOptimizationFlags: string[];
  webgpuOptimizationFlags: MilkdropWebGpuOptimizationFlags;
  ensureKeyboardShortcuts: () => void;
}) {
  const resolveAdaptiveQualityController =
    createAdaptiveController ?? createAdaptiveQualityController;

  return {
    attachRuntime(nextRuntime: ToyRuntimeInstance) {
      if (!lifetime.isActive()) {
        return;
      }
      setRuntime(nextRuntime);
      const attachmentRevision = lifetime.beginAttachment();
      ensureKeyboardShortcuts();
      nextRuntime.toy.rendererReady.then(async (handle) => {
        if (
          !lifetime.isCurrentAttachment(attachmentRevision) ||
          getRuntime() !== nextRuntime
        ) {
          return;
        }
        const nextBackend = handle?.backend === 'webgpu' ? 'webgpu' : 'webgl';
        const nextAdapter =
          nextBackend === 'webgpu'
            ? await createMilkdropRendererAdapter({
                scene: nextRuntime.toy.scene,
                camera: nextRuntime.toy.camera,
                renderer: handle?.renderer,
                backend: 'webgpu',
                preset: activeCompiled(),
                webgpuOptimizationFlags,
              })
            : createMilkdropRendererAdapter({
                scene: nextRuntime.toy.scene,
                camera: nextRuntime.toy.camera,
                renderer: handle?.renderer,
                backend: 'webgl',
                preset: activeCompiled(),
                webgpuOptimizationFlags,
              });
        if (
          !lifetime.isCurrentAttachment(attachmentRevision) ||
          getRuntime() !== nextRuntime
        ) {
          nextAdapter.dispose();
          return;
        }
        setActiveBackend(nextBackend);
        setDocumentActiveBackend(nextBackend);
        vm.setRenderBackend(nextBackend);
        disposePostprocessingPipeline();
        getAdapter()?.dispose();
        capturedVideoOverlay.attach(nextRuntime.toy.camera);
        setAdapter(nextAdapter);
        nextAdapter.attach();
        setAdaptiveQualityUnsubscribe(null);
        const adaptiveQualityController = resolveAdaptiveQualityController({
          backend: nextBackend,
          capabilities:
            nextBackend === 'webgpu'
              ? (getCachedRendererCapabilities()?.webgpu ?? null)
              : null,
        });
        setAdaptiveQualityController(adaptiveQualityController);
        if (
          nextBackend === 'webgpu' &&
          disabledWebGpuOptimizationFlags.length > 0
        ) {
          setOverlayStatus(
            `WebGPU rollout flags active: ${disabledWebGpuOptimizationFlags.join(', ')}.`,
          );
        }
        setAdaptiveQualityUnsubscribe(
          adaptiveQualityController.subscribe((state) => {
            setAdaptiveQualityState(state);
            nextRuntime.toy.updateRendererSettings({
              adaptiveRenderScaleMultiplier: state.renderScaleMultiplier,
              adaptiveMaxPixelRatioMultiplier: state.maxPixelRatioMultiplier,
              adaptiveDensityMultiplier: state.densityMultiplier,
            });
            nextAdapter.setAdaptiveQuality?.({
              feedbackResolutionMultiplier: state.feedbackResolutionMultiplier,
            });
            updateAgentDebugSnapshot(true);
          }),
        );
        if (shouldFallbackToWebgl(activeCompiled())) {
          const compiled = activeCompiled();
          triggerWebglFallback({
            presetId: compiled.source.id,
            reason: `${compiled.title} uses preset features the WebGPU runtime does not support yet, so Stims switched to WebGL compatibility mode.`,
          });
          return;
        }
        if (
          !lifetime.isCurrentAttachment(attachmentRevision) ||
          getRuntime() !== nextRuntime
        ) {
          return;
        }
        scheduleCatalogSync();
        emitChange();
      });
    },
  };
}

export function resolveDisabledWebGpuOptimizationFlags(
  flags: MilkdropWebGpuOptimizationFlags,
) {
  return getDisabledMilkdropWebGpuOptimizationFlags(flags);
}
