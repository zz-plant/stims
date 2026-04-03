import { setAudioActive, setCurrentToy } from '../../core/agent-api.ts';
import {
  clearMilkdropCapturedVideoStream,
  setMilkdropCapturedVideoStream,
} from '../../core/services/captured-video-texture.ts';
import {
  DEFAULT_QUALITY_PRESETS,
  QUALITY_STORAGE_KEY,
} from '../../core/settings-panel.ts';
import { createRendererQualityManager } from '../../core/toy-quality.ts';
import type { ToyRuntimeInstance } from '../../core/toy-runtime.ts';
import { createToyRuntimeStarter } from '../../core/toy-runtime-starter.ts';
import { requestMilkdropCollectionSelection } from '../../milkdrop/collection-intent.ts';
import { createMilkdropExperience } from '../../milkdrop/runtime.ts';
import type {
  AudioSource,
  EngineAudioRequest,
  LaunchIntent,
} from '../contracts.ts';

type ExperienceController = ReturnType<typeof createMilkdropExperience>;
type ExperienceSnapshot = ReturnType<ExperienceController['getStateSnapshot']>;

export type EngineSnapshot = {
  activePresetId: string | null;
  backend: 'webgl' | 'webgpu' | null;
  status: string | null;
  adaptiveQuality: ExperienceSnapshot['adaptiveQuality'] | null;
  catalogEntries: ExperienceSnapshot['catalogEntries'];
  sessionState: ExperienceSnapshot['sessionState'] | null;
  runtimeReady: boolean;
  audioActive: boolean;
  audioSource: AudioSource | null;
};

function createEmptySnapshot(): EngineSnapshot {
  return {
    activePresetId: null,
    backend: null,
    status: null,
    adaptiveQuality: null,
    catalogEntries: [],
    sessionState: null,
    runtimeReady: false,
    audioActive: false,
    audioSource: null,
  };
}

async function waitForRuntime(
  getRuntime: () => ToyRuntimeInstance | null,
  { attempts = 80, delayMs = 50 }: { attempts?: number; delayMs?: number } = {},
) {
  let currentRuntime = getRuntime();
  if (currentRuntime) {
    return currentRuntime;
  }

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    currentRuntime = getRuntime();
    if (currentRuntime) {
      return currentRuntime;
    }
  }

  return null;
}

function toFileList(target: FileList | File[] | string) {
  if (typeof target !== 'string' && 'length' in target && 'item' in target) {
    return target;
  }

  const transfer = new DataTransfer();
  if (typeof target === 'string') {
    transfer.items.add(new File([target], 'imported-preset.milk'));
  } else {
    target.forEach((file) => transfer.items.add(file));
  }
  return transfer.files;
}

export function createMilkdropEngineAdapter() {
  let container: HTMLElement | null = null;
  let runtime: ToyRuntimeInstance | null = null;
  let experience: ExperienceController | null = null;
  let audioActive = false;
  let audioSource: AudioSource | null = null;
  let unsubscribeExperience: (() => void) | null = null;
  let lastSnapshot = createEmptySnapshot();
  const subscribers = new Set<(snapshot: EngineSnapshot) => void>();

  const quality = createRendererQualityManager({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: 'balanced',
    storageKey: QUALITY_STORAGE_KEY,
    getRuntime: () => runtime,
  });

  const emit = () => {
    const snapshot = experience?.getStateSnapshot();
    lastSnapshot = {
      activePresetId: snapshot?.activePresetId ?? null,
      backend: snapshot?.backend ?? null,
      status: snapshot?.status ?? null,
      adaptiveQuality: snapshot?.adaptiveQuality ?? null,
      catalogEntries: snapshot?.catalogEntries ?? [],
      sessionState: snapshot?.sessionState ?? null,
      runtimeReady: Boolean(runtime),
      audioActive,
      audioSource,
    };
    subscribers.forEach((subscriber) => subscriber(lastSnapshot));
  };

  const disposeRuntime = () => {
    unsubscribeExperience?.();
    unsubscribeExperience = null;
    runtime?.dispose();
    runtime = null;
    experience = null;
    container = null;
    audioActive = false;
    audioSource = null;
    clearMilkdropCapturedVideoStream();
    setCurrentToy(null);
    setAudioActive(false, null);
    emit();
  };

  return {
    isMounted() {
      return Boolean(runtime && experience && container);
    },

    async mount(nextContainer: HTMLElement, intent: LaunchIntent) {
      disposeRuntime();

      container = nextContainer;
      if (intent.collectionTag) {
        requestMilkdropCollectionSelection(intent.collectionTag);
      }

      experience = createMilkdropExperience({
        container: nextContainer,
        quality,
        qualityControl: {
          presets: DEFAULT_QUALITY_PRESETS,
          storageKey: QUALITY_STORAGE_KEY,
        },
        initialPresetId: intent.presetId ?? undefined,
      });

      unsubscribeExperience = experience.subscribe(() => {
        emit();
      });

      const startRuntime = createToyRuntimeStarter({
        toyOptions: {
          cameraOptions: { position: { x: 0, y: 0, z: 5 } },
          rendererOptions: { antialias: false },
        },
        audio: {
          fftSize: 512,
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

      if (intent.collectionTag) {
        experience.setActiveCollectionTag(intent.collectionTag);
      }
      if (intent.panel) {
        experience.openTab(intent.panel);
      }

      emit();
    },

    dispose() {
      disposeRuntime();
      subscribers.clear();
    },

    async loadPreset(presetId: string) {
      if (!experience) {
        return;
      }
      await experience.selectPreset(presetId);
      emit();
    },

    async setAudioSource(request: EngineAudioRequest) {
      const activeRuntime = runtime ?? (await waitForRuntime(() => runtime));
      if (!activeRuntime) {
        throw new Error('MilkDrop runtime is not mounted yet.');
      }

      if (request.source === 'demo') {
        clearMilkdropCapturedVideoStream();
        await activeRuntime.startAudio('sample');
        audioActive = true;
        audioSource = 'demo';
        setAudioActive(true, 'demo');
        emit();
        return;
      }

      if (request.source === 'microphone') {
        clearMilkdropCapturedVideoStream();
        await activeRuntime.startAudio('microphone');
        audioActive = true;
        audioSource = 'microphone';
        setAudioActive(true, 'microphone');
        emit();
        return;
      }

      await setMilkdropCapturedVideoStream(request.stream, {
        cropTarget: request.cropTarget ?? container,
      });
      await activeRuntime.startAudio({ stream: request.stream });
      audioActive = true;
      audioSource = request.source;
      setAudioActive(true, request.source);
      emit();
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

    getSnapshot() {
      return lastSnapshot;
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
