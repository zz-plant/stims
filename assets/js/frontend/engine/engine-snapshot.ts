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
  audioEnergy: number;
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
    audioEnergy: 0,
  };
}

function shallowEqual(a: EngineSnapshot, b: EngineSnapshot): boolean {
  if (a === b) return true;
  return (
    a.activePresetId === b.activePresetId &&
    a.backend === b.backend &&
    a.status === b.status &&
    a.adaptiveQuality === b.adaptiveQuality &&
    a.catalogEntries === b.catalogEntries &&
    a.sessionState === b.sessionState &&
    a.runtimeReady === b.runtimeReady &&
    a.audioActive === b.audioActive &&
    a.audioSource === b.audioSource &&
    a.audioEnergy === b.audioEnergy
  );
}

export function buildEngineSnapshot({
  experience,
  runtime,
  audioActive,
  audioSource,
  previousSnapshot,
}: {
  experience: ExperienceController | null;
  runtime: ToyRuntimeInstance | null;
  audioActive: boolean;
  audioSource: AudioSource | null;
  previousSnapshot?: EngineSnapshot | null;
}): EngineSnapshot {
  const snapshot = experience?.getStateSnapshot();
  const next: EngineSnapshot = {
    activePresetId: snapshot?.activePresetId ?? null,
    backend: snapshot?.backend ?? null,
    status: snapshot?.status ?? null,
    adaptiveQuality: snapshot?.adaptiveQuality ?? null,
    catalogEntries: snapshot?.catalogEntries ?? [],
    sessionState: snapshot?.sessionState ?? null,
    runtimeReady: Boolean(runtime),
    audioActive,
    audioSource,
    audioEnergy: snapshot?.audioEnergy ?? 0,
  };
  if (previousSnapshot && shallowEqual(next, previousSnapshot)) {
    return previousSnapshot;
  }
  return next;
}
