import { isFreezeFrameActive } from '../core/accessibility-preferences.ts';
import { isAgentMode, setDebugSnapshot } from '../core/agent-api.ts';
import { createLogger } from '../core/logger.ts';
import type { PostprocessingPipeline } from '../core/postprocessing.ts';
import type {
  AdaptiveQualityController,
  AdaptiveQualityState,
} from '../core/services/adaptive-quality-controller.ts';
import { noteSubstitution } from '../core/services/preset-telemetry.ts';
import { subscribeToRendererLifecycle } from '../core/services/render-service.ts';
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
import type { MilkdropPresetRenderPreview } from './preset-preview.ts';
import { encodePresetPreviewImage } from './preset-preview.ts';
import type { MilkdropRendererAdapter } from './renderer-types';
import {
  createMilkdropBackendFailover,
  describeWebglFallback,
} from './runtime/backend-fallback';
import { createMilkdropCapturedVideoOverlay } from './runtime/captured-video-overlay.ts';
import { createMilkdropCapturedVideoReactivityTracker } from './runtime/captured-video-reactivity.ts';
import { createMilkdropCatalogCoordinator } from './runtime/catalog-coordinator';
import { registerAgentMilkdropRuntimeDebugHandle } from './runtime/debug-snapshot';
import { DEFAULT_MILKDROP_PRESET_SOURCE } from './runtime/default-preset';
import { createMilkdropEditorActions } from './runtime/editor-actions';
import { createMilkdropExperienceAttachmentController } from './runtime/experience-attachment.ts';
import { createMilkdropExperienceFrameLoop } from './runtime/experience-frame-loop.ts';
import {
  DEFAULT_BLEND_DURATION_SECONDS,
  FIRST_RUN_PRESET_AUTHOR,
  FIRST_RUN_PRESET_ID,
  FIRST_RUN_PRESET_TITLE,
} from './runtime/first-run-preset';
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
import { cloneBlendState, estimateFrameBlendWorkload } from './runtime/session';
import { shouldDeferStartupPresetFallback } from './runtime/startup.ts';
import { selectMilkdropStartupPreset } from './runtime/startup-selection';
import { createMilkdropTransitionController } from './runtime/transition-controller';
import { installRequestedPresetListener } from './runtime/ui-bridge';
import { createMilkdropSignalTracker } from './runtime-signals';
import type {
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropRuntimeSignals,
} from './types';
import { createMilkdropVM } from './vm';
import { resolveMilkdropWebGpuOptimizationFlags } from './webgpu-optimization-flags';

const log = createLogger('MilkdropRuntime');

export const applyMilkdropInteractionResponse =
  applyMilkdropInteractionResponseImpl;
export const buildMilkdropInputSignalOverrides =
  buildMilkdropInputSignalOverridesImpl;
export const getMilkdropDetailScale = getMilkdropDetailScaleImpl;

const MAX_BLEND_WORKLOAD = 900;

export function createMilkdropExperience({
  quality,
  qualityControl,
  initialPresetId,
  previewMode = false,
}: {
  quality: QualityPresetManager;
  qualityControl: {
    presets: QualityPreset[];
    storageKey: string;
  };
  initialPresetId?: string;
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
    audioBass: number;
    audioMid: number;
    audioTreble: number;
    autoplay: boolean;
    transitionMode: 'blend' | 'cut';
    blendDuration: number;
  };

  const catalogStore = createMilkdropCatalogStore();
  // Deep-link boots used to fetch the requested preset's source only after
  // engine mount + catalog projection + the route effect round-tripped.
  // Kicking the fetch here overlaps it (and the parse+IR compile, via the
  // shared raw-string cache) with renderer boot and GPU init; the later real
  // load then hits warm caches. Fire-and-forget: a bad id resolves to null
  // and the normal load path still owns every user-visible outcome.
  if (initialPresetId && initialPresetId !== FIRST_RUN_PRESET_ID) {
    void catalogStore
      .getPresetSource(initialPresetId)
      .then((source) => {
        if (source) {
          compileMilkdropPresetSource(source.raw, source, {
            cacheCompile: true,
          });
        }
      })
      .catch(() => {});
  }
  const defaultPreset = compileMilkdropPresetSource(
    DEFAULT_MILKDROP_PRESET_SOURCE,
    {
      id: FIRST_RUN_PRESET_ID,
      title: FIRST_RUN_PRESET_TITLE,
      origin: 'bundled',
      author: FIRST_RUN_PRESET_AUTHOR,
    },
  );
  const preferences = createMilkdropRuntimePreferences();
  const webgpuOptimizationFlags = resolveMilkdropWebGpuOptimizationFlags();
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
  const transitionController = createMilkdropTransitionController();
  let autoplay = preferences.getAutoplay();
  let lockedPreset = false;
  let blendDuration = preferences.getBlendDuration(
    DEFAULT_BLEND_DURATION_SECONDS,
  );
  let preferredTransitionMode = preferences.getTransitionMode();
  let transitionMode = preferredTransitionMode;
  let preferredQualityPresetId = quality.activeQuality.id;
  const agentModeEnabled = isAgentMode();
  let lastPresetSwitchAt = performance.now();
  let lastStatusMessage: string | null = null;
  let disposeKeyboardShortcuts: (() => void) | null = null;
  let disposeRequestedPresetListener: (() => void) | null = null;
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
    if (rememberPreferred) {
      preferredTransitionMode = mode;
      preferences.setTransitionMode(mode);
    }
    emitChange();
  };

  const setAutoplayEnabled = (enabled: boolean) => {
    autoplay = enabled;
    preferences.setAutoplay(enabled);
    emitChange();
  };

  const setBlendDurationValue = (value: number) => {
    blendDuration = value;
    preferences.setBlendDuration(value);
    emitChange();
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
    reload: (presetId) => {
      // Carry the preset id in the URL so the reload's renderer selection can
      // see it: shouldPreferWebGLForKnownCompatibilityGaps only consults
      // ?preset=, and without it the reload mounts WebGPU again, hits the same
      // descriptor fallback, and reloads forever.
      const url = new URL(window.location.href);
      url.searchParams.set('preset', presetId);
      window.location.replace(url.toString());
    },
  });
  const presentationController = createMilkdropPresentationController({
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
    // Three primitives rather than an object: the snapshot equality check is
    // per-field ===, and a fresh object every frame would defeat it.
    audioBass: signalTracker.getLatestAudioBands().bass,
    audioMid: signalTracker.getLatestAudioBands().mid,
    audioTreble: signalTracker.getLatestAudioBands().treble,
    autoplay,
    transitionMode,
    blendDuration,
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
    presentationController.setOverlayStatus();
    emitChange();
  };

  const setTransitionMode = (mode: 'blend' | 'cut') => {
    setEffectiveTransitionMode(mode, { rememberPreferred: true });
  };

  const applyCompiledPreset = (compiled: MilkdropCompiledPreset) =>
    presentationController.applyCompiledPreset(compiled);

  const catalogCoordinator = createMilkdropCatalogCoordinator({
    catalogStore,
    onCatalogChanged(_entries, _nextActivePresetId, _nextActiveBackend) {
      if (!lifetime.isActive()) {
        return;
      }
      emitChange();
    },
  });

  const shouldFallbackToWebgl = (
    compiled: MilkdropCompiledPreset,
    backend = activeBackend,
    optimizationFlags = webgpuOptimizationFlags,
  ) =>
    !shouldDeferStartupPresetFallback({
      pendingPresetId: pendingStartupPresetId,
      activePresetId: compiled.source.id,
    }) &&
    backendFailover.shouldFallback({
      compiled,
      activeBackend: backend,
      webgpuOptimizationFlags: optimizationFlags,
    });

  const triggerWebglFallback = ({
    presetId,
    reason,
    backend,
  }: {
    presetId: string;
    reason: string;
    /** The backend the caller is falling back FROM. Needed during attachment,
     * where the module-level activeBackend still holds its pre-mount default
     * and would make the failover guard silently drop the request. */
    backend?: 'webgl' | 'webgpu';
  }) => {
    noteSubstitution('backend-fallback', `${presetId}: ${reason}`);
    backendFailover.trigger({
      presetId,
      reason,
      activeBackend: backend ?? activeBackend,
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
      quality: previewQuality,
      qualityControl,
      initialPresetId: presetId,
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
        imageUrl: encodePresetPreviewImage(canvas),
        actualBackend: backend,
        updatedAt: Date.now(),
        error: null,
        source: 'runtime-snapshot',
      };
    } finally {
      disposePreview();
    }
  };

  /**
   * Starts the crossfade into a preset that is about to be applied.
   *
   * Preset switches arrive on two paths — the navigation controller and the
   * editor-session subscriber below — and both need the same blend-vs-cut
   * decision over the same frame state. Each used to derive it separately,
   * down to a second copy of `MAX_BLEND_WORKLOAD` in the controller.
   */
  const beginPresetTransition = () => {
    const canBlend =
      transitionMode === 'blend' &&
      blendDuration > 0 &&
      estimateFrameBlendWorkload(currentFrameState) < MAX_BLEND_WORKLOAD;
    const nextBlendState = canBlend ? cloneBlendState(currentFrameState) : null;
    transitionController.begin(nextBlendState, blendDuration);
    if (nextBlendState) {
      adapter?.saveFeedbackFrame?.();
    }
    lastPresetSwitchAt = performance.now();
    // Warm-up hint: the incoming preset's first frames carry compile and
    // feedback warm-up cost that resolves on its own. The controller clears
    // stale pressure evidence and, on constrained devices, pre-pays the
    // warm-up with one quality step instead of dropped frames.
    adaptiveQualityController?.notePresetApplied();
    return {
      mode: canBlend ? ('blend' as const) : ('cut' as const),
      durationSeconds: blendDuration,
    };
  };

  const navigation = createMilkdropPresetNavigationController({
    catalogStore,
    catalogCoordinator,
    session,
    getActivePresetId: () => activePresetId,
    getActiveBackend: () => activeBackend,
    applyCompiledPreset,
    applyPresetPerformanceOverride,
    beginPresetTransition,
    setOverlayStatus,
    shouldFallbackToWebgl,
    triggerWebglFallback,
    rememberLastPreset: (id) => {
      if (!previewMode) {
        preferences.rememberLastPreset(id);
      }
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
    setStatus: setOverlayStatus,
  });

  const interactionPresenter = createMilkdropRuntimeInteractionPresenter({
    overlay: {
      isOpen: () => false,
      toggleOpen: () => {},
      toggleShortcutHud: () => {},
    },
    keybindingActions: {
      getTransitionMode: () => transitionMode,
      getBlendDuration: () => blendDuration,
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
      onPreviewChanged: () => {},
      onPreviewEvicted: () => {},
    });
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
    transitionController,
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
    lowQualityPostOverride,
    mergedSignals,
    getPostprocessingPipeline: () => postprocessingPipeline,
    setPostprocessingPipeline: (pipeline) => {
      postprocessingPipeline = pipeline;
    },
    capturedVideoOverlay,
    getFreezeFrame: () => isFreezeFrameActive(),
  });

  _disposeSessionSubscription = session.subscribe((state) => {
    if (!lifetime.isActive()) {
      return;
    }
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
        reason: describeWebglFallback(nextCompiled),
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
      beginPresetTransition();
      if (!previewMode) {
        void catalogCoordinator.rememberSelection(nextCompiled.source.id);
        preferences.rememberLastPreset(nextCompiled.source.id);
      }
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
  }
  void (async () => {
    await catalogCoordinator.scheduleCatalogSync({
      activePresetId,
      activeBackend,
    });
    if (!lifetime.isActive()) {
      return;
    }
    const { startupPresetId } = await selectMilkdropStartupPreset({
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
    if (startupPresetId) {
      await navigation.selectPreset(startupPresetId, {
        recordHistory: false,
        skipIfAlreadyActive: true,
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
    presetFileActions,
    session,
    applyFieldValues,
    activeCompiled,
    activePresetId,
    qualityControl,
    applyQualityPreset,
    setOverlayStatus,
    getAutoplay: () => autoplay,
    setAutoplay: setAutoplayEnabled,
    getTransitionMode: () => transitionMode,
    setTransitionMode,
    getBlendDuration: () => blendDuration,
    setBlendDuration: setBlendDurationValue,
    attachmentController,
    frameLoop,
    lifetime,
    previewService,
    capturedVideoReactivityTracker,
    capturedVideoOverlay,
    adapter,
    performanceTracker,
    getAdaptiveQualityUnsubscribe: () => adaptiveQualityUnsubscribe,
    adaptiveQualityController,
    runtime,
    getDisposeKeyboardShortcuts: () => disposeKeyboardShortcuts,
    getDisposeRequestedPresetListener: () => disposeRequestedPresetListener,
    catalogCoordinator,
    disposeRuntimeSignalHub,
    setQualityPresetById,
    previewCaptureRevision,
    emitChange,
    clearDeferredCatalogSync,
    disposePostprocessingPipeline,
    statsOverlay,
    // setLiveField/applyFields drive the running VM directly (Tune drags,
    // MIDI, the agent API); omitting vm here made them throw.
    vm,
    // biome-ignore lint/suspicious/noExplicitAny: builder pattern bundles runtime delegates
  } as any);
}

// biome-ignore lint/suspicious/noExplicitAny: builder pattern bundles runtime delegates
function buildExperienceController(deps: Record<string, any>) {
  let rendererLifecycleUnsubscribe: (() => void) | null = null;
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
    goBackPreset: deps.navigation.goBackPreset,

    setActiveCollectionTag(collectionTag: string | null) {
      if (!collectionTag) return;
      deps.emitChange();
    },

    openTab(
      _tab:
        | 'browse'
        | 'editor'
        | 'inspector'
        | 'refine'
        | 'audiomatch'
        | 'visualsearch'
        | 'blend',
    ) {
      deps.emitChange();
    },

    setOverlayOpen(_open: boolean) {
      deps.emitChange();
    },

    getAutoplay() {
      return deps.getAutoplay();
    },
    setAutoplay(enabled: boolean) {
      deps.setAutoplay(enabled);
    },
    getTransitionMode() {
      return deps.getTransitionMode();
    },
    setTransitionMode(mode: 'blend' | 'cut') {
      deps.setTransitionMode(mode);
    },
    getBlendDuration() {
      return deps.getBlendDuration();
    },
    setBlendDuration(value: number) {
      deps.setBlendDuration(value);
    },

    async importPresetFiles(files: FileList | File[]) {
      await deps.presetFileActions.importFiles(files);
      deps.emitChange();
    },

    exportPreset() {
      deps.presetFileActions.exportPreset();
    },
    resizeForVideoExport(width: number, height: number) {
      deps.disposePostprocessingPipeline();
      deps.adapter?.resize(width, height);
    },
    async duplicatePreset() {
      await deps.presetFileActions.duplicatePreset();
      deps.emitChange();
    },
    async deleteActivePreset() {
      await deps.presetFileActions.deleteActivePreset();
      deps.emitChange();
    },
    /**
     * Awaitable counterpart to `updateEditorSource`, for callers that need to
     * know whether the source actually compiled — an agent editing preset
     * code cannot tell "applied" from "failed and the stage kept rendering
     * the last good compile" without the resulting diagnostics.
     */
    async applyEditorSourceAwaited(source: string) {
      const next = await deps.session.applySource(source);
      deps.emitChange();
      return next;
    },

    /** Atomic multi-field edit; see `MilkdropEditorSession.updateFields`. */
    async applyEditorFieldsAwaited(updates: Record<string, string | number>) {
      const next = await deps.session.updateFields(updates);
      deps.emitChange();
      return next;
    },

    getEditorSessionState() {
      return deps.session.getState();
    },

    // These are fire-and-forget by design — the editor renders from the
    // session's subscription, not from the returned state. They are still
    // guarded so a compile that fails in an unforeseen way surfaces as a log
    // line rather than an unhandled rejection that takes the page down.
    updateEditorSource(source: string) {
      void deps.session.applySource(source).catch((error: unknown) => {
        log.warn('Editor source could not be applied', error);
      });
      deps.emitChange();
    },
    revertEditorSource() {
      void deps.session.resetToActive().catch((error: unknown) => {
        log.warn('Editor revert failed', error);
      });
      deps.emitChange();
    },
    updateInspectorField(key: string, value: string | number) {
      // Live-first: MIDI faders and the inspector feed continuous values and
      // used to only become visible once a recompile landed. Write the running
      // VM immediately for instant feedback; the session commit below still
      // persists the value into the source.
      const numeric = typeof value === 'number' ? value : Number(value);
      if (Number.isFinite(numeric)) {
        deps.vm.setField(key, numeric);
      }
      void deps.session.updateField(key, value).catch((error: unknown) => {
        log.warn(`Inspector field "${key}" could not be applied`, error);
      });
      deps.emitChange();
    },
    /** Live-apply a numeric field to the running VM without recompiling. The
     * Tune pane uses this on `input` (during a drag); the value is committed
     * to the source separately on release. */
    setLiveField(key: string, value: number) {
      deps.vm.setField(key, value);
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
        // rendererReady resolves null when the runtime is disposed before the
        // renderer finishes booting (e.g. a superseded mount).
        const renderer = (handle as { renderer?: unknown } | null)?.renderer;
        if (!renderer || !deps.lifetime.isActive()) return;
        void deps.statsOverlay.init(renderer);
        // The pooled renderer handle keeps its identity across a device-loss
        // recovery, but the underlying renderer (and possibly the backend —
        // WebGPU can come back as WebGL) does not. The adapter and material
        // graph are compiled per-renderer, so a recreation must re-run the
        // attachment or every subsequent frame renders against disposed GPU
        // state (a permanently black stage with per-frame adapter errors).
        rendererLifecycleUnsubscribe?.();
        rendererLifecycleUnsubscribe = subscribeToRendererLifecycle((event) => {
          if (event.type !== 'recreated' || event.handle !== handle) {
            return;
          }
          if (!deps.lifetime.isActive()) {
            return;
          }
          log.log(
            `Renderer recreated (backend: ${event.handle.backend}); rebuilding the milkdrop attachment.`,
          );
          deps.attachmentController.attachRuntime(nextRuntime);
        });
      });
      return result;
    },
    update(frame: unknown, options?: unknown) {
      const result = deps.frameLoop.update(frame, options);
      deps.statsOverlay.update();
      return result;
    },

    dispose() {
      rendererLifecycleUnsubscribe?.();
      rendererLifecycleUnsubscribe = null;
      deps.statsOverlay.dispose();
      deps.lifetime.dispose();
      deps.clearDebugSnapshot?.('milkdrop');
      deps.disposeSessionSubscription?.();
      deps.previewService?.dispose();
      deps.previewCaptureRevision += 1;
      deps.session.dispose();
      deps.clearDeferredCatalogSync();
      deps.capturedVideoReactivityTracker?.reset();
      deps.disposePostprocessingPipeline();
      deps.capturedVideoOverlay?.dispose();
      deps.adapter?.dispose();
      deps.performanceTracker?.reset();
      deps.getAdaptiveQualityUnsubscribe?.()?.();
      deps.getDisposeKeyboardShortcuts?.()?.();
      deps.getDisposeRequestedPresetListener?.()?.();
      deps.catalogCoordinator?.dispose();
      deps.disposeRuntimeSignalHub?.();
    },
  };
}

export { __milkdropRuntimeTestUtils } from './runtime/test-utils.ts';
