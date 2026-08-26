import type {
  MilkdropDiagnostic,
  MilkdropPresetSource,
} from './common-types.ts';
import type { MilkdropCompiledPreset } from './compiler-types.ts';

export type MilkdropRuntimeSignals = {
  time: number;
  deltaMs: number;
  frame: number;
  fps: number;
  /**
   * When true, the preset-facing `time` and `frame` signals are pinned to
   * their lock-onset values while the internal audio-analysis clock keeps
   * running. This is the "relationship lock" for docs/SENSORY_ACCESSIBILITY.md
   * Layer 2 Q1: the audio->visual mapping (time/frame-driven terms) stays put
   * while audio still drives output. The VM's env-sync cache must be bypassed
   * while this is set — see MilkdropPresetVM.prepareSignalEnv.
   */
  relationshipLock?: boolean;
  aspect?: number;
  aspectx?: number;
  aspecty?: number;
  pixelsx?: number;
  pixelsy?: number;
  bass: number;
  mid: number;
  mids: number;
  treb: number;
  treble: number;
  bassAtt: number;
  midAtt: number;
  midsAtt: number;
  trebleAtt: number;
  bass_att: number;
  mid_att: number;
  mids_att: number;
  treb_att: number;
  treble_att: number;
  rms: number;
  vol: number;
  music: number;
  beat: number;
  beatPulse: number;
  beat_pulse: number;
  transient: number;
  spectralFlux: number;
  bandFlux: number;
  beatBass: number;
  beatMid: number;
  beatTreble: number;
  beat_bass: number;
  beat_mid: number;
  beat_treb?: number;
  beat_treble?: number;
  weightedEnergy: number;
  /**
   * Harmonic/percussive decomposition (median-filter HPSS over the
   * spectrogram). These measure how transient/broadband versus
   * sustained/tonal the spectrum is — they are NOT isolated instrument stems.
   * Energies use the same relative scale as `bass`/`mid`/`treb` (1.0 = this
   * track's own average); `percussiveRatio` is an absolute 0..1 fraction.
   */
  percussive?: number;
  harmonic?: number;
  percussiveLow?: number;
  percussiveMid?: number;
  percussiveHigh?: number;
  percussiveRatio?: number;
  percussive_low?: number;
  percussive_mid?: number;
  percussive_high?: number;
  percussive_ratio?: number;
  inputX: number;
  inputY: number;
  input_x: number;
  input_y: number;
  inputDx: number;
  inputDy: number;
  input_dx: number;
  input_dy: number;
  inputSpeed: number;
  input_speed: number;
  inputPressed: number;
  input_pressed: number;
  inputJustPressed: number;
  input_just_pressed: number;
  inputJustReleased: number;
  input_just_released: number;
  inputCount: number;
  input_count: number;
  gestureScale: number;
  gesture_scale: number;
  gestureRotation: number;
  gesture_rotation: number;
  gestureTranslateX: number;
  gestureTranslateY: number;
  gesture_translate_x: number;
  gesture_translate_y: number;
  hoverActive: number;
  hover_active: number;
  hoverX: number;
  hoverY: number;
  hover_x: number;
  hover_y: number;
  wheelDelta: number;
  wheel_delta: number;
  wheelAccum: number;
  wheel_accum: number;
  dragIntensity: number;
  drag_intensity: number;
  dragAngle: number;
  drag_angle: number;
  accentPulse: number;
  accent_pulse: number;
  actionAccent: number;
  action_accent: number;
  actionModeNext: number;
  action_mode_next: number;
  actionModePrevious: number;
  action_mode_previous: number;
  actionPresetNext: number;
  action_preset_next: number;
  actionPresetPrevious: number;
  action_preset_previous: number;
  actionQuickLook1: number;
  action_quick_look_1: number;
  actionQuickLook2: number;
  action_quick_look_2: number;
  actionQuickLook3: number;
  action_quick_look_3: number;
  actionRemix: number;
  action_remix: number;
  inputSourcePointer: number;
  input_source_pointer: number;
  inputSourceKeyboard: number;
  input_source_keyboard: number;
  inputSourceGamepad: number;
  input_source_gamepad: number;
  inputSourceMouse: number;
  input_source_mouse: number;
  inputSourceTouch: number;
  input_source_touch: number;
  inputSourcePen: number;
  input_source_pen: number;
  motionX: number;
  motionY: number;
  motionZ: number;
  motion_x: number;
  motion_y: number;
  motion_z: number;
  motionEnabled: number;
  motion_enabled: number;
  motionStrength: number;
  motion_strength: number;
  frequencyData: Uint8Array;
  waveformData?: Uint8Array;
  frequencyDataL?: Uint8Array | null;
  frequencyDataR?: Uint8Array | null;
  waveformDataL?: Uint8Array | null;
  waveformDataR?: Uint8Array | null;
  // Float PCM in [-1, 1] with the same AGC gain as the byte waveform
  // buffers; preferred by the wave renderer to avoid byte quantization.
  waveformFloatData?: Float32Array | null;
  waveformFloatDataL?: Float32Array | null;
  waveformFloatDataR?: Float32Array | null;
};

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
  resetToActive(): Promise<MilkdropEditorSessionState>;
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
