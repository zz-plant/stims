import {
  clearDebugSnapshot,
  isAgentMode,
  setDebugSnapshot,
} from '../core/agent-api.ts';
import {
  createMilkdropPostprocessingComposer,
  type PostprocessingPipeline,
  resolveWebGLRenderer,
  shouldRenderMilkdropPostprocessing,
} from '../core/postprocessing.ts';
import { getCachedRendererCapabilities } from '../core/renderer-capabilities.ts';
import {
  type AdaptiveQualityController,
  type AdaptiveQualityState,
  createAdaptiveQualityController,
} from '../core/services/adaptive-quality-controller.ts';
import { isMilkdropCapturedVideoReady } from '../core/services/captured-video-texture.ts';
import {
  type QualityPreset,
  setQualityPresetById,
} from '../core/settings-panel.ts';
import type { QualityPresetManager } from '../core/toy-quality';
import type { ToyRuntimeFrame, ToyRuntimeInstance } from '../core/toy-runtime';
import { createMilkdropCatalogStore } from './catalog-store';
import { compileMilkdropPresetSource } from './compiler';
import { createMilkdropEditorSession } from './editor-session';
import { MilkdropOverlay } from './overlay';
import { consumeRequestedMilkdropOverlayTab } from './overlay-intent';
import { createMilkdropRendererAdapter } from './renderer-adapter-factory';
import type { MilkdropRendererAdapter } from './renderer-types';
import { createMilkdropBackendFailover } from './runtime/backend-fallback';
import { applyMilkdropCapturedVideoFrameState } from './runtime/captured-video-frame.ts';
import { createMilkdropCapturedVideoOverlay } from './runtime/captured-video-overlay.ts';
import { createMilkdropCapturedVideoReactivityTracker } from './runtime/captured-video-reactivity.ts';
import { createMilkdropCatalogCoordinator } from './runtime/catalog-coordinator';
import { registerAgentMilkdropRuntimeDebugHandle } from './runtime/debug-snapshot';
import { DEFAULT_MILKDROP_PRESET_SOURCE } from './runtime/default-preset';
import { createMilkdropEditorActions } from './runtime/editor-actions';
import { applyMilkdropEnhancedEffectsPolicy } from './runtime/enhanced-effects-policy';
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
import { createMilkdropRuntimeLifetime } from './runtime/lifetime';
import { createMilkdropRuntimePerformanceTracker } from './runtime/performance-tracker';
import { createMilkdropPresentationController } from './runtime/presentation-controller';
import { createMilkdropPresetFileActions } from './runtime/preset-file-actions';
import { createMilkdropPresetNavigationController } from './runtime/preset-navigation-controller';
import { resolvePresetPerformanceOverride } from './runtime/preset-performance-overrides';
import { createMilkdropRuntimePreferences } from './runtime/runtime-preferences';
import { createMilkdropRuntimeSignalHub } from './runtime/runtime-signal-hub';
import { cloneBlendState, estimateFrameBlendWorkload } from './runtime/session';
import { selectMilkdropStartupPreset } from './runtime/startup-selection';
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

export {
  applyMilkdropInteractionResponse,
  buildMilkdropInputSignalOverrides,
  getMilkdropDetailScale,
} from './runtime/interaction-response';

export function createMilkdropExperience({
  container,
  quality,
  qualityControl,
  initialPresetId,
  showOverlayToggle = true,
}: {
  container?: HTMLElement | null;
  quality: QualityPresetManager;
  qualityControl: {
    presets: QualityPreset[];
    storageKey: string;
  };
  initialPresetId?: string;
  showOverlayToggle?: boolean;
}) {
  type MilkdropExperienceSnapshot = {
    activePresetId: string | null;
    backend: 'webgl' | 'webgpu';
    status: string | null;
    adaptiveQuality: AdaptiveQualityState | null;
    catalogEntries: ReturnType<typeof catalogCoordinator.getCatalogEntries>;
    sessionState: ReturnType<typeof session.getState>;
  };

  const catalogStore = createMilkdropCatalogStore();
  const defaultPreset = compileMilkdropPresetSource(
    DEFAULT_MILKDROP_PRESET_SOURCE,
    {
      id: 'signal-bloom',
      title: 'Signal Bloom',
      origin: 'bundled',
      author: 'Stims',
    },
  );
  const preferences = createMilkdropRuntimePreferences();
  const webgpuOptimizationFlags = resolveMilkdropWebGpuOptimizationFlags();
  const disabledWebGpuOptimizationFlags =
    getDisabledMilkdropWebGpuOptimizationFlags(webgpuOptimizationFlags);
  const vm = createMilkdropVM(defaultPreset, webgpuOptimizationFlags);
  const performanceTracker = createMilkdropRuntimePerformanceTracker();
  const signalTracker = createMilkdropSignalTracker();
  const capturedVideoReactivityTracker =
    createMilkdropCapturedVideoReactivityTracker();
  const session = createMilkdropEditorSession({
    initialPreset: defaultPreset.source,
    initialCompiled: defaultPreset,
  });

  let runtime: ToyRuntimeInstance | null = null;
  let adapter: MilkdropRendererAdapter | null = null;
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
  let preferredTransitionMode = preferences.getTransitionMode();
  let transitionMode = preferredTransitionMode;
  let preferredQualityPresetId = quality.activeQuality.id;
  const agentModeEnabled = isAgentMode();
  let lastPresetSwitchAt = performance.now();
  let lastStatusMessage: string | null = null;
  let disposeKeyboardShortcuts: (() => void) | null = null;
  let disposeRequestedPresetListener: (() => void) | null = null;
  let disposeRequestedOverlayTabListener: (() => void) | null = null;
  let lastInspectorOverlaySyncAt = 0;
  let adaptiveQualityController: AdaptiveQualityController | null = null;
  let adaptiveQualityState: AdaptiveQualityState | null = null;
  let adaptiveQualityUnsubscribe: (() => void) | null = null;
  let disposeSessionSubscription: (() => void) | null = null;
  let postprocessingPipeline: PostprocessingPipeline | null = null;
  const mergedSignals: Partial<MilkdropRuntimeSignals> = {};
  const lowQualityPostOverride = {
    shaderEnabled: false,
    videoEchoEnabled: false,
  };
  const lifetime = createMilkdropRuntimeLifetime();
  const capturedVideoOverlay = createMilkdropCapturedVideoOverlay();
  const getQualityPresetById = (presetId: string) =>
    qualityControl.presets.find((preset) => preset.id === presetId) ?? null;

  const setEffectiveTransitionMode = (
    mode: 'blend' | 'cut',
    options: { rememberPreferred?: boolean } = {},
  ) => {
    const { rememberPreferred = true } = options;
    transitionMode = mode;
    overlay?.setTransitionMode(mode);
    if (rememberPreferred) {
      preferredTransitionMode = mode;
      preferences.setTransitionMode(mode);
    }
  };

  const applyQualityPreset = (
    preset: QualityPreset,
    options: { rememberPreferred?: boolean } = {},
  ) => {
    const { rememberPreferred = true } = options;
    quality.applyQualityPreset(preset);
    if (rememberPreferred) {
      preferredQualityPresetId = preset.id;
    }
  };

  const restorePreferredPerformanceState = () => {
    const preferredQualityPreset = getQualityPresetById(
      preferredQualityPresetId,
    );
    if (
      preferredQualityPreset &&
      quality.activeQuality.id !== preferredQualityPreset.id
    ) {
      applyQualityPreset(preferredQualityPreset, {
        rememberPreferred: false,
      });
    }
    setEffectiveTransitionMode(preferredTransitionMode, {
      rememberPreferred: false,
    });
  };

  const applyPresetPerformanceOverride = (presetId: string) => {
    const override = resolvePresetPerformanceOverride(presetId);
    if (!override) {
      restorePreferredPerformanceState();
      return null;
    }

    if (override.qualityPresetId) {
      const preset = getQualityPresetById(override.qualityPresetId);
      if (preset && quality.activeQuality.id !== preset.id) {
        applyQualityPreset(preset, { rememberPreferred: false });
      }
    }

    setEffectiveTransitionMode(
      override.disableBlendTransitions ? 'cut' : preferredTransitionMode,
      { rememberPreferred: false },
    );
    return override;
  };

  const disposePostprocessingPipeline = () => {
    postprocessingPipeline?.dispose();
    postprocessingPipeline = null;
  };

  registerAgentMilkdropRuntimeDebugHandle({
    isAgentMode: () => agentModeEnabled,
    getRuntime: () => runtime,
    getAdapter: () => adapter,
    getState: () => ({
      activePresetId,
      backend: activeBackend,
      status: lastStatusMessage,
    }),
    getAdaptiveQuality: () => adaptiveQualityState,
    getPerformance: () => performanceTracker.getSnapshot(),
  });

  const backendFailover = createMilkdropBackendFailover({
    preferences,
    reload: () => {
      window.location.reload();
    },
  });
  let overlay: MilkdropOverlay | null = null;
  const presentationController = createMilkdropPresentationController({
    getOverlay: () => overlay,
    session,
    vm,
    getAdapter: () => adapter,
    getState: () => ({
      activePresetId,
      compiledPreset: activeCompiled,
      frameState: currentFrameState,
      backend: activeBackend,
      status: lastStatusMessage,
      adaptiveQuality: adaptiveQualityState,
    }),
    getPerformanceMetrics: () => performanceTracker.getSnapshot(),
    setCompiledState: (compiled) => {
      activeCompiled = compiled;
      activePresetId = compiled.source.id;
    },
    isAgentMode: () => agentModeEnabled,
    setDebugSnapshot,
  });

  const updateAgentDebugSnapshot = (force = false) =>
    presentationController.updateAgentDebugSnapshot(force);

  const buildSnapshot = (): MilkdropExperienceSnapshot => ({
    activePresetId,
    backend: activeBackend,
    status: lastStatusMessage,
    adaptiveQuality: adaptiveQualityState,
    catalogEntries: catalogCoordinator.getCatalogEntries(),
    sessionState: session.getState(),
  });

  const runtimeSignalHub = createMilkdropRuntimeSignalHub({
    getSnapshot: buildSnapshot,
    scheduleCatalogSync: () =>
      catalogCoordinator.scheduleCatalogSync({
        activePresetId,
        activeBackend,
      }),
  });
  const {
    emitChange,
    clearDeferredCatalogSync,
    scheduleDeferredCatalogSync,
    subscribe,
    dispose: disposeRuntimeSignalHub,
  } = runtimeSignalHub;

  const setOverlayStatus = (message: string) => {
    lastStatusMessage = message;
    presentationController.setOverlayStatus(message);
    emitChange();
  };
  const getOverlay = () => {
    if (!overlay) {
      throw new Error('Milkdrop overlay is not ready.');
    }
    return overlay;
  };

  const setTransitionMode = (mode: 'blend' | 'cut') => {
    setEffectiveTransitionMode(mode, { rememberPreferred: true });
    emitChange();
  };

  const applyCompiledPreset = (compiled: MilkdropCompiledPreset) =>
    presentationController.applyCompiledPreset(compiled);

  const catalogCoordinator = createMilkdropCatalogCoordinator({
    catalogStore,
    onCatalogChanged(entries, nextActivePresetId, nextActiveBackend) {
      if (!lifetime.isActive() || !overlay) {
        return;
      }
      overlay.setCatalog(entries, nextActivePresetId, nextActiveBackend);
      emitChange();
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
    applyPresetPerformanceOverride,
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
      isOpen: () => getOverlay().isOpen(),
      toggleOpen: (open?: boolean) => getOverlay().toggleOpen(open),
      toggleShortcutHud: (open?: boolean) =>
        getOverlay().toggleShortcutHud(open),
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
        applyQualityPreset(preset);
      },
      onToggleFavorite: async (id, favorite) => {
        await catalogStore.setFavorite(id, favorite);
        await catalogCoordinator.patchCatalogEntry({
          id,
          activePresetId,
          activeBackend,
          update: { isFavorite: favorite },
        });
      },
      onSetRating: async (id, rating) => {
        await catalogStore.setRating(id, rating);
        await catalogCoordinator.patchCatalogEntry({
          id,
          activePresetId,
          activeBackend,
          update: { rating },
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
        const entry = catalogCoordinator.getCatalogEntry(id);
        void catalogStore
          .setFavorite(id, !(entry?.isFavorite ?? false))
          .then(() =>
            catalogCoordinator.patchCatalogEntry({
              id,
              activePresetId,
              activeBackend,
              update: { isFavorite: !(entry?.isFavorite ?? false) },
            }),
          );
      },
      setRating: (id, rating) => {
        void catalogStore.setRating(id, rating).then(() =>
          catalogCoordinator.patchCatalogEntry({
            id,
            activePresetId,
            activeBackend,
            update: { rating },
          }),
        );
      },
    },
  });

  overlay = new MilkdropOverlay({
    host: container ?? document.body,
    callbacks: interactionPresenter.overlayCallbacks,
    showToggle: showOverlayToggle,
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

  const { applyFieldValues, nudgeNumericField, cycleWaveMode } =
    createMilkdropEditorActions({
      session,
      getCompiled: () => session.getState().activeCompiled ?? activeCompiled,
      setOverlayStatus,
    });

  disposeSessionSubscription = session.subscribe((state) => {
    if (!lifetime.isActive() || !overlay) {
      return;
    }
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
      applyPresetPerformanceOverride(nextCompiled.source.id);
      applyCompiledPreset(nextCompiled);
      void catalogStore.saveDraft(nextCompiled.source.id, state.source);
      scheduleDeferredCatalogSync();
    }
    emitChange();
  });

  disposeRequestedPresetListener = installRequestedPresetListener(
    (presetId) => {
      void navigation.selectPreset(presetId);
    },
  );
  disposeRequestedOverlayTabListener = installRequestedOverlayTabListener(
    (tab) => {
      overlay?.openTab(tab);
    },
  );
  const requestedOverlayTab = consumeRequestedMilkdropOverlayTab();
  if (requestedOverlayTab) {
    overlay?.openTab(requestedOverlayTab);
  }
  void (async () => {
    await catalogCoordinator.scheduleCatalogSync({
      activePresetId,
      activeBackend,
    });
    if (!lifetime.isActive() || !overlay) {
      return;
    }
    const { requestedCollectionTag, collectionEntry, startupPresetId } =
      await selectMilkdropStartupPreset({
        catalogCoordinator,
        navigation,
        preferences,
        initialPresetId,
        activeBackend,
      });
    if (!lifetime.isActive() || !overlay) {
      return;
    }
    if (collectionEntry && requestedCollectionTag) {
      overlay.setActiveCollectionTag(requestedCollectionTag);
    }
    if (startupPresetId) {
      await navigation.selectPreset(startupPresetId, {
        recordHistory: false,
      });
      if (!lifetime.isActive()) {
        return;
      }
      if (activePresetId === startupPresetId) {
        return;
      }
    }
  })();

  return {
    subscribe(listener: (snapshot: MilkdropExperienceSnapshot) => void) {
      return subscribe(listener);
    },

    getStateSnapshot() {
      return buildSnapshot();
    },

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

    setActiveCollectionTag(collectionTag: string | null) {
      if (!collectionTag) {
        return;
      }
      overlay?.setActiveCollectionTag(collectionTag);
      emitChange();
    },

    openTab(tab: 'browse' | 'editor' | 'inspector') {
      overlay?.openTab(tab);
      emitChange();
    },

    setOverlayOpen(open: boolean) {
      overlay?.toggleOpen(open);
      emitChange();
    },

    async importPresetFiles(files: FileList) {
      await presetFileActions.importFiles(files);
      emitChange();
    },

    exportPreset() {
      presetFileActions.exportPreset();
    },

    async duplicatePreset() {
      await presetFileActions.duplicatePreset();
      emitChange();
    },

    async deleteActivePreset() {
      await presetFileActions.deleteActivePreset();
      emitChange();
    },

    updateEditorSource(source: string) {
      session.applySource(source);
      emitChange();
    },

    revertEditorSource() {
      session.resetToActive();
      emitChange();
    },

    updateInspectorField(key: string, value: string | number) {
      session.updateField(key, value);
      emitChange();
    },

    setQualityPreset(presetId: string) {
      const preset = setQualityPresetById(presetId, {
        presets: qualityControl.presets,
        storageKey: qualityControl.storageKey,
      });
      if (!preset) {
        return null;
      }
      applyQualityPreset(preset);
      emitChange();
      return preset;
    },

    setStatus(message: string) {
      setOverlayStatus(message);
    },

    attachRuntime(nextRuntime: ToyRuntimeInstance) {
      if (!lifetime.isActive()) {
        return;
      }
      runtime = nextRuntime;
      const attachmentRevision = lifetime.beginAttachment();
      if (!disposeKeyboardShortcuts) {
        disposeKeyboardShortcuts =
          interactionPresenter.installKeyboardShortcuts();
      }
      nextRuntime.toy.rendererReady.then(async (handle) => {
        if (
          !lifetime.isCurrentAttachment(attachmentRevision) ||
          runtime !== nextRuntime
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
                preset: activeCompiled,
                webgpuOptimizationFlags,
              })
            : createMilkdropRendererAdapter({
                scene: nextRuntime.toy.scene,
                camera: nextRuntime.toy.camera,
                renderer: handle?.renderer,
                backend: 'webgl',
                preset: activeCompiled,
                webgpuOptimizationFlags,
              });
        if (
          !lifetime.isCurrentAttachment(attachmentRevision) ||
          runtime !== nextRuntime
        ) {
          nextAdapter.dispose();
          return;
        }
        activeBackend = nextBackend;
        if (typeof document !== 'undefined') {
          document.body.dataset.activeBackend = activeBackend;
        }
        vm.setRenderBackend(activeBackend);
        disposePostprocessingPipeline();
        adapter?.dispose();
        capturedVideoOverlay.attach(nextRuntime.toy.camera);
        adapter = nextAdapter;
        nextAdapter.attach();
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
            nextRuntime.toy.updateRendererSettings({
              adaptiveRenderScaleMultiplier: state.renderScaleMultiplier,
              adaptiveMaxPixelRatioMultiplier: state.maxPixelRatioMultiplier,
              adaptiveDensityMultiplier: state.densityMultiplier,
            });
            adapter?.setAdaptiveQuality?.({
              feedbackResolutionMultiplier: state.feedbackResolutionMultiplier,
            });
            updateAgentDebugSnapshot(true);
          },
        );
        if (shouldFallbackToWebgl(activeCompiled)) {
          triggerWebglFallback({
            presetId: activeCompiled.source.id,
            reason: `${activeCompiled.title} uses preset features the WebGPU runtime does not support yet, so Stims switched to WebGL compatibility mode.`,
          });
          return;
        }
        if (
          !lifetime.isCurrentAttachment(attachmentRevision) ||
          runtime !== nextRuntime
        ) {
          return;
        }
        void catalogCoordinator.scheduleCatalogSync({
          activePresetId,
          activeBackend,
        });
        emitChange();
      });
    },

    update(
      frame: ToyRuntimeFrame,
      options?: {
        signalOverrides?: Partial<MilkdropRuntimeSignals>;
      },
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
      if (options?.signalOverrides) {
        Object.assign(mergedSignals, options.signalOverrides);
      }
      const signals = mergedSignals as MilkdropRuntimeSignals;
      const capturedVideoReactivity = capturedVideoReactivityTracker.update({
        signals,
      });

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
      if (agentModeEnabled) {
        updateAgentDebugSnapshot();
      }
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
          if (!postprocessingPipeline) {
            postprocessingPipeline = createMilkdropPostprocessingComposer({
              renderer: webglRenderer,
              scene: runtime.toy.scene,
              camera: runtime.toy.camera,
              profile,
            });
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
      adaptiveQualityController?.recordFrame({
        frameMs: frameEndAt - frameStartAt,
        phases: {
          simulationMs: renderStartAt - frameStartAt,
          renderMs: frameEndAt - renderStartAt,
        },
      });
      if (
        overlay?.shouldRenderInspectorMetrics() &&
        now - lastInspectorOverlaySyncAt >= 180
      ) {
        lastInspectorOverlaySyncAt = now;
        presentationController.syncInspectorState();
      }
    },

    dispose() {
      lifetime.dispose();
      clearDebugSnapshot('milkdrop');
      disposeSessionSubscription?.();
      disposeSessionSubscription = null;
      overlay?.dispose();
      overlay = null;
      session.dispose();
      clearDeferredCatalogSync();
      capturedVideoReactivityTracker.reset();
      disposePostprocessingPipeline();
      capturedVideoOverlay.dispose();
      adapter?.dispose();
      adapter = null;
      performanceTracker.reset();
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
      disposeRuntimeSignalHub();
    },
  };
}

export const __milkdropRuntimeTestUtils = {
  cloneBlendState,
};
