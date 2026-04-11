import type { ToyRuntimeInstance } from '../../core/toy-runtime.ts';
import type { createMilkdropExperience } from '../../milkdrop/runtime.ts';
import type { AudioSource } from '../contracts.ts';

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

export function createEmptyEngineSnapshot(): EngineSnapshot {
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

export function buildEngineSnapshot({
  experience,
  runtime,
  audioActive,
  audioSource,
}: {
  experience: ExperienceController | null;
  runtime: ToyRuntimeInstance | null;
  audioActive: boolean;
  audioSource: AudioSource | null;
}): EngineSnapshot {
  const snapshot = experience?.getStateSnapshot();
  return {
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
}
