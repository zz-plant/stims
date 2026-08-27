/**
 * The single seam between the React workspace and the imperative engine.
 *
 * `createMilkdropEngineAdapter` builds the object `frontend/` calls to mount,
 * drive and tear down a visualizer session. React never reaches into
 * `milkdrop/` directly; every crossing goes through here, and
 * `bun run check:architecture` enforces that.
 *
 * The boundary is worth defending. On one side is declarative UI that
 * re-renders freely; on the other is a stateful engine holding GPU resources
 * and a frame loop. Keeping the crossing narrow is what stops React's render
 * cycle from driving GPU lifetime — the class of bug where a re-render silently
 * disposes a live context.
 *
 * Add capability by widening the adapter's vocabulary deliberately, not by
 * importing engine internals into a component.
 */
import { setAudioActive, setCurrentToy } from '../../core/agent-api.ts';
import {
  DEFAULT_QUALITY_PRESETS,
  QUALITY_STORAGE_KEY,
} from '../../core/settings-panel.ts';
import { createRendererQualityManager } from '../../core/toy-quality.ts';
import type { ToyRuntimeInstance } from '../../core/toy-runtime.ts';
import { requestMilkdropCollectionSelection } from '../../milkdrop/collection-intent.ts';
import type { createMilkdropExperience } from '../../milkdrop/runtime.ts';
import type {
  AudioSource,
  EngineAudioRequest,
  LaunchIntent,
} from '../contracts.ts';
import {
  buildEngineSnapshot,
  createEmptyEngineSnapshot,
  type EngineSnapshot,
} from './engine-snapshot.ts';
import { toFileList } from './file-list.ts';
import { waitForRuntime } from './runtime-wait.ts';
import { createVideoExportRuntime } from './video-export-runtime.ts';

type RuntimeFactories = {
  createMilkdropExperience: typeof import('../../milkdrop/runtime.ts').createMilkdropExperience;
  createToyRuntimeStarter: typeof import('../../core/toy-runtime-starter.ts').createToyRuntimeStarter;
};
type ExperienceController = ReturnType<typeof createMilkdropExperience>;

let runtimeFactoriesPromise: Promise<RuntimeFactories> | null = null;
let capturedVideoModulePromise: Promise<
  typeof import('../../core/services/captured-video-texture.ts')
> | null = null;

const loadRuntimeFactories = () => {
  if (!runtimeFactoriesPromise) {
    runtimeFactoriesPromise = Promise.all([
      import('../../milkdrop/runtime.ts'),
      import('../../core/toy-runtime-starter.ts'),
    ])
      .then(([runtimeModule, starterModule]) => ({
        createMilkdropExperience: runtimeModule.createMilkdropExperience,
        createToyRuntimeStarter: starterModule.createToyRuntimeStarter,
      }))
      .catch((error) => {
        runtimeFactoriesPromise = null;
        throw error;
      });
  }

  return runtimeFactoriesPromise;
};

const loadCapturedVideoModule = () => {
  if (!capturedVideoModulePromise) {
    capturedVideoModulePromise = import(
      '../../core/services/captured-video-texture.ts'
    ).catch((error) => {
      capturedVideoModulePromise = null;
      throw error;
    });
  }

  return capturedVideoModulePromise;
};

export function createMilkdropEngineAdapter() {
  let container: HTMLElement | null = null;
  // Bumped on every mount() call (including the second call of React
  // StrictMode's dev-only double-invoke). A stale mount's async
  // continuation can resume *after* a newer mount() has already reset
  // `container` to a non-null value, so a bare `container` null-check isn't
  // enough to tell the two apart — both would see a truthy container and
  // both would proceed to build a competing experience/runtime. Comparing
  // against the token captured at the start of this specific call catches
  // that case; the `container` check below still catches "disposed and
  // nothing replaced it" (a real, final teardown, not a StrictMode remount).
  let mountToken = 0;
  let runtime: ToyRuntimeInstance | null = null;
  let experience: ExperienceController | null = null;
  let audioActive = false;
  let audioSource: AudioSource | null = null;
  let audioEndedAt: number | null = null;
  let unsubscribeExperience: (() => void) | null = null;
  let lastSnapshot: EngineSnapshot = createEmptyEngineSnapshot();
  const subscribers = new Set<(snapshot: EngineSnapshot) => void>();
  const videoExportRuntime = createVideoExportRuntime({
    getToy: () => runtime?.toy ?? null,
    resizeMilkdrop: (width, height) => {
      experience?.resizeForVideoExport(width, height);
    },
  });

  const quality = createRendererQualityManager({
    presets: DEFAULT_QUALITY_PRESETS,
    storageKey: QUALITY_STORAGE_KEY,
    getRuntime: () => runtime,
  });

  const emit = () => {
    const next = buildEngineSnapshot({
      experience,
      runtime,
      audioActive,
      audioSource,
      audioEndedAt,
      previousSnapshot: lastSnapshot,
    });
    if (next === lastSnapshot) {
      return;
    }
    lastSnapshot = next;
    subscribers.forEach((subscriber) => subscriber(lastSnapshot));
  };

  const performStopAudio = async () => {
    if (!audioActive) return;

    if (runtime) {
      runtime.stopAudio();
    }
    if (capturedVideoModulePromise) {
      const { clearMilkdropCapturedVideoStream } =
        await loadCapturedVideoModule();
      clearMilkdropCapturedVideoStream();
    }
    audioActive = false;
    audioSource = null;
    setAudioActive(false, null);
    emit();
  };

  /**
   * Wired into the toy runtime's audio options (see `mount()` below) so it
   * fires whenever `initAudio` detects the live stream's track ending
   * unexpectedly — mic permission revoked, device unplugged, or a tab /
   * display / YouTube capture stopped from the browser's native UI.
   * Recording `audioEndedAt` (rather than a boolean) lets the React layer
   * key an effect off "this happened again", since it never resets to null.
   */
  const handleAudioStreamEnded = () => {
    audioEndedAt = Date.now();
    // Emit immediately so the React layer observes the audioEndedAt bump
    // even if performStopAudio's early-return (audioActive already false)
    // would otherwise swallow it.
    emit();
    void performStopAudio();
  };

  const disposeRuntime = () => {
    if (typeof window !== 'undefined') {
      delete window.__STIMS_AGENT_RENDER_FRAMES__;
    }
    unsubscribeExperience?.();
    unsubscribeExperience = null;
    // The runtime may be torn down before the toy starter returns a fully
    // formed instance (e.g. an engine that fails mid-start), so guard the
    // method, not just the object.
    runtime?.dispose?.();
    runtime = null;
    experience?.dispose();
    experience = null;
    container = null;
    audioActive = false;
    audioSource = null;
    if (capturedVideoModulePromise) {
      void capturedVideoModulePromise.then(
        ({ clearMilkdropCapturedVideoStream }) =>
          clearMilkdropCapturedVideoStream(),
      );
    }
    setCurrentToy(null);
    setAudioActive(false, null);
    emit();
  };

  return {
    isMounted() {
      return Boolean(runtime && experience && container);
    },

    getVideoExportRuntime() {
      return runtime?.toy.renderer ? videoExportRuntime : null;
    },

    async mount(nextContainer: HTMLElement, intent: LaunchIntent) {
      disposeRuntime();

      const myToken = ++mountToken;
      container = nextContainer;
      if (intent.collectionTag) {
        requestMilkdropCollectionSelection(intent.collectionTag);
      }

      const { createMilkdropExperience, createToyRuntimeStarter } =
        await loadRuntimeFactories();
      if (myToken !== mountToken || !container) {
        return;
      }
      experience = createMilkdropExperience({
        quality,
        qualityControl: {
          presets: DEFAULT_QUALITY_PRESETS,
          storageKey: QUALITY_STORAGE_KEY,
        },
        initialPresetId: intent.presetId ?? undefined,
        previewMode: Boolean(intent.previewMode),
      });

      unsubscribeExperience = experience.subscribe(() => {
        emit();
      });

      const startRuntime = createToyRuntimeStarter({
        toyOptions: {
          cameraOptions: { position: { x: 0, y: 0, z: 5 } },
          rendererOptions: {
            antialias: false,
            preserveDrawingBuffer: intent.agentMode,
          },
        },
        audio: {
          fftSize: 1024,
          options: {
            onStreamEnded: handleAudioStreamEnded,
          },
        },
        plugins: [
          {
            name: 'milkdrop-experience',
            setup: (runtimeInstance) => {
              runtime = runtimeInstance;
              experience?.attachRuntime(runtimeInstance);
              setCurrentToy('milkdrop');
              emit();
            },
            update: (frame) => {
              experience?.update(frame);
            },
            dispose: () => {
              experience?.dispose();
            },
          },
        ],
      });

      runtime = startRuntime({ container: nextContainer });
      setCurrentToy('milkdrop');

      if (intent.agentMode && typeof window !== 'undefined') {
        window.__STIMS_AGENT_RENDER_FRAMES__ = (options) =>
          runtime?.renderFrames?.(options) ?? null;
        window.__STIMS_AGENT_FREEZE_RENDERING__ = () => {
          runtime?.freezeRendering?.();
        };
      }

      if (intent.collectionTag) {
        experience.setActiveCollectionTag(intent.collectionTag);
      }
      if (intent.panel) {
        // openTab is a no-op the runtime keeps only so the experience surface
        // stays uniform — the shell owns panel routing. Its hand-written tab
        // union has drifted from PanelState more than once, so narrow here
        // rather than keep widening it there.
        experience.openTab(
          intent.panel as Parameters<typeof experience.openTab>[0],
        );
      }

      emit();
    },

    dispose() {
      disposeRuntime();
      subscribers.clear();
    },

    pausePreview() {
      if (!audioActive && runtime?.pausePreview) {
        runtime.pausePreview();
      }
    },

    resumePreview() {
      if (runtime?.resumePreview) {
        runtime.resumePreview();
      }
    },

    async loadPreset(presetId: string) {
      if (!experience) {
        throw new Error('MilkDrop engine session is not mounted.');
      }
      if (runtime?.resumePreview) {
        runtime.resumePreview();
      }
      await experience.selectPreset(presetId);
      emit();
    },

    async goBackPreset() {
      if (!experience) {
        throw new Error('MilkDrop engine session is not mounted.');
      }
      if (runtime?.resumePreview) {
        runtime.resumePreview();
      }
      await experience.goBackPreset();
      emit();
    },

    async setAudioSource(request: EngineAudioRequest) {
      if (audioActive && audioSource === request.source) {
        return;
      }

      const activeRuntime = runtime ?? (await waitForRuntime(() => runtime));
      if (!activeRuntime) {
        throw new Error('MilkDrop runtime is not mounted yet.');
      }

      if (request.source === 'demo') {
        if (capturedVideoModulePromise) {
          const { clearMilkdropCapturedVideoStream } =
            await loadCapturedVideoModule();
          clearMilkdropCapturedVideoStream();
        }
        await activeRuntime.startAudio('sample');
        audioActive = true;
        audioSource = 'demo';
        setAudioActive(true, 'demo');
        emit();
        return;
      }

      if (request.source === 'file') {
        if (capturedVideoModulePromise) {
          const { clearMilkdropCapturedVideoStream } =
            await loadCapturedVideoModule();
          clearMilkdropCapturedVideoStream();
        }
        await activeRuntime.startAudio({ stream: request.stream });
        audioActive = true;
        audioSource = 'file';
        setAudioActive(true, 'file');
        emit();
        return;
      }

      if (request.source === 'microphone') {
        if (capturedVideoModulePromise) {
          const { clearMilkdropCapturedVideoStream } =
            await loadCapturedVideoModule();
          clearMilkdropCapturedVideoStream();
        }
        await activeRuntime.startAudio(
          request.stream
            ? {
                stream: request.stream,
                stopStreamOnCleanup: true,
              }
            : 'microphone',
        );
        audioActive = true;
        audioSource = 'microphone';
        setAudioActive(true, 'microphone');
        emit();
        return;
      }

      const { setMilkdropCapturedVideoStream } =
        await loadCapturedVideoModule();
      await setMilkdropCapturedVideoStream(request.stream, {
        cropTarget: request.cropTarget ?? container,
      });
      await activeRuntime.startAudio({ stream: request.stream });
      audioActive = true;
      audioSource = request.source;
      setAudioActive(true, request.source);
      emit();
    },

    async stopAudio() {
      await performStopAudio();
    },

    openTool(tool: 'browse' | 'editor' | 'inspector') {
      experience?.openTab(tool);
      emit();
    },

    setOverlayOpen(open: boolean) {
      experience?.setOverlayOpen(open);
      emit();
    },

    setCollectionTag(collectionTag: string | null) {
      if (!collectionTag) {
        return;
      }
      experience?.setActiveCollectionTag(collectionTag);
      emit();
    },

    setQualityPreset(presetId: string) {
      return experience?.setQualityPreset(presetId) ?? null;
    },

    setAutoplay(enabled: boolean) {
      experience?.setAutoplay(enabled);
      emit();
    },

    setTransitionMode(mode: 'blend' | 'cut') {
      experience?.setTransitionMode(mode);
      emit();
    },

    /** Arms the next preset switch to be crossfaded by hand. Applies to that
     * one switch; see the runtime for the outgoing-side limitation. */
    startManualCrossfade() {
      experience?.startManualCrossfade();
    },

    setCrossfade(position: number) {
      experience?.setCrossfade(position);
    },

    getCrossfade(): number | null {
      return experience?.getCrossfade() ?? null;
    },

    setBlendDuration(value: number) {
      experience?.setBlendDuration(value);
      emit();
    },

    updateEditorSource(source: string) {
      experience?.updateEditorSource(source);
    },

    /** Applies source and resolves with the resulting compile, so callers can
     * report real diagnostics instead of assuming success. */
    async applyEditorSourceAwaited(source: string) {
      return (await experience?.applyEditorSourceAwaited(source)) ?? null;
    },

    /** Applies a group of fields in one commit and resolves with the result. */
    async applyEditorFieldsAwaited(updates: Record<string, string | number>) {
      return (await experience?.applyEditorFieldsAwaited(updates)) ?? null;
    },

    getEditorSessionState() {
      return experience?.getEditorSessionState() ?? null;
    },

    updateInspectorField(key: string, value: number) {
      experience?.updateInspectorField?.(key, value);
    },

    /** Applies a field to the running VM without a recompile, for instant
     * drag feedback. The editor commits the value to the source on release. */
    updateFieldLive(key: string, value: number) {
      experience?.setLiveField?.(key, value);
    },

    /** Read-only debug accessor for the active preset's compiled IR. */
    getActiveCompiledPreset() {
      return experience?.getActiveCompiledPreset() ?? null;
    },

    async importPreset(target: FileList | File[] | string) {
      if (!experience) {
        return;
      }
      await experience.importPresetFiles(toFileList(target));
      emit();
    },

    exportPreset() {
      experience?.exportPreset();
    },

    revertEditorSource() {
      experience?.revertEditorSource();
    },

    async duplicatePreset() {
      await experience?.duplicatePreset();
      emit();
    },

    async deleteActivePreset() {
      await experience?.deleteActivePreset();
      emit();
    },

    getSnapshot() {
      return lastSnapshot;
    },

    /** Frame-fresh audio levels; null before the engine mounts. */
    getAudioLevels() {
      return experience?.getAudioLevels() ?? null;
    },

    getDiagnostics() {
      return {
        snapshot: lastSnapshot,
        runtime:
          typeof window !== 'undefined'
            ? (window.stimState?.getDebugSnapshot('milkdrop') ?? null)
            : null,
      };
    },

    subscribe(listener: (snapshot: EngineSnapshot) => void) {
      subscribers.add(listener);
      listener(lastSnapshot);
      return () => {
        subscribers.delete(listener);
      };
    },
  };
}
