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
    ]).then(([runtimeModule, starterModule]) => ({
      createMilkdropExperience: runtimeModule.createMilkdropExperience,
      createToyRuntimeStarter: starterModule.createToyRuntimeStarter,
    }));
  }

  return runtimeFactoriesPromise;
};

const loadCapturedVideoModule = () => {
  if (!capturedVideoModulePromise) {
    capturedVideoModulePromise = import(
      '../../core/services/captured-video-texture.ts'
    );
  }

  return capturedVideoModulePromise;
};

export function createMilkdropEngineAdapter() {
  let container: HTMLElement | null = null;
  let runtime: ToyRuntimeInstance | null = null;
  let experience: ExperienceController | null = null;
  let audioActive = false;
  let audioSource: AudioSource | null = null;
  let unsubscribeExperience: (() => void) | null = null;
  let lastSnapshot: EngineSnapshot = createEmptyEngineSnapshot();
  const subscribers = new Set<(snapshot: EngineSnapshot) => void>();

  const quality = createRendererQualityManager({
    presets: DEFAULT_QUALITY_PRESETS,
    defaultPresetId: 'balanced',
    storageKey: QUALITY_STORAGE_KEY,
    getRuntime: () => runtime,
  });

  const emit = () => {
    lastSnapshot = buildEngineSnapshot({
      experience,
      runtime,
      audioActive,
      audioSource,
    });
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

    async mount(nextContainer: HTMLElement, intent: LaunchIntent) {
      disposeRuntime();

      container = nextContainer;
      if (intent.collectionTag) {
        requestMilkdropCollectionSelection(intent.collectionTag);
      }

      const { createMilkdropExperience, createToyRuntimeStarter } =
        await loadRuntimeFactories();
      experience = createMilkdropExperience({
        container: nextContainer,
        quality,
        qualityControl: {
          presets: DEFAULT_QUALITY_PRESETS,
          storageKey: QUALITY_STORAGE_KEY,
        },
        initialPresetId: intent.presetId ?? undefined,
        showOverlayToggle: false,
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

      if (request.source === 'microphone') {
        if (capturedVideoModulePromise) {
          const { clearMilkdropCapturedVideoStream } =
            await loadCapturedVideoModule();
          clearMilkdropCapturedVideoStream();
        }
        await activeRuntime.startAudio('microphone');
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
