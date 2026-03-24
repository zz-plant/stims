export {
  applyMilkdropInteractionResponse,
  buildMilkdropInputSignalOverrides,
  getMilkdropDetailScale,
} from './runtime/interaction-response';

import {
  clearDebugSnapshot,
  isAgentMode,
  setDebugSnapshot,
} from '../core/agent-api.ts';
import { getCachedRendererCapabilities } from '../core/renderer-capabilities.ts';
import {
  type AdaptiveQualityController,
  type AdaptiveQualityState,
  createAdaptiveQualityController,
} from '../core/services/adaptive-quality-controller.ts';
import {
  type QualityPreset,
  setQualityPresetById,
} from '../core/settings-panel.ts';
import type { ToyRuntimeFrame, ToyRuntimeInstance } from '../core/toy-runtime';
import type { QualityPresetManager } from '../utils/toy-settings';
import { createMilkdropCatalogStore } from './catalog-store';
import { consumeRequestedMilkdropCollectionSelection } from './collection-intent';
import { compileMilkdropPresetSource } from './compiler';
import { createMilkdropEditorSession } from './editor-session';
import { upsertMilkdropFields } from './formatter';
import { MilkdropOverlay } from './overlay';
import { consumeRequestedMilkdropOverlayTab } from './overlay-intent';
import { consumeRequestedMilkdropPresetSelection } from './preset-selection';
import { createMilkdropRendererAdapter } from './renderer-adapter-factory';
import { createMilkdropBackendFailover } from './runtime/backend-fallback';
import { createMilkdropCatalogCoordinator } from './runtime/catalog-coordinator';
import { buildAgentMilkdropDebugSnapshot } from './runtime/debug-snapshot';
import { createMilkdropRuntimeInteractionPresenter } from './runtime/interaction-presenter';
import {
  applyMilkdropInteractionResponse,
  buildMilkdropInputSignalOverrides,
  getMilkdropDetailScale,
} from './runtime/interaction-response';
import {
  buildBlendStateForRender,
  buildRenderFrameState,
  shouldAutoAdvancePreset,
} from './runtime/lifecycle';
import { createMilkdropPresetFileActions } from './runtime/preset-file-actions';
import { createMilkdropPresetNavigationController } from './runtime/preset-navigation-controller';
import { createMilkdropRuntimePreferences } from './runtime/runtime-preferences';
import { cloneBlendState, estimateFrameBlendWorkload } from './runtime/session';
import { resolveStartupPresetId } from './runtime/startup';
import {
  installRequestedOverlayTabListener,
  installRequestedPresetListener,
} from './runtime/ui-bridge';
import { createMilkdropSignalTracker } from './runtime-signals';
import type {
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropRuntimeSignals,
} from './types';
import { createMilkdropVM } from './vm';
import {
  getDisabledMilkdropWebGpuOptimizationFlags,
  resolveMilkdropWebGpuOptimizationFlags,
} from './webgpu-optimization-flags';

const DEFAULT_PRESET_SOURCE = `title=Signal Bloom
author=Stims
description=Curated fallback preset used before the bundled catalog loads.

fRating=4
blend_duration=2.5
fDecay=0.93
zoom=1.02
rot=0.01
warp=0.14
wave_mode=0
wave_scale=1.08
wave_smoothing=0.72
wave_a=0.88
wave_r=0.35
wave_g=0.72
wave_b=1
wave_x=0.5
wave_y=0.52
wave_mystery=0.24
mesh_density=18
mesh_alpha=0.18
mesh_r=0.28
mesh_g=0.52
mesh_b=0.94
bg_r=0.02
bg_g=0.03
bg_b=0.06
bBrighten=1
video_echo_enabled=1
video_echo_alpha=0.18
video_echo_zoom=1.03
ob_size=0.02
ob_r=0.9
ob_g=0.95
ob_b=1
ob_a=0.76
shapecode_0_enabled=1
shapecode_0_sides=6
shapecode_0_x=0.5
shapecode_0_y=0.5
shapecode_0_rad=0.17
shapecode_0_ang=0
shapecode_0_a=0.18
shapecode_0_r=1
shapecode_0_g=0.48
shapecode_0_b=0.84
shapecode_0_border_a=0.9
shapecode_0_border_r=1
shapecode_0_border_g=0.78
shapecode_0_border_b=1
shapecode_0_additive=1
shapecode_0_thickoutline=1
wavecode_0_enabled=1
wavecode_0_samples=72
wavecode_0_spectrum=1
wavecode_0_additive=1
wavecode_0_r=0.92
wavecode_0_g=0.6
wavecode_0_b=1
wavecode_0_a=0.42

per_frame_1=zoom = 1.0 + bass_att * 0.08
per_frame_2=rot = rot + beat_pulse * 0.004
per_frame_3=wave_y = 0.5 + sin(time * 0.35) * 0.08
per_frame_4=shape_1_ang = shape_1_ang + 0.01 + treb_att * 0.01
per_frame_5=ob_size = 0.01 + beat_pulse * 0.02

per_pixel_1=warp = warp + sin(rad * 10 + time * 0.8) * 0.03
wave_0_per_frame1=a = 0.18 + bass_att * 0.36
wave_0_per_point1=y = y + sin(sample * pi * 12 + time) * 0.06
shape_0_per_frame1=rad = 0.14 + beat_pulse * 0.08
`;

export function createMilkdropExperience({
  container,
  quality,
  qualityControl,
  initialPresetId,
}: {
  container?: HTMLElement | null;
  quality: QualityPresetManager;
  qualityControl: {
    presets: QualityPreset[];
    storageKey: string;
  };
  initialPresetId?: string;
}) {
  const catalogStore = createMilkdropCatalogStore();
  const defaultPreset = compileMilkdropPresetSource(DEFAULT_PRESET_SOURCE, {
    id: 'signal-bloom',
    title: 'Signal Bloom',
    origin: 'bundled',
    author: 'Stims',
  });
  const preferences = createMilkdropRuntimePreferences();
  const webgpuOptimizationFlags = resolveMilkdropWebGpuOptimizationFlags();
  const disabledWebGpuOptimizationFlags =
    getDisabledMilkdropWebGpuOptimizationFlags(webgpuOptimizationFlags);
  const vm = createMilkdropVM(defaultPreset, webgpuOptimizationFlags);
  const signalTracker = createMilkdropSignalTracker();
  const session = createMilkdropEditorSession({
    initialPreset: defaultPreset.source,
  });

  let runtime: ToyRuntimeInstance | null = null;
  let adapter: ReturnType<typeof createMilkdropRendererAdapter> | null = null;
  let activeCompiled: MilkdropCompiledPreset = defaultPreset;
  let activePresetId = defaultPreset.source.id;
  let activeBackend: 'webgl' | 'webgpu' = 'webgl';
  let currentFrameState: MilkdropFrameState | null = null;
  let blendState = cloneBlendState(currentFrameState);
  let blendEndAtMs = 0;
  let autoplay = preferences.getAutoplay();
  let blendDuration = preferences.getBlendDuration(
    activeCompiled.ir.numericFields.blend_duration,
  );
  let transitionMode = preferences.getTransitionMode();
  let lastPresetSwitchAt = performance.now();
  let lastStatusMessage: string | null = null;
  let disposeKeyboardShortcuts: (() => void) | null = null;
  let disposeRequestedPresetListener: (() => void) | null = null;
  let disposeRequestedOverlayTabListener: (() => void) | null = null;
  let lastInspectorOverlaySyncAt = 0;
  let adaptiveQualityController: AdaptiveQualityController | null = null;
  let adaptiveQualityState: AdaptiveQualityState | null = null;
  let adaptiveQualityUnsubscribe: (() => void) | null = null;
  const mergedSignals: Partial<MilkdropRuntimeSignals> = {};
  const lowQualityPostOverride = {
    shaderEnabled: false,
    videoEchoEnabled: false,
  };

  const backendFailover = createMilkdropBackendFailover({
    preferences,
    reload: () => {
      window.location.reload();
    },
  });

  const updateAgentDebugSnapshot = () => {
    if (!isAgentMode()) {
      return;
    }
    setDebugSnapshot(
      'milkdrop',
      buildAgentMilkdropDebugSnapshot({
        activePresetId,
        compiledPreset: activeCompiled,
        frameState: currentFrameState,
        status: lastStatusMessage,
        adaptiveQuality: adaptiveQualityState,
      }),
    );
  };

  const setOverlayStatus = (message: string) => {
    lastStatusMessage = message;
    overlay.setStatus(message);
    updateAgentDebugSnapshot();
  };

  const setTransitionMode = (mode: 'blend' | 'cut') => {
    transitionMode = mode;
    overlay.setTransitionMode(mode);
    preferences.setTransitionMode(mode);
  };

  const applyCompiledPreset = (compiled: MilkdropCompiledPreset) => {
    activeCompiled = compiled;
    activePresetId = compiled.source.id;
    vm.setPreset(compiled);
    vm.setRenderBackend(activeBackend);
    adapter?.setPreset(compiled);
    overlay.setCurrentPresetTitle(compiled.title);
    overlay.setSessionState(session.getState());
    overlay.setInspectorState({
      compiled: activeCompiled,
      frameState: currentFrameState,
      backend: activeBackend,
    });
    updateAgentDebugSnapshot();
  };

  const catalogCoordinator = createMilkdropCatalogCoordinator({
    catalogStore,
    onCatalogChanged(entries, nextActivePresetId, nextActiveBackend) {
      overlay.setCatalog(entries, nextActivePresetId, nextActiveBackend);
    },
  });

  const shouldFallbackToWebgl = (compiled: MilkdropCompiledPreset) =>
    backendFailover.shouldFallback({
      compiled,
      activeBackend,
      webgpuOptimizationFlags,
    });

  const triggerWebglFallback = ({
    presetId,
    reason,
  }: {
    presetId: string;
    reason: string;
  }) => {
    backendFailover.trigger({
      presetId,
      reason,
      activeBackend,
    });
  };

  const navigation = createMilkdropPresetNavigationController({
    catalogStore,
    catalogCoordinator,
    session,
    getActivePresetId: () => activePresetId,
    getActiveBackend: () => activeBackend,
    getCurrentFrameState: () => currentFrameState,
    getBlendDuration: () => blendDuration,
    getTransitionMode: () => transitionMode,
    applyCompiledPreset,
    setOverlayStatus,
    shouldFallbackToWebgl,
    triggerWebglFallback,
    rememberLastPreset: (id) => {
      preferences.rememberLastPreset(id);
    },
    preparePresetTransition(nextBlendState) {
      blendState = nextBlendState;
      blendEndAtMs =
        nextBlendState && blendDuration > 0
          ? performance.now() + blendDuration * 1000
          : 0;
    },
    markPresetSwitched() {
      lastPresetSwitchAt = performance.now();
    },
  });

  const presetFileActions = createMilkdropPresetFileActions({
    catalogStore,
    getActiveCatalogEntry: () =>
      catalogCoordinator.getActiveCatalogEntry(activePresetId),
    getActiveCompiled: () =>
      session.getState().activeCompiled ?? activeCompiled,
    scheduleCatalogSync: () =>
      catalogCoordinator.scheduleCatalogSync({
        activePresetId,
        activeBackend,
      }),
    selectPreset: navigation.selectPreset,
  });

  const interactionPresenter = createMilkdropRuntimeInteractionPresenter({
    overlay: {
      isOpen: () => overlay.isOpen(),
      toggleOpen: (open?: boolean) => overlay.toggleOpen(open),
    },
    overlayActions: {
      onSelectPreset: navigation.selectPreset,
      onSelectQualityPreset: (presetId) => {
        const preset = setQualityPresetById(presetId, {
          presets: qualityControl.presets,
          storageKey: qualityControl.storageKey,
        });
        if (!preset) {
          return;
        }
        quality.applyQualityPreset(preset);
      },
      onToggleFavorite: async (id, favorite) => {
        await catalogStore.setFavorite(id, favorite);
        await catalogCoordinator.syncCatalog({
          activePresetId,
          activeBackend,
        });
      },
      onSetRating: async (id, rating) => {
        await catalogStore.setRating(id, rating);
        await catalogCoordinator.syncCatalog({
          activePresetId,
          activeBackend,
        });
      },
      onToggleAutoplay: (enabled) => {
        autoplay = enabled;
        preferences.setAutoplay(enabled);
      },
      onTransitionModeChange: setTransitionMode,
      onGoBackPreset: navigation.goBackPreset,
      onNextPreset: () => navigation.selectAdjacentPreset(1),
      onPreviousPreset: () => navigation.selectAdjacentPreset(-1),
      onRandomize: navigation.selectRandomPreset,
      onBlendDurationChange: (value) => {
        blendDuration = value;
        preferences.setBlendDuration(value);
      },
      onImportFiles: presetFileActions.importFiles,
      onExport: presetFileActions.exportPreset,
      onDuplicatePreset: presetFileActions.duplicatePreset,
      onDeletePreset: presetFileActions.deleteActivePreset,
      onEditorSourceChange: (source) => session.applySource(source),
      onRevertToActive: () => session.resetToActive(),
      onInspectorFieldChange: (key, value) => session.updateField(key, value),
    },
    keybindingActions: {
      getActivePresetId: () => activePresetId,
      getActiveCatalogEntry: () =>
        catalogCoordinator.getActiveCatalogEntry(activePresetId),
      getTransitionMode: () => transitionMode,
      getBlendDuration: () => blendDuration,
      selectAdjacentPreset: (direction) => {
        void navigation.selectAdjacentPreset(direction);
      },
      selectRandomPreset: () => {
        void navigation.selectRandomPreset();
      },
      goBackPreset: () => {
        void navigation.goBackPreset();
      },
      setTransitionMode,
      setOverlayStatus,
      cycleWaveMode: (direction) => {
        void cycleWaveMode(direction);
      },
      nudgeNumericField: (args) => {
        void nudgeNumericField(args);
      },
      toggleFavorite: (id) => {
        const entry = catalogCoordinator.getActiveCatalogEntry(activePresetId);
        void catalogStore
          .setFavorite(id, !(entry?.isFavorite ?? false))
          .then(() =>
            catalogCoordinator.syncCatalog({
              activePresetId,
              activeBackend,
            }),
          );
      },
      setRating: (id, rating) => {
        void catalogStore.setRating(id, rating).then(() =>
          catalogCoordinator.syncCatalog({
            activePresetId,
            activeBackend,
          }),
        );
      },
    },
  });

  const overlay = new MilkdropOverlay({
    host: container ?? document.body,
    callbacks: interactionPresenter.overlayCallbacks,
  });

  overlay.setAutoplay(autoplay);
  overlay.setBlendDuration(blendDuration);
  overlay.setTransitionMode(transitionMode);
  overlay.setQualityPresets({
    presets: qualityControl.presets,
    activePresetId: quality.activeQuality.id,
    storageKey: qualityControl.storageKey,
  });
  overlay.setSessionState(session.getState());
  const fallbackNotice = preferences.consumeFallbackNotice();
  if (fallbackNotice) {
    setOverlayStatus(fallbackNotice);
  }

  const applyFieldValues = async (updates: Record<string, string | number>) => {
    const baseline =
      session.getState().latestCompiled?.formattedSource ??
      session.getState().source;
    return session.applySource(upsertMilkdropFields(baseline, updates));
  };

  const nudgeNumericField = async ({
    key,
    delta,
    min,
    max,
    label,
    digits = 3,
  }: {
    key: string;
    delta: number;
    min: number;
    max: number;
    label: string;
    digits?: number;
  }) => {
    const compiled = session.getState().activeCompiled ?? activeCompiled;
    const current = compiled.ir.numericFields[key] ?? 0;
    const next = Math.min(
      max,
      Math.max(min, Number.parseFloat((current + delta).toFixed(digits))),
    );
    await session.updateField(key, next);
    setOverlayStatus(`${label}: ${next.toFixed(Math.min(digits, 2))}`);
  };

  const cycleWaveMode = async (direction: 1 | -1) => {
    const compiled = session.getState().activeCompiled ?? activeCompiled;
    const current = Math.round(compiled.ir.numericFields.wave_mode ?? 0);
    const next = (((current + direction) % 8) + 8) % 8;
    await session.updateField('wave_mode', next);
    setOverlayStatus(`Wave mode: ${next}`);
  };

  session.subscribe((state) => {
    overlay.setSessionState(state);
    const nextCompiled = state.activeCompiled;
    if (!nextCompiled) {
      return;
    }
    if (shouldFallbackToWebgl(nextCompiled)) {
      triggerWebglFallback({
        presetId: nextCompiled.source.id,
        reason: `${nextCompiled.title} uses preset features the WebGPU runtime does not support yet, so Stims switched to WebGL compatibility mode.`,
      });
      return;
    }
    const didPresetChange =
      nextCompiled.source.id !== activeCompiled.source.id ||
      nextCompiled.formattedSource !== activeCompiled.formattedSource;
    if (didPresetChange) {
      applyCompiledPreset(nextCompiled);
      void catalogStore.saveDraft(nextCompiled.source.id, state.source);
    }
    void catalogCoordinator.scheduleCatalogSync({
      activePresetId,
      activeBackend,
    });
  });

  disposeRequestedPresetListener = installRequestedPresetListener(
    (presetId) => {
      void navigation.selectPreset(presetId);
    },
  );
  disposeRequestedOverlayTabListener = installRequestedOverlayTabListener(
    (tab) => {
      overlay.openTab(tab);
    },
  );
  const requestedOverlayTab = consumeRequestedMilkdropOverlayTab();
  if (requestedOverlayTab) {
    overlay.openTab(requestedOverlayTab);
  }
  void catalogCoordinator
    .scheduleCatalogSync({
      activePresetId,
      activeBackend,
    })
    .then(async () => {
      const requestedCollectionTag =
        consumeRequestedMilkdropCollectionSelection();
      const collectionEntry = requestedCollectionTag
        ? (catalogCoordinator
            .getCatalogEntries()
            .find((entry) => entry.tags.includes(requestedCollectionTag)) ??
          null)
        : null;
      if (collectionEntry && requestedCollectionTag) {
        overlay.setActiveCollectionTag(requestedCollectionTag);
      }
      const requestedPresetId =
        consumeRequestedMilkdropPresetSelection() ?? null;
      const startupPresetId = resolveStartupPresetId({
        requestedPresetId,
        preferredStartupPresetId:
          preferences.getStartupPresetId(initialPresetId) ?? null,
        collectionEntryId: collectionEntry?.id ?? null,
        isBackendSelectable: navigation.isBackendSelectable,
        getFirstSelectablePresetId: navigation.getFirstSelectablePresetId,
        activeBackend,
      });
      if (startupPresetId) {
        await navigation.selectPreset(startupPresetId, {
          recordHistory: false,
        });
        if (activePresetId === startupPresetId) {
          return;
        }
      }
      const firstSelectablePresetId =
        navigation.getFirstSelectablePresetId(activeBackend);
      if (firstSelectablePresetId) {
        await navigation.selectPreset(firstSelectablePresetId, {
          recordHistory: false,
        });
      }
    });

  return {
    applyFields(updates: Record<string, string | number>) {
      return applyFieldValues(updates);
    },

    getActiveCompiledPreset() {
      return activeCompiled;
    },

    getActivePresetId() {
      return activePresetId;
    },

    selectPreset: navigation.selectPreset,

    setStatus(message: string) {
      setOverlayStatus(message);
    },

    attachRuntime(nextRuntime: ToyRuntimeInstance) {
      runtime = nextRuntime;
      if (!disposeKeyboardShortcuts) {
        disposeKeyboardShortcuts =
          interactionPresenter.installKeyboardShortcuts();
      }
      nextRuntime.toy.rendererReady.then((handle) => {
        activeBackend = handle?.backend === 'webgpu' ? 'webgpu' : 'webgl';
        vm.setRenderBackend(activeBackend);
        adapter = createMilkdropRendererAdapter({
          scene: nextRuntime.toy.scene,
          camera: nextRuntime.toy.camera,
          renderer: handle?.renderer,
          backend: activeBackend,
          preset: activeCompiled,
          webgpuOptimizationFlags,
        });
        adapter.attach();
        adaptiveQualityUnsubscribe?.();
        adaptiveQualityUnsubscribe = null;
        adaptiveQualityController = createAdaptiveQualityController({
          backend: activeBackend,
          capabilities:
            activeBackend === 'webgpu'
              ? (getCachedRendererCapabilities()?.webgpu ?? null)
              : null,
        });
        if (
          activeBackend === 'webgpu' &&
          disabledWebGpuOptimizationFlags.length > 0
        ) {
          setOverlayStatus(
            `WebGPU rollout flags active: ${disabledWebGpuOptimizationFlags.join(', ')}.`,
          );
        }
        adaptiveQualityUnsubscribe = adaptiveQualityController.subscribe(
          (state) => {
            adaptiveQualityState = state;
            if (activeBackend !== 'webgpu') {
              updateAgentDebugSnapshot();
              return;
            }
            nextRuntime.toy.updateRendererSettings({
              adaptiveRenderScaleMultiplier: state.renderScaleMultiplier,
              adaptiveMaxPixelRatioMultiplier: state.maxPixelRatioMultiplier,
              adaptiveDensityMultiplier: state.densityMultiplier,
            });
            adapter?.setAdaptiveQuality?.({
              feedbackResolutionMultiplier: state.feedbackResolutionMultiplier,
            });
            updateAgentDebugSnapshot();
          },
        );
        if (shouldFallbackToWebgl(activeCompiled)) {
          triggerWebglFallback({
            presetId: activeCompiled.source.id,
            reason: `${activeCompiled.title} uses preset features the WebGPU runtime does not support yet, so Stims switched to WebGL compatibility mode.`,
          });
          return;
        }
        void catalogCoordinator.scheduleCatalogSync({
          activePresetId,
          activeBackend,
        });
      });
    },

    update(
      frame: ToyRuntimeFrame,
      options: {
        signalOverrides?: Partial<MilkdropRuntimeSignals>;
      } = {},
    ) {
      if (!runtime || !adapter) {
        return;
      }

      const now = performance.now();
      const frameStartAt = now;

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
      if (options.signalOverrides) {
        Object.assign(mergedSignals, options.signalOverrides);
      }
      const signals = mergedSignals as MilkdropRuntimeSignals;

      if (
        shouldAutoAdvancePreset({
          autoplay,
          catalogSize: catalogCoordinator.getCatalogEntries().length,
          now,
          lastPresetSwitchAt,
          blendDuration,
        })
      ) {
        void navigation.selectRandomPreset();
      }

      currentFrameState = applyMilkdropInteractionResponse(
        vm.step(signals),
        frame.input,
        activeBackend,
      );
      updateAgentDebugSnapshot();
      const canBlendCurrentFrame =
        estimateFrameBlendWorkload(currentFrameState) < 900;
      const activeBlendState = buildBlendStateForRender({
        transitionMode,
        shaderQuality: frame.performance.shaderQuality,
        canBlendCurrentFrame,
        blendState,
        now,
        blendEndAtMs,
        blendDuration,
      });

      const renderFrameState = buildRenderFrameState({
        frameState: currentFrameState,
        shaderQuality: frame.performance.shaderQuality,
        lowQualityPostOverride,
      });

      const renderStartAt = performance.now();
      const adapterPresentedFrame = adapter.render({
        frameState: renderFrameState,
        blendState: activeBlendState,
      });
      if (!adapterPresentedFrame) {
        runtime.toy.render();
      }
      const frameEndAt = performance.now();
      adaptiveQualityController?.recordFrame({
        frameMs: frameEndAt - frameStartAt,
        phases: {
          simulationMs: renderStartAt - frameStartAt,
          renderMs: frameEndAt - renderStartAt,
        },
      });
      if (
        overlay.shouldRenderInspectorMetrics() &&
        now - lastInspectorOverlaySyncAt >= 180
      ) {
        lastInspectorOverlaySyncAt = now;
        overlay.setInspectorState({
          compiled: activeCompiled,
          frameState: currentFrameState,
          backend: activeBackend,
        });
      }
    },

    dispose() {
      clearDebugSnapshot('milkdrop');
      overlay.dispose();
      session.dispose();
      adapter?.dispose();
      adapter = null;
      adaptiveQualityUnsubscribe?.();
      adaptiveQualityUnsubscribe = null;
      adaptiveQualityController = null;
      adaptiveQualityState = null;
      runtime = null;
      disposeKeyboardShortcuts?.();
      disposeKeyboardShortcuts = null;
      disposeRequestedPresetListener?.();
      disposeRequestedPresetListener = null;
      disposeRequestedOverlayTabListener?.();
      disposeRequestedOverlayTabListener = null;
      catalogCoordinator.dispose();
    },
  };
}

export const __milkdropRuntimeTestUtils = {
  cloneBlendState,
};
