import { isAgentMode, setDebugSnapshot } from '../core/agent-api.ts';
import { createLogger } from '../core/logger.ts';
import type { PostprocessingPipeline } from '../core/postprocessing.ts';
import type {
  AdaptiveQualityController,
  AdaptiveQualityState,
} from '../core/services/adaptive-quality-controller.ts';
import {
  type QualityPreset,
  setQualityPresetById,
} from '../core/settings-panel.ts';
import { createStatsOverlay } from '../core/stats-overlay.ts';
import type { QualityPresetManager } from '../core/toy-quality';
import { createRendererQualityManager } from '../core/toy-quality.ts';
import type { ToyRuntimeInstance } from '../core/toy-runtime';
import { createToyRuntimeStarter } from '../core/toy-runtime-starter.ts';
import { createMilkdropCatalogStore } from './catalog-store';
import { compileMilkdropPresetSource } from './compiler';
import { createMilkdropEditorSession } from './editor-session';
import { MilkdropOverlay } from './overlay';
import { consumeRequestedMilkdropOverlayTab } from './overlay-intent';
import type { MilkdropPresetRenderPreview } from './preset-preview.ts';
import type { MilkdropRendererAdapter } from './renderer-types';
import { createMilkdropBackendFailover } from './runtime/backend-fallback';
import { createMilkdropCapturedVideoOverlay } from './runtime/captured-video-overlay.ts';
import { createMilkdropCapturedVideoReactivityTracker } from './runtime/captured-video-reactivity.ts';
import { createMilkdropCatalogActions } from './runtime/catalog-actions.ts';
import { createMilkdropCatalogCoordinator } from './runtime/catalog-coordinator';
import { registerAgentMilkdropRuntimeDebugHandle } from './runtime/debug-snapshot';
import { DEFAULT_MILKDROP_PRESET_SOURCE } from './runtime/default-preset';
import { createMilkdropEditorActions } from './runtime/editor-actions';
import { createMilkdropExperienceAttachmentController } from './runtime/experience-attachment.ts';
import { createMilkdropExperienceFrameLoop } from './runtime/experience-frame-loop.ts';
import { createMilkdropRuntimeInteractionPresenter } from './runtime/interaction-presenter';
import {
  applyMilkdropInteractionResponse as applyMilkdropInteractionResponseImpl,
  buildMilkdropInputSignalOverrides as buildMilkdropInputSignalOverridesImpl,
  getMilkdropDetailScale as getMilkdropDetailScaleImpl,
} from './runtime/interaction-response';
import { createMilkdropRuntimeLifetime } from './runtime/lifetime';
import { createMilkdropRuntimePerformanceTracker } from './runtime/performance-tracker';
import { createMilkdropPresentationController } from './runtime/presentation-controller';
import { createMilkdropPresetFileActions } from './runtime/preset-file-actions';
import { createMilkdropPresetNavigationController } from './runtime/preset-navigation-controller';
import { resolvePresetPerformanceOverride } from './runtime/preset-performance-overrides';
import { createMilkdropPresetPreviewService } from './runtime/preset-preview-service.ts';
import { createMilkdropRuntimePreferences } from './runtime/runtime-preferences';
import { createMilkdropRuntimeSignalHub } from './runtime/runtime-signal-hub';
import { cloneBlendState } from './runtime/session';
import { shouldDeferStartupPresetFallback } from './runtime/startup.ts';
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

const log = createLogger('MilkdropRuntime');

export const applyMilkdropInteractionResponse =
  applyMilkdropInteractionResponseImpl;
export const buildMilkdropInputSignalOverrides =
  buildMilkdropInputSignalOverridesImpl;
export const getMilkdropDetailScale = getMilkdropDetailScaleImpl;

export function createMilkdropExperience({
  container,
  quality,
  qualityControl,
  initialPresetId,
  _showOverlayToggle = true,
  enableOverlay = true,
  previewMode = false,
}: {
  container?: HTMLElement | null;
  quality: QualityPresetManager;
  qualityControl: {
    presets: QualityPreset[];
    storageKey: string;
  };
  initialPresetId?: string;
  _showOverlayToggle?: boolean;
  enableOverlay?: boolean;
  previewMode?: boolean;
}) {
  type MilkdropExperienceSnapshot = {
    activePresetId: string | null;
    backend: 'webgl' | 'webgpu';
    status: string | null;
    adaptiveQuality: AdaptiveQualityState | null;
    catalogEntries: ReturnType<typeof catalogCoordinator.getCatalogEntries>;
    sessionState: ReturnType<typeof session.getState>;
    audioEnergy: number;
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
  const statsOverlay = createStatsOverlay();
  const session = createMilkdropEditorSession({
    initialPreset: defaultPreset.source,
    initialCompiled: defaultPreset,
  });

  let runtime: ToyRuntimeInstance | null = null;
  let adapter: MilkdropRendererAdapter | null = null;
  let activeCompiled: MilkdropCompiledPreset = defaultPreset;
  let activePresetId = defaultPreset.source.id;
  let pendingStartupPresetId = initialPresetId ?? null;
  let activeBackend: 'webgl' | 'webgpu' = 'webgl';
  let currentFrameState: MilkdropFrameState | null = null;
  let blendState = cloneBlendState(currentFrameState);
  let blendEndAtMs = 0;
  let autoplay = preferences.getAutoplay();
  let lockedPreset = false;
  const presetBlend = activeCompiled.ir.numericFields.blend_duration;
  let blendDuration = preferences.getBlendDuration(
    presetBlend && presetBlend > 0 ? presetBlend : 0.3,
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
  let _disposeSessionSubscription: (() => void) | null = null;
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
    audioEnergy: signalTracker.getLatestAudioEnergy(),
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
  let previewCaptureRevision = 0;
  let previewService: ReturnType<
    typeof createMilkdropPresetPreviewService
  > | null = null;

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
      if (!lifetime.isActive()) {
        return;
      }
      overlay?.setCatalog(entries, nextActivePresetId, nextActiveBackend);
      emitChange();
    },
  });
  const catalogActions = createMilkdropCatalogActions({
    catalogStore,
    catalogCoordinator,
    getActivePresetId: () => activePresetId,
    getActiveBackend: () => activeBackend,
  });

  const shouldFallbackToWebgl = (compiled: MilkdropCompiledPreset) =>
    !shouldDeferStartupPresetFallback({
      pendingPresetId: pendingStartupPresetId,
      activePresetId: compiled.source.id,
    }) &&
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

  const waitForPreviewFrameBudget = (durationMs: number) =>
    new Promise<void>((resolve) => {
      window.setTimeout(resolve, durationMs);
    });

  const capturePresetPreview = async (
    presetId: string,
  ): Promise<Omit<MilkdropPresetRenderPreview, 'presetId' | 'status'>> => {
    if (typeof document === 'undefined') {
      throw new Error('Runtime preview capture requires a browser document.');
    }

    // Try static preview first — instant if available
    let useStatic = false;
    try {
      const staticUrl = `/milkdrop-presets/previews/${presetId}.png`;
      const response = await fetch(staticUrl, { method: 'HEAD' });
      useStatic = response.ok;
    } catch {
      // Static preview not available, fall through
    }
    if (useStatic) {
      return {
        imageUrl: `/milkdrop-presets/previews/${presetId}.png`,
        actualBackend: null,
        updatedAt: Date.now(),
        error: null,
        source: 'runtime-snapshot',
      };
    }

    previewCaptureRevision += 1;
    const revision = previewCaptureRevision;
    const previewHost = document.createElement('div');
    previewHost.className = 'milkdrop-overlay__preview-capture-host';
    previewHost.setAttribute('aria-hidden', 'true');
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = 360;
    previewCanvas.height = 203;
    previewCanvas.className = 'milkdrop-overlay__preview-capture-canvas';
    previewHost.appendChild(previewCanvas);
    document.body.appendChild(previewHost);

    let previewRuntime: ToyRuntimeInstance | null = null;
    let previewDisposed = false;
    const previewQuality = createRendererQualityManager({
      presets: qualityControl.presets,
      defaultPresetId: quality.activeQuality.id,
      storageKey: qualityControl.storageKey,
      getRuntime: () => previewRuntime,
    });
    const previewExperience = createMilkdropExperience({
      container: previewHost,
      quality: previewQuality,
      qualityControl,
      initialPresetId: presetId,
      _showOverlayToggle: false,
      enableOverlay: false,
      previewMode: true,
    });
    const startPreviewRuntime = createToyRuntimeStarter({
      toyOptions: {
        cameraOptions: { position: { x: 0, y: 0, z: 5 } },
        rendererOptions: { antialias: false },
      },
      audio: {
        fftSize: 512,
      },
      plugins: [
        {
          name: 'milkdrop-preview-capture',
          setup: (runtimeInstance) => {
            previewRuntime = runtimeInstance;
            previewExperience.attachRuntime(runtimeInstance);
          },
          update: (frame) => {
            previewExperience.update(frame);
          },
          dispose: () => {
            previewExperience.dispose();
          },
        },
      ],
    });

    const disposePreview = () => {
      if (previewDisposed) {
        return;
      }
      previewDisposed = true;
      previewRuntime?.dispose();
      previewRuntime = null;
      previewHost.remove();
    };

    try {
      previewRuntime = startPreviewRuntime({ container: previewHost });
      await previewExperience.selectPreset(presetId, {
        recordHistory: false,
      });
      await waitForPreviewFrameBudget(750);

      if (revision !== previewCaptureRevision) {
        throw new Error('Preview capture was superseded by a newer request.');
      }

      const backend = previewExperience.getStateSnapshot().backend;
      const canvas =
        previewHost.querySelector('canvas') ??
        previewRuntime?.toy.canvas ??
        null;
      if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error('Preview canvas was not available.');
      }

      return {
        imageUrl: canvas.toDataURL('image/webp', 0.82),
        actualBackend: backend,
        updatedAt: Date.now(),
        error: null,
        source: 'runtime-snapshot',
      };
    } finally {
      disposePreview();
    }
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
      if (!previewMode) {
        preferences.rememberLastPreset(id);
      }
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
    overlay: enableOverlay
      ? {
          isOpen: () => getOverlay().isOpen(),
          toggleOpen: (open?: boolean) => getOverlay().toggleOpen(open),
          toggleShortcutHud: (open?: boolean) =>
            getOverlay().toggleShortcutHud(open),
        }
      : {
          isOpen: () => false,
          toggleOpen: () => {},
          toggleShortcutHud: () => {},
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
        await catalogActions.setFavorite(id, favorite);
      },
      onSetRating: async (id, rating) => {
        await catalogActions.setRating(id, rating);
      },
      onRequestPresetPreviews: (presetIds) => {
        previewService?.requestPreviews(presetIds);
      },
      onRefreshPresetPreviews: (presetIds) => {
        previewService?.refreshPreviews(presetIds);
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
      onEditorSourceChange: async (source) => {
        const state = await session.applySource(source);
        window.dispatchEvent(
          new CustomEvent('stims:editor:diagnostics', {
            detail: { diagnostics: state.diagnostics, source: state.source },
          }),
        );
      },
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
        void catalogActions.toggleFavorite(id);
      },
      setRating: (id, rating) => {
        void catalogActions.setRating(id, rating);
      },
      togglePresetLock: () => {
        lockedPreset = !lockedPreset;
        setOverlayStatus(lockedPreset ? 'Preset locked.' : 'Preset unlocked.');
      },
      isPresetLocked: () => lockedPreset,
    },
  });

  if (!previewMode) {
    previewService = createMilkdropPresetPreviewService({
      capturePreview: capturePresetPreview,
      onPreviewChanged: (preview) => {
        overlay?.setPresetPreview(preview);
      },
    });
  }

  if (enableOverlay) {
    document.querySelectorAll('.milkdrop-overlay').forEach((el) => el.remove());
    overlay = new MilkdropOverlay({
      host: container ?? document.body,
      callbacks: {
        onToggleAutoplay: (enabled) => {
          autoplay = enabled;
          preferences.setAutoplay(enabled);
        },
        onTransitionModeChange: (mode) => {
          transitionMode = mode;
          preferences.setTransitionMode(mode);
        },
        onNextPreset: () => navigation.selectAdjacentPreset(1),
        onPreviousPreset: () => navigation.selectAdjacentPreset(-1),
        onBlendDurationChange: (value) => {
          blendDuration = value;
          preferences.setBlendDuration(value);
        },
      },
    });

    overlay.setAutoplay(autoplay);
    overlay.setBlendDuration(blendDuration);
    overlay.setTransitionMode(transitionMode);
  }
  const fallbackNotice = !previewMode
    ? preferences.consumeFallbackNotice()
    : null;
  if (fallbackNotice) {
    console.info('[Stims] Renderer fallback:', fallbackNotice);
  }

  const { applyFieldValues, nudgeNumericField, cycleWaveMode } =
    createMilkdropEditorActions({
      session,
      getCompiled: () => session.getState().activeCompiled ?? activeCompiled,
      setOverlayStatus,
    });
  const attachmentController = createMilkdropExperienceAttachmentController({
    lifetime,
    getRuntime: () => runtime,
    setRuntime: (nextRuntime) => {
      runtime = nextRuntime;
    },
    getAdapter: () => adapter,
    setAdapter: (nextAdapter) => {
      adapter = nextAdapter;
    },
    activeCompiled: () => activeCompiled,
    setActiveBackend: (backend) => {
      activeBackend = backend;
    },
    setDocumentActiveBackend: (backend) => {
      if (typeof document !== 'undefined') {
        document.body.dataset.activeBackend = backend;
      }
    },
    vm,
    disposePostprocessingPipeline,
    capturedVideoOverlay,
    setAdaptiveQualityController: (controller) => {
      adaptiveQualityController = controller;
    },
    setAdaptiveQualityUnsubscribe: (unsubscribe) => {
      adaptiveQualityUnsubscribe?.();
      adaptiveQualityUnsubscribe = unsubscribe;
    },
    setAdaptiveQualityState: (state) => {
      adaptiveQualityState = state as AdaptiveQualityState;
    },
    updateAgentDebugSnapshot,
    shouldFallbackToWebgl,
    triggerWebglFallback,
    scheduleCatalogSync: () => {
      void catalogCoordinator.scheduleCatalogSync({
        activePresetId,
        activeBackend,
      });
    },
    emitChange,
    setOverlayStatus,
    disabledWebGpuOptimizationFlags,
    webgpuOptimizationFlags,
    ensureKeyboardShortcuts: () => {
      if (!disposeKeyboardShortcuts) {
        disposeKeyboardShortcuts =
          interactionPresenter.installKeyboardShortcuts();
      }
    },
  });
  const frameLoop = createMilkdropExperienceFrameLoop({
    getRuntime: () => runtime,
    getAdapter: () => adapter,
    getActiveBackend: () => activeBackend,
    setCurrentFrameState: (frameState) => {
      currentFrameState = frameState;
    },
    getBlendState: () => blendState,
    getBlendEndAtMs: () => blendEndAtMs,
    getBlendDuration: () => blendDuration,
    getTransitionMode: () => transitionMode,
    getAutoplay: () => autoplay && !lockedPreset,
    getLastPresetSwitchAt: () => lastPresetSwitchAt,
    updateAgentDebugSnapshot,
    agentModeEnabled,
    quality,
    vm,
    signalTracker,
    capturedVideoReactivityTracker,
    navigation,
    catalogCoordinator,
    performanceTracker,
    getAdaptiveQualityController: () => adaptiveQualityController,
    overlay,
    getLastInspectorOverlaySyncAt: () => lastInspectorOverlaySyncAt,
    setLastInspectorOverlaySyncAt: (value) => {
      lastInspectorOverlaySyncAt = value;
    },
    presentationController,
    lowQualityPostOverride,
    mergedSignals,
    getPostprocessingPipeline: () => postprocessingPipeline,
    setPostprocessingPipeline: (pipeline) => {
      postprocessingPipeline = pipeline;
    },
    capturedVideoOverlay,
  });

  _disposeSessionSubscription = session.subscribe((state) => {
    if (!lifetime.isActive()) {
      return;
    }
    overlay?.setSessionState(state);
    const nextCompiled = state.activeCompiled;
    if (!nextCompiled) {
      return;
    }
    if (shouldFallbackToWebgl(nextCompiled)) {
      log.log(
        `${nextCompiled.source.id}: subscriber: WebGL fallback triggered`,
      );
      triggerWebglFallback({
        presetId: nextCompiled.source.id,
        reason: `${nextCompiled.title} uses preset features the WebGPU runtime does not support yet, so Stims switched to WebGL compatibility mode.`,
      });
      return;
    }
    const didPresetIdChange =
      nextCompiled.source.id !== activeCompiled.source.id;
    const didSourceChange =
      nextCompiled.formattedSource !== activeCompiled.formattedSource;
    if (didPresetIdChange) {
      log.log(
        `${nextCompiled.source.id}: subscriber: preset ID change, applying`,
      );
      applyPresetPerformanceOverride(nextCompiled.source.id);
      applyCompiledPreset(nextCompiled);
      void catalogStore.saveDraft(nextCompiled.source.id, state.source);
      scheduleDeferredCatalogSync();
      emitChange();
      return;
    }
    if (didSourceChange) {
      log.log(
        `${nextCompiled.source.id}: subscriber: source change, re-applying`,
      );
      applyPresetPerformanceOverride(nextCompiled.source.id);
      applyCompiledPreset(nextCompiled);
      void catalogStore.saveDraft(nextCompiled.source.id, state.source);
    }
    emitChange();
  });

  if (!previewMode) {
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
  }
  void (async () => {
    await catalogCoordinator.scheduleCatalogSync({
      activePresetId,
      activeBackend,
    });
    if (!lifetime.isActive()) {
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
    pendingStartupPresetId = startupPresetId;
    if (!lifetime.isActive()) {
      return;
    }
    if (collectionEntry && requestedCollectionTag) {
      overlay?.setActiveCollectionTag(requestedCollectionTag);
    }
    if (startupPresetId) {
      await navigation.selectPreset(startupPresetId, {
        recordHistory: false,
      });
      pendingStartupPresetId = null;
      if (!lifetime.isActive()) {
        return;
      }
      if (activePresetId === startupPresetId) {
        return;
      }
    }
    pendingStartupPresetId = null;
  })();

  return buildExperienceController({
    subscribe,
    buildSnapshot,
    navigation,
    overlay,
    presetFileActions,
    session,
    applyFieldValues,
    activeCompiled,
    activePresetId,
    qualityControl,
    applyQualityPreset,
    setOverlayStatus,
    attachmentController,
    frameLoop,
    lifetime,
    previewService,
    capturedVideoReactivityTracker,
    capturedVideoOverlay,
    adapter,
    performanceTracker,
    adaptiveQualityUnsubscribe,
    adaptiveQualityController,
    runtime,
    disposeKeyboardShortcuts,
    disposeRequestedPresetListener,
    disposeRequestedOverlayTabListener,
    catalogCoordinator,
    disposeRuntimeSignalHub,
    setQualityPresetById,
    previewCaptureRevision,
    emitChange,
    clearDeferredCatalogSync,
    disposePostprocessingPipeline,
    statsOverlay,
    // biome-ignore lint/suspicious/noExplicitAny: builder pattern
  } as any);
}

// biome-ignore lint/suspicious/noExplicitAny: builder pattern needs dynamic deps
function buildExperienceController(deps: any) {
  return {
    subscribe(listener: unknown) {
      return deps.subscribe(listener);
    },
    getStateSnapshot() {
      return deps.buildSnapshot();
    },
    applyFields(updates: unknown) {
      return deps.applyFieldValues(updates);
    },
    getActiveCompiledPreset() {
      return deps.activeCompiled;
    },
    getActivePresetId() {
      return deps.activePresetId;
    },
    selectPreset: deps.navigation.selectPreset,

    setActiveCollectionTag(collectionTag: string | null) {
      if (!collectionTag) return;
      deps.overlay?.setActiveCollectionTag(collectionTag);
      deps.emitChange();
    },

    openTab(
      tab:
        | 'browse'
        | 'editor'
        | 'inspector'
        | 'refine'
        | 'audiomatch'
        | 'visualsearch'
        | 'blend',
    ) {
      deps.overlay?.openTab(tab);
      deps.emitChange();
    },

    setOverlayOpen(open: boolean) {
      deps.overlay?.toggleOpen(open);
      deps.emitChange();
    },

    async importPresetFiles(files: FileList) {
      await deps.presetFileActions.importFiles(files);
      deps.emitChange();
    },

    exportPreset() {
      deps.presetFileActions.exportPreset();
    },
    async duplicatePreset() {
      await deps.presetFileActions.duplicatePreset();
      deps.emitChange();
    },
    async deleteActivePreset() {
      await deps.presetFileActions.deleteActivePreset();
      deps.emitChange();
    },
    updateEditorSource(source: string) {
      deps.session.applySource(source);
      deps.emitChange();
    },
    revertEditorSource() {
      deps.session.resetToActive();
      deps.emitChange();
    },
    updateInspectorField(key: string, value: string | number) {
      deps.session.updateField(key, value);
      deps.emitChange();
    },

    setQualityPreset(presetId: string) {
      const preset = deps.setQualityPresetById(presetId, {
        presets: deps.qualityControl.presets,
        storageKey: deps.qualityControl.storageKey,
      });
      if (!preset) return null;
      deps.applyQualityPreset(preset);
      deps.emitChange();
      return preset;
    },

    setStatus(message: string) {
      deps.setOverlayStatus(message);
    },
    attachRuntime(nextRuntime: unknown) {
      const result = deps.attachmentController.attachRuntime(nextRuntime);
      const rt = nextRuntime as { toy: { rendererReady: Promise<unknown> } };
      rt.toy.rendererReady.then((handle: unknown) => {
        void deps.statsOverlay.init(
          (handle as { renderer?: unknown }).renderer,
        );
      });
      return result;
    },
    update(frame: unknown, options?: unknown) {
      const result = deps.frameLoop.update(frame, options);
      deps.statsOverlay.update();
      return result;
    },

    dispose() {
      deps.statsOverlay.dispose();
      deps.lifetime.dispose();
      deps.clearDebugSnapshot?.('milkdrop');
      deps.disposeSessionSubscription?.();
      deps.previewService?.dispose();
      deps.previewCaptureRevision += 1;
      deps.overlay?.dispose();
      deps.session.dispose();
      deps.clearDeferredCatalogSync();
      deps.capturedVideoReactivityTracker?.reset();
      deps.disposePostprocessingPipeline();
      deps.capturedVideoOverlay?.dispose();
      deps.adapter?.dispose();
      deps.performanceTracker?.reset();
      deps.adaptiveQualityUnsubscribe?.();
      deps.catalogCoordinator?.dispose();
      deps.disposeRuntimeSignalHub?.();
    },
  };
}

export const __milkdropRuntimeTestUtils = {
  cloneBlendState,
};
