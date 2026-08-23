import type { ToyRuntimeInstance } from '../../core/toy-runtime.ts';
import type { createMilkdropExperience } from '../../milkdrop/runtime.ts';
import type { MilkdropShaderExecutionMode } from '../../milkdrop/shader-execution-mode.ts';
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
  currentSource: string;
  runtimeReady: boolean;
  audioActive: boolean;
  audioSource: AudioSource | null;
  audioEnergy: number;
  audioBass: number;
  audioMid: number;
  audioTreble: number;
  /**
   * Timestamp (`Date.now()`) of the most recent unexpected audio stream
   * termination (mic revoked, tab/display share or YouTube capture
   * stopped from the browser's native UI, device unplugged). `null` until
   * the first occurrence. Consumers should key off changes to this value
   * (not truthiness) since it never resets back to `null`.
   */
  audioEndedAt: number | null;
  /** Whole-number tempo of the playing audio, or null when the runtime's
   * beat clock has no confident read. Null is the honest answer for ambient
   * material and must render as "no tempo", never as the last number that
   * worked. */
  tempoBpm: number | null;
  /**
   * How the active preset's shader text reaches the screen on the active
   * backend: 'direct' is as authored, 'translated'/'unsupported' mean the
   * renderer is substituting a uniform-only approximation, 'none' means the
   * preset has no shader text. Null before a preset is compiled — "not known
   * yet", never "fine". See milkdrop/shader-execution-mode.ts.
   */
  shaderExecution: MilkdropShaderExecutionMode | null;
  autoplay: boolean;
  transitionMode: 'blend' | 'cut';
  blendDuration: number;
};

export function createEmptyEngineSnapshot(): EngineSnapshot {
  return {
    activePresetId: null,
    backend: null,
    status: null,
    adaptiveQuality: null,
    catalogEntries: [],
    sessionState: null,
    currentSource: '',
    runtimeReady: false,
    audioActive: false,
    audioSource: null,
    audioEnergy: 0,
    audioBass: 0,
    audioMid: 0,
    audioTreble: 0,
    audioEndedAt: null,
    tempoBpm: null,
    shaderExecution: null,
    autoplay: false,
    transitionMode: 'blend',
    blendDuration: 0.3,
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
    a.currentSource === b.currentSource &&
    a.runtimeReady === b.runtimeReady &&
    a.audioActive === b.audioActive &&
    a.audioSource === b.audioSource &&
    a.audioEnergy === b.audioEnergy &&
    a.audioBass === b.audioBass &&
    a.audioMid === b.audioMid &&
    a.audioTreble === b.audioTreble &&
    a.audioEndedAt === b.audioEndedAt &&
    a.tempoBpm === b.tempoBpm &&
    a.shaderExecution === b.shaderExecution &&
    a.autoplay === b.autoplay &&
    a.transitionMode === b.transitionMode &&
    a.blendDuration === b.blendDuration
  );
}

export function buildEngineSnapshot({
  experience,
  runtime,
  audioActive,
  audioSource,
  audioEndedAt,
  previousSnapshot,
}: {
  experience: ExperienceController | null;
  runtime: ToyRuntimeInstance | null;
  audioActive: boolean;
  audioSource: AudioSource | null;
  audioEndedAt?: number | null;
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
    currentSource: snapshot?.sessionState?.source ?? '',
    runtimeReady: Boolean(runtime),
    audioActive,
    audioSource,
    audioEnergy: snapshot?.audioEnergy ?? 0,
    audioBass: snapshot?.audioBass ?? 0,
    audioMid: snapshot?.audioMid ?? 0,
    audioTreble: snapshot?.audioTreble ?? 0,
    audioEndedAt: audioEndedAt ?? null,
    tempoBpm: snapshot?.tempoBpm ?? null,
    shaderExecution: snapshot?.shaderExecution ?? null,
    autoplay: snapshot?.autoplay ?? false,
    transitionMode: snapshot?.transitionMode ?? 'blend',
    blendDuration: snapshot?.blendDuration ?? 0.3,
  };
  if (previousSnapshot && shallowEqual(next, previousSnapshot)) {
    return previousSnapshot;
  }
  return next;
}
