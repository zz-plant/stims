import type {
  MilkdropDiagnostic,
  MilkdropPresetSource,
} from 'milkdrop-toolchain/src/common-types.ts';
import type { MilkdropCompiledPreset } from 'milkdrop-toolchain/src/compiler-types.ts';
import type { MilkdropShaderExecutionMode } from 'milkdrop-toolchain/src/shader-execution-mode.ts';
import type { AdaptiveQualityState } from '../core/services/adaptive-quality-controller.ts';
import type { MilkdropCatalogEntry } from './catalog-types.ts';

/**
 * The per-frame signal environment a host feeds to compiled presets. Defined
 * by the toolchain, which types its WGSL uniform block from it.
 */
export type { MilkdropRuntimeSignals } from 'milkdrop-toolchain/src/runtime-signals.ts';

export type MilkdropCapturedVideoReactiveState = {
  bassPulse: number;
  midMotion: number;
  trebleShimmer: number;
  energyWash: number;
  beatAccent: number;
  overlayAmount: number;
  warpAmount: number;
  mixAlphaFloor: number;
  textureScaleX: number;
  textureScaleY: number;
  textureOffsetX: number;
  textureOffsetY: number;
  warpScaleX: number;
  warpScaleY: number;
  warpOffsetX: number;
  warpOffsetY: number;
  overlayWidthScale: number;
  overlayHeightScale: number;
  overlayDriftX: number;
  overlayDriftY: number;
  overlayRotation: number;
  baseOpacity: number;
  ghostOpacity: number;
  ghostOffsetX: number;
  ghostOffsetY: number;
};

export type MilkdropEditorSessionState = {
  source: string;
  latestCompiled: MilkdropCompiledPreset | null;
  activeCompiled: MilkdropCompiledPreset | null;
  diagnostics: MilkdropDiagnostic[];
  dirty: boolean;
};

/** A commit either landed, or was superseded by a newer edit or preset load
 * (or aborted) while it compiled, in which case `state` is whatever is
 * current and says nothing about the source that was sent. */
export type MilkdropEditorCommitOutcome = {
  state: MilkdropEditorSessionState;
  applied: boolean;
};

export interface MilkdropEditorSession {
  getState(): MilkdropEditorSessionState;
  loadPreset(source: MilkdropPresetSource): Promise<MilkdropEditorSessionState>;
  applySource(source: string): Promise<MilkdropEditorSessionState>;
  updateField(
    key: string,
    value: string | number,
  ): Promise<MilkdropEditorSessionState>;
  /** Applies a group of fields against the newest pending source, so edits
   * issued while a compile is still running stack instead of overwriting
   * each other. */
  updateFields(
    updates: Record<string, string | number>,
  ): Promise<MilkdropEditorSessionState>;
  /** `applySource`, saying whether this source is the one that committed. */
  applySourceWithOutcome(source: string): Promise<MilkdropEditorCommitOutcome>;
  /** `updateFields`, saying whether these fields are the ones that committed. */
  updateFieldsWithOutcome(
    updates: Record<string, string | number>,
  ): Promise<MilkdropEditorCommitOutcome>;
  subscribe(listener: (state: MilkdropEditorSessionState) => void): () => void;
  dispose(): void;
}

export interface MilkdropEditorCompiler {
  compile(
    source: string,
    preset: Partial<MilkdropPresetSource>,
    options?: { cacheCompile?: boolean },
  ): Promise<MilkdropCompiledPreset>;
  /**
   * Mirrors the main thread's `shaderBranchDesugar` session flag into the
   * worker. The flag is a module-level boolean, so a worker — its own module
   * instance — defaults to `false` no matter what the page resolved, and every
   * preset it compiles carries the wrong backend classification. The session
   * calls this before the worker's first compile and again whenever the value
   * drifts.
   */
  setShaderBranchDesugar(enabled: boolean): Promise<void>;
}

/**
 * The snapshot the experience controller publishes for the shell to read.
 * This is the engine ↔ shell seam contract: it is declared here so the shell
 * can name it directly instead of chaining `ReturnType` through the adapter,
 * which ends in `any`. A field renamed or removed in the engine must now fail
 * to compile in the shell instead of silently vanishing at runtime.
 *
 * Concrete field types resolve the engine's own `ReturnType<...>` references
 * (catalog coordinator entries, editor session state) to their named types so
 * this lives at module scope rather than inside the factory that builds it.
 */
export interface MilkdropExperienceSnapshot {
  activePresetId: string | null;
  backend: 'webgl' | 'webgpu';
  status: string | null;
  adaptiveQuality: AdaptiveQualityState | null;
  catalogEntries: MilkdropCatalogEntry[];
  sessionState: MilkdropEditorSessionState;
  audioEnergy: number;
  audioBass: number;
  audioMid: number;
  audioTreble: number;
  /**
   * Estimated tempo, already adjudicated: a whole number of BPM when the
   * beat clock is confident, null otherwise.
   */
  tempoBpm: number | null;
  /** How the active preset's shader reaches the screen on the active backend. */
  shaderExecution: MilkdropShaderExecutionMode | null;
  autoplay: boolean;
  transitionMode: 'blend' | 'cut';
  blendDuration: number;
}

/**
 * The public surface of a running milkdrop experience, as seen by the shell.
 * Mirrors the object `buildExperienceController` returns in `runtime.ts`.
 * Declared so the shell depends on a contract it can name — and swap or mock
 * against — rather than an inferred `ReturnType<...>` that reads as `any`.
 */
export interface MilkdropExperienceController {
  subscribe(
    listener: (snapshot: MilkdropExperienceSnapshot) => void,
  ): () => void;
  getStateSnapshot(): MilkdropExperienceSnapshot;
  getAudioLevels(): {
    energy: number;
    bass: number;
    mid: number;
    treble: number;
  };
  applyFields(updates: unknown): unknown;
  getActiveCompiledPreset(): MilkdropCompiledPreset | null;
  getActivePresetId(): string | null;
  selectPreset(module: unknown, options?: unknown): Promise<unknown>;
  goBackPreset(): Promise<unknown>;
  setActiveCollectionTag(collectionTag: string | null): void;
  openTab(
    tab: 'browse' | 'editor' | 'inspector' | 'refine' | 'finder' | 'blend',
  ): void;
  setOverlayOpen(open: boolean): void;
  getAutoplay(): boolean;
  setAutoplay(enabled: boolean): void;
  getTransitionMode(): 'blend' | 'cut';
  setTransitionMode(mode: 'blend' | 'cut'): void;
  startManualCrossfade(): void;
  setCrossfade(position: number): void;
  getCrossfade(): number | null;
  getBlendDuration(): number;
  setBlendDuration(value: number): void;
  importPresetFiles(files: FileList | File[]): Promise<void>;
  exportPreset(): void;
  exportUserPresets(): Promise<number>;
  resizeForVideoExport(width: number, height: number): void;
  duplicatePreset(): Promise<void>;
  deleteActivePreset(): Promise<void>;
  applyEditorSourceAwaited(source: string): Promise<MilkdropEditorSessionState>;
  applyEditorFieldsAwaited(
    updates: Record<string, string | number>,
  ): Promise<MilkdropEditorSessionState>;
  getEditorSessionState(): MilkdropEditorSessionState;
  updateEditorSource(source: string): void;
  getOriginalPresetSource(): Promise<string | null>;
  updateInspectorField(key: string, value: string | number): void;
  setLiveField(key: string, value: number): void;
  setQualityPreset(presetId: string): unknown;
  setStatus(message: string): void;
  attachRuntime(nextRuntime: unknown): unknown;
  update(frame: unknown, options?: unknown): void;
  dispose(): void;
}

/** Dependencies the experience controller builder is wired with. Typed in
 * step 2 of the seam migration; declared here so the builder can adopt it.
 * The catch-all access is kept deliberately loose until then. */
// biome-ignore lint/suspicious/noExplicitAny: builder pattern bundles runtime delegates
export type ExperienceControllerDeps = Record<string, any>;
