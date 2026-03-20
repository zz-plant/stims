import {
  clearDebugSnapshot,
  isAgentMode,
  setDebugSnapshot,
} from '../core/agent-api.ts';
import type { ShaderQuality } from '../core/performance-panel';
import {
  isCompatibilityModeEnabled,
  setCompatibilityMode,
} from '../core/render-preferences';
import type { ToyRuntimeFrame, ToyRuntimeInstance } from '../core/toy-runtime';
import type { QualityPresetManager } from '../utils/toy-settings';
import type { UnifiedInputState } from '../utils/unified-input';
import { createMilkdropCatalogStore } from './catalog-store';
import { compileMilkdropPresetSource } from './compiler';
import { createMilkdropEditorSession } from './editor-session';
import { upsertMilkdropFields } from './formatter';
import { MilkdropOverlay } from './overlay';
import {
  consumeRequestedMilkdropOverlayTab,
  MILKDROP_OVERLAY_TAB_EVENT,
  type MilkdropOverlayTab,
} from './overlay-intent';
import {
  consumeRequestedMilkdropPresetSelection,
  MILKDROP_PRESET_SELECTION_EVENT,
} from './preset-selection';
import { createMilkdropRendererAdapter } from './renderer-adapter';
import { createMilkdropSignalTracker } from './runtime-signals';
import type {
  MilkdropBlendState,
  MilkdropCatalogEntry,
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropPresetSource,
  MilkdropRuntimeSignals,
} from './types';
import { createMilkdropVM } from './vm';

const UI_PREFS_KEY = 'stims:milkdrop:ui';

type UiPrefs = {
  autoplay?: boolean;
  blendDuration?: number;
  transitionMode?: 'blend' | 'cut';
  lastPresetId?: string;
  fallbackNotice?: string;
};

const DEFAULT_PRESET_SOURCE = `title=Signal Bloom
author=Stims
description=Curated fallback preset used before the bundled catalog loads.

fRating=4
blend_duration=2.5
fDecay=0.93
zoom=1.02
rot=0.01
warp=0.14
wave_mode=0
wave_scale=1.08
wave_smoothing=0.72
wave_a=0.88
wave_r=0.35
wave_g=0.72
wave_b=1
wave_x=0.5
wave_y=0.52
wave_mystery=0.24
mesh_density=18
mesh_alpha=0.18
mesh_r=0.28
mesh_g=0.52
mesh_b=0.94
bg_r=0.02
bg_g=0.03
bg_b=0.06
bBrighten=1
video_echo_enabled=1
video_echo_alpha=0.18
video_echo_zoom=1.03
ob_size=0.02
ob_r=0.9
ob_g=0.95
ob_b=1
ob_a=0.76
shapecode_0_enabled=1
shapecode_0_sides=6
shapecode_0_x=0.5
shapecode_0_y=0.5
shapecode_0_rad=0.17
shapecode_0_ang=0
shapecode_0_a=0.18
shapecode_0_r=1
shapecode_0_g=0.48
shapecode_0_b=0.84
shapecode_0_border_a=0.9
shapecode_0_border_r=1
shapecode_0_border_g=0.78
shapecode_0_border_b=1
shapecode_0_additive=1
shapecode_0_thickoutline=1
wavecode_0_enabled=1
wavecode_0_samples=72
wavecode_0_spectrum=1
wavecode_0_additive=1
wavecode_0_r=0.92
wavecode_0_g=0.6
wavecode_0_b=1
wavecode_0_a=0.42

per_frame_1=zoom = 1.0 + bass_att * 0.08
per_frame_2=rot = rot + beat_pulse * 0.004
per_frame_3=wave_y = 0.5 + sin(time * 0.35) * 0.08
per_frame_4=shape_1_ang = shape_1_ang + 0.01 + treb_att * 0.01
per_frame_5=ob_size = 0.01 + beat_pulse * 0.02

per_pixel_1=warp = warp + sin(rad * 10 + time * 0.8) * 0.03
wave_0_per_frame1=a = 0.18 + bass_att * 0.36
wave_0_per_point1=y = y + sin(sample * pi * 12 + time) * 0.06
shape_0_per_frame1=rad = 0.14 + beat_pulse * 0.08
`;

function sanitizeRuntimeSignals(signals: MilkdropRuntimeSignals) {
  const { frequencyData: _frequencyData, ...rest } = signals;
  return rest;
}

export function getMilkdropDetailScale({
  backend,
  particleScale,
  particleBudget,
  shaderQuality = 'balanced',
}: {
  backend: 'webgl' | 'webgpu';
  particleScale?: number;
  particleBudget: number;
  shaderQuality?: ShaderQuality;
}) {
  const baseScale = (particleScale ?? 1) * particleBudget;
  const backendBoost = backend === 'webgpu' ? 1.55 : 1.1;
  const shaderQualityScale =
    shaderQuality === 'low' ? 0.72 : shaderQuality === 'high' ? 1.2 : 1;
  return Math.min(
    2,
    Math.max(0.5, baseScale * backendBoost * shaderQualityScale),
  );
}

export function buildMilkdropInputSignalOverrides(
  input: UnifiedInputState | null,
): Partial<MilkdropRuntimeSignals> {
  const gesture = input?.gesture;
  const performance = input?.performance;
  const sourceFlags = performance?.sourceFlags;
  const actions = performance?.actions;

  return {
    inputX: input?.normalizedCentroid.x ?? 0,
    inputY: input?.normalizedCentroid.y ?? 0,
    input_x: input?.normalizedCentroid.x ?? 0,
    input_y: input?.normalizedCentroid.y ?? 0,
    inputDx: input?.dragDelta.x ?? 0,
    inputDy: input?.dragDelta.y ?? 0,
    input_dx: input?.dragDelta.x ?? 0,
    input_dy: input?.dragDelta.y ?? 0,
    inputSpeed: Math.hypot(input?.dragDelta.x ?? 0, input?.dragDelta.y ?? 0),
    input_speed: Math.hypot(input?.dragDelta.x ?? 0, input?.dragDelta.y ?? 0),
    inputPressed: input?.isPressed ? 1 : 0,
    input_pressed: input?.isPressed ? 1 : 0,
    inputJustPressed: input?.justPressed ? 1 : 0,
    input_just_pressed: input?.justPressed ? 1 : 0,
    inputJustReleased: input?.justReleased ? 1 : 0,
    input_just_released: input?.justReleased ? 1 : 0,
    inputCount: input?.pointerCount ?? 0,
    input_count: input?.pointerCount ?? 0,
    gestureScale: gesture?.scale ?? 1,
    gesture_scale: gesture?.scale ?? 1,
    gestureRotation: gesture?.rotation ?? 0,
    gesture_rotation: gesture?.rotation ?? 0,
    gestureTranslateX: gesture?.translation.x ?? 0,
    gestureTranslateY: gesture?.translation.y ?? 0,
    gesture_translate_x: gesture?.translation.x ?? 0,
    gesture_translate_y: gesture?.translation.y ?? 0,
    hoverActive: performance?.hoverActive ? 1 : 0,
    hover_active: performance?.hoverActive ? 1 : 0,
    hoverX: performance?.hover?.x ?? 0,
    hoverY: performance?.hover?.y ?? 0,
    hover_x: performance?.hover?.x ?? 0,
    hover_y: performance?.hover?.y ?? 0,
    wheelDelta: performance?.wheelDelta ?? 0,
    wheel_delta: performance?.wheelDelta ?? 0,
    wheelAccum: performance?.wheelAccum ?? 0,
    wheel_accum: performance?.wheelAccum ?? 0,
    dragIntensity: performance?.dragIntensity ?? 0,
    drag_intensity: performance?.dragIntensity ?? 0,
    dragAngle: performance?.dragAngle ?? 0,
    drag_angle: performance?.dragAngle ?? 0,
    accentPulse: performance?.accentPulse ?? 0,
    accent_pulse: performance?.accentPulse ?? 0,
    actionAccent: actions?.accent ?? 0,
    action_accent: actions?.accent ?? 0,
    actionModeNext: actions?.modeNext ?? 0,
    action_mode_next: actions?.modeNext ?? 0,
    actionModePrevious: actions?.modePrevious ?? 0,
    action_mode_previous: actions?.modePrevious ?? 0,
    actionPresetNext: actions?.presetNext ?? 0,
    action_preset_next: actions?.presetNext ?? 0,
    actionPresetPrevious: actions?.presetPrevious ?? 0,
    action_preset_previous: actions?.presetPrevious ?? 0,
    actionQuickLook1: actions?.quickLook1 ?? 0,
    action_quick_look_1: actions?.quickLook1 ?? 0,
    actionQuickLook2: actions?.quickLook2 ?? 0,
    action_quick_look_2: actions?.quickLook2 ?? 0,
    actionQuickLook3: actions?.quickLook3 ?? 0,
    action_quick_look_3: actions?.quickLook3 ?? 0,
    actionRemix: actions?.remix ?? 0,
    action_remix: actions?.remix ?? 0,
    inputSourcePointer: sourceFlags?.pointer ? 1 : 0,
    input_source_pointer: sourceFlags?.pointer ? 1 : 0,
    inputSourceKeyboard: sourceFlags?.keyboard ? 1 : 0,
    input_source_keyboard: sourceFlags?.keyboard ? 1 : 0,
    inputSourceGamepad: sourceFlags?.gamepad ? 1 : 0,
    input_source_gamepad: sourceFlags?.gamepad ? 1 : 0,
    inputSourceMouse: sourceFlags?.mouse ? 1 : 0,
    input_source_mouse: sourceFlags?.mouse ? 1 : 0,
    inputSourceTouch: sourceFlags?.touch ? 1 : 0,
    input_source_touch: sourceFlags?.touch ? 1 : 0,
    inputSourcePen: sourceFlags?.pen ? 1 : 0,
    input_source_pen: sourceFlags?.pen ? 1 : 0,
  };
}

function buildAgentMilkdropDebugSnapshot({
  activePresetId,
  compiledPreset,
  frameState,
  status,
}: {
  activePresetId: string | null;
  compiledPreset: MilkdropCompiledPreset | null;
  frameState: MilkdropFrameState | null;
  status: string | null;
}) {
  if (!frameState) {
    return {
      activePresetId,
      status,
      frameState: null,
      title: compiledPreset?.title ?? null,
    };
  }

  return {
    activePresetId,
    status,
    title: compiledPreset?.title ?? frameState.title,
    frameState: {
      presetId: frameState.presetId,
      title: frameState.title,
      signals: sanitizeRuntimeSignals(frameState.signals),
      variables: frameState.variables,
      mainWave: frameState.mainWave,
      shapes: frameState.shapes,
      post: frameState.post,
    },
  };
}

function readUiPrefs(): UiPrefs {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    return raw ? (JSON.parse(raw) as UiPrefs) : {};
  } catch {
    return {};
  }
}

function writeUiPrefs(update: Partial<UiPrefs>) {
  const next = {
    ...readUiPrefs(),
    ...update,
  };
  try {
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(next));
  } catch {
    return;
  }
}

function downloadPresetFile(name: string, contents: string) {
  const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}.milk`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function cloneBlendState(
  frameState: MilkdropFrameState | null,
): MilkdropBlendState | null {
  if (!frameState) {
    return null;
  }
  const waveform = {
    ...frameState.mainWave,
    positions: [...frameState.mainWave.positions],
    color: { ...frameState.mainWave.color },
  };
  return {
    background: { ...frameState.background },
    waveform,
    mainWave: waveform,
    customWaves: frameState.customWaves.map((wave) => ({
      ...wave,
      positions: [...wave.positions],
      color: { ...wave.color },
    })),
    trails: frameState.trails.map((trail) => ({
      ...trail,
      positions: [...trail.positions],
      color: { ...trail.color },
    })),
    shapes: frameState.shapes.map((shape) => ({
      ...shape,
      color: { ...shape.color },
      secondaryColor: shape.secondaryColor ? { ...shape.secondaryColor } : null,
      borderColor: { ...shape.borderColor },
    })),
    borders: frameState.borders.map((border) => ({
      ...border,
      color: { ...border.color },
    })),
    motionVectors: frameState.motionVectors.map((vector) => ({
      ...vector,
      positions: [...vector.positions],
      color: { ...vector.color },
    })),
    post: { ...frameState.post },
    alpha: 1,
  };
}

function isEditablePreset(entry: MilkdropCatalogEntry | undefined | null) {
  return entry?.origin === 'imported' || entry?.origin === 'user';
}

export function createMilkdropExperience({
  container,
  quality,
  initialPresetId,
}: {
  container?: HTMLElement | null;
  quality: QualityPresetManager;
  initialPresetId?: string;
}) {
  const prefs = readUiPrefs();
  const catalogStore = createMilkdropCatalogStore();
  const defaultPreset = compileMilkdropPresetSource(DEFAULT_PRESET_SOURCE, {
    id: 'signal-bloom',
    title: 'Signal Bloom',
    origin: 'bundled',
    author: 'Stims',
  });
  const vm = createMilkdropVM(defaultPreset);
  const signalTracker = createMilkdropSignalTracker();
  const session = createMilkdropEditorSession({
    initialPreset: defaultPreset.source,
  });
  const overlay = new MilkdropOverlay({
    host: container ?? document.body,
    callbacks: {
      onSelectPreset: (id) => {
        void selectPreset(id);
      },
      onToggleFavorite: (id, favorite) => {
        void catalogStore.setFavorite(id, favorite).then(syncCatalog);
      },
      onSetRating: (id, rating) => {
        void catalogStore.setRating(id, rating).then(syncCatalog);
      },
      onToggleAutoplay: (enabled) => {
        autoplay = enabled;
        writeUiPrefs({ autoplay: enabled });
      },
      onTransitionModeChange: (mode) => {
        setTransitionMode(mode);
      },
      onGoBackPreset: () => {
        void goBackPreset();
      },
      onNextPreset: () => {
        void selectAdjacentPreset(1);
      },
      onPreviousPreset: () => {
        void selectAdjacentPreset(-1);
      },
      onRandomize: () => {
        void selectRandomPreset();
      },
      onBlendDurationChange: (value) => {
        blendDuration = value;
        writeUiPrefs({ blendDuration: value });
      },
      onImportFiles: (files) => {
        void importFiles(files);
      },
      onExport: () => {
        exportPreset();
      },
      onDuplicatePreset: () => {
        void duplicatePreset();
      },
      onDeletePreset: () => {
        void deleteActivePreset();
      },
      onEditorSourceChange: (source) => {
        void session.applySource(source);
      },
      onRevertToActive: () => {
        void session.resetToActive();
      },
      onInspectorFieldChange: (key, value) => {
        void session.updateField(key, value);
      },
    },
  });

  let runtime: ToyRuntimeInstance | null = null;
  let adapter: ReturnType<typeof createMilkdropRendererAdapter> | null = null;
  let activeCompiled: MilkdropCompiledPreset = defaultPreset;
  let activePresetId = defaultPreset.source.id;
  let currentFrameState: MilkdropFrameState | null = null;
  let blendState = cloneBlendState(currentFrameState);
  let blendEndAtMs = 0;
  let autoplay = prefs.autoplay ?? false;
  let blendDuration =
    prefs.blendDuration ?? activeCompiled.ir.numericFields.blend_duration;
  let transitionMode: 'blend' | 'cut' = prefs.transitionMode ?? 'blend';
  let lastPresetSwitchAt = performance.now();
  let catalogEntries: MilkdropCatalogEntry[] = [];
  let activeBackend: 'webgl' | 'webgpu' = 'webgl';
  let selectionHistory: string[] = [];
  let selectionCursor = -1;
  let fallbackTriggered = false;
  let lastStatusMessage: string | null = null;
  let keyboardHandler: ((event: KeyboardEvent) => void) | null = null;
  let requestedPresetListener: ((event: Event) => void) | null = null;
  let requestedOverlayTabListener: ((event: Event) => void) | null = null;

  const updateAgentDebugSnapshot = () => {
    if (!isAgentMode()) {
      return;
    }
    setDebugSnapshot(
      'milkdrop',
      buildAgentMilkdropDebugSnapshot({
        activePresetId,
        compiledPreset: activeCompiled,
        frameState: currentFrameState,
        status: lastStatusMessage,
      }),
    );
  };

  const setOverlayStatus = (message: string) => {
    lastStatusMessage = message;
    overlay.setStatus(message);
    updateAgentDebugSnapshot();
  };

  const setTransitionMode = (mode: 'blend' | 'cut') => {
    transitionMode = mode;
    overlay.setTransitionMode(mode);
    writeUiPrefs({ transitionMode: mode });
  };

  overlay.setAutoplay(autoplay);
  overlay.setBlendDuration(blendDuration);
  overlay.setTransitionMode(transitionMode);
  overlay.setSessionState(session.getState());
  if (prefs.fallbackNotice) {
    setOverlayStatus(prefs.fallbackNotice);
    writeUiPrefs({ fallbackNotice: undefined });
  }

  const syncCatalog = async () => {
    catalogEntries = await catalogStore.listPresets();
    overlay.setCatalog(catalogEntries, activePresetId, activeBackend);
  };

  const getActiveCatalogEntry = () =>
    catalogEntries.find((entry) => entry.id === activePresetId) ?? null;

  const shouldFallbackToWebgl = (compiled: MilkdropCompiledPreset) =>
    activeBackend === 'webgpu' &&
    compiled.ir.compatibility.backends.webgpu.status === 'unsupported' &&
    !isCompatibilityModeEnabled();

  const triggerWebglFallback = ({
    presetId,
    reason,
  }: {
    presetId: string;
    reason: string;
  }) => {
    if (fallbackTriggered || activeBackend !== 'webgpu') {
      return;
    }
    fallbackTriggered = true;
    writeUiPrefs({
      lastPresetId: presetId,
      fallbackNotice: reason,
    });
    setCompatibilityMode(true);
    window.location.reload();
  };

  const applyCompiledPreset = (compiled: MilkdropCompiledPreset) => {
    activeCompiled = compiled;
    activePresetId = compiled.source.id;
    vm.setPreset(compiled);
    adapter?.setPreset(compiled);
    overlay.setSessionState(session.getState());
    overlay.setInspectorState({
      compiled: activeCompiled,
      frameState: currentFrameState,
      backend: activeBackend,
    });
    updateAgentDebugSnapshot();
  };

  const rememberSelection = async (id: string) => {
    if (selectionHistory[selectionCursor] !== id) {
      selectionHistory = selectionHistory.slice(0, selectionCursor + 1);
      selectionHistory.push(id);
      selectionCursor = selectionHistory.length - 1;
    }
    await catalogStore.recordRecent(id);
    await catalogStore.pushHistory(id);
  };

  const selectPreset = async (
    id: string,
    options: { recordHistory?: boolean } = {},
  ) => {
    const source = await catalogStore.getPresetSource(id);
    if (!source) {
      setOverlayStatus(`Preset ${id} could not be loaded.`);
      return;
    }
    const draft = await catalogStore.getDraft(id);
    const resolvedSource: MilkdropPresetSource = {
      ...source,
      raw: draft ?? source.raw,
    };

    const nextState = await session.loadPreset(resolvedSource);
    const nextCompiled = nextState.activeCompiled;
    if (!nextCompiled) {
      setOverlayStatus(`Preset ${id} did not compile.`);
      return;
    }

    if (shouldFallbackToWebgl(nextCompiled)) {
      triggerWebglFallback({
        presetId: id,
        reason: `${nextCompiled.title} uses preset features the WebGPU runtime does not support yet, so Stims switched to WebGL compatibility mode.`,
      });
      return;
    }

    if (transitionMode === 'blend' && blendDuration > 0) {
      blendState = cloneBlendState(currentFrameState);
      blendEndAtMs = performance.now() + blendDuration * 1000;
    } else {
      blendState = null;
      blendEndAtMs = 0;
    }
    lastPresetSwitchAt = performance.now();

    if (options.recordHistory !== false) {
      await rememberSelection(id);
    }

    writeUiPrefs({ lastPresetId: id });
    applyCompiledPreset(nextCompiled);
    setOverlayStatus(`Loaded ${nextCompiled.title}.`);
    await syncCatalog();
  };

  const applyFieldValues = async (updates: Record<string, string | number>) => {
    const baseline =
      session.getState().latestCompiled?.formattedSource ??
      session.getState().source;
    return session.applySource(upsertMilkdropFields(baseline, updates));
  };

  const nudgeNumericField = async ({
    key,
    delta,
    min,
    max,
    label,
    digits = 3,
  }: {
    key: string;
    delta: number;
    min: number;
    max: number;
    label: string;
    digits?: number;
  }) => {
    const compiled = session.getState().activeCompiled ?? activeCompiled;
    const current = compiled.ir.numericFields[key] ?? 0;
    const next = Math.min(
      max,
      Math.max(min, Number.parseFloat((current + delta).toFixed(digits))),
    );
    await session.updateField(key, next);
    setOverlayStatus(`${label}: ${next.toFixed(Math.min(digits, 2))}`);
  };

  const cycleWaveMode = async (direction: 1 | -1) => {
    const compiled = session.getState().activeCompiled ?? activeCompiled;
    const current = Math.round(compiled.ir.numericFields.wave_mode ?? 0);
    const next = (((current + direction) % 8) + 8) % 8;
    await session.updateField('wave_mode', next);
    setOverlayStatus(`Wave mode: ${next}`);
  };

  const selectAdjacentPreset = async (direction: 1 | -1) => {
    if (!catalogEntries.length) {
      return;
    }
    const currentIndex = catalogEntries.findIndex(
      (entry) => entry.id === activePresetId,
    );
    const nextIndex =
      currentIndex >= 0
        ? (currentIndex + direction + catalogEntries.length) %
          catalogEntries.length
        : 0;
    const next = catalogEntries[nextIndex];
    if (next) {
      await selectPreset(next.id);
    }
  };

  const selectRandomPreset = async () => {
    if (!catalogEntries.length) {
      return;
    }
    const pool = catalogEntries.filter((entry) => {
      if (entry.id === activePresetId) {
        return false;
      }
      return entry.supports[activeBackend].status === 'supported';
    });
    const candidates = pool.length
      ? pool
      : catalogEntries.filter((entry) => entry.id !== activePresetId);
    if (!candidates.length) {
      return;
    }

    const weightedPool = candidates.flatMap((entry) => {
      const weight = Math.max(
        1,
        1 +
          (entry.isFavorite ? 2 : 0) +
          entry.rating +
          (entry.historyIndex !== undefined ? 1 : 0),
      );
      return Array.from({ length: weight }, () => entry.id);
    });

    const selectionId =
      weightedPool[Math.floor(Math.random() * weightedPool.length)];
    if (selectionId) {
      await selectPreset(selectionId);
    }
  };

  const goBackPreset = async () => {
    if (selectionCursor <= 0) {
      const persisted = await catalogStore.getHistory();
      if (persisted.length > 1) {
        const previous = persisted[1] as string;
        selectionHistory = [...persisted].reverse();
        selectionCursor = Math.max(0, selectionHistory.length - 2);
        await selectPreset(previous, { recordHistory: false });
      }
      return;
    }
    selectionCursor -= 1;
    const previousId = selectionHistory[selectionCursor];
    if (previousId) {
      await selectPreset(previousId, { recordHistory: false });
    }
  };

  const importFiles = async (files: FileList) => {
    for (const file of Array.from(files)) {
      const raw = await file.text();
      const compiled = compileMilkdropPresetSource(raw, {
        title: file.name.replace(/\.[^.]+$/u, ''),
        origin: 'imported',
      });
      const saved = await catalogStore.savePreset({
        id: `${compiled.source.id}-${Date.now()}`,
        title: compiled.title,
        raw,
        origin: 'imported',
        author: compiled.author,
        fileName: file.name,
      });
      await catalogStore.saveDraft(saved.id, compiled.formattedSource);
      await syncCatalog();
      await selectPreset(saved.id);
    }
  };

  const duplicatePreset = async () => {
    const compiled = session.getState().activeCompiled ?? activeCompiled;
    const saved = await catalogStore.savePreset({
      id: `${compiled.source.id}-copy-${Date.now()}`,
      title: `${compiled.title} Copy`,
      raw: compiled.formattedSource,
      origin: 'user',
      author: compiled.author,
    });
    await syncCatalog();
    await selectPreset(saved.id);
  };

  const deleteActivePreset = async () => {
    const entry = getActiveCatalogEntry();
    if (!entry || !isEditablePreset(entry)) {
      return;
    }
    const deletedId = entry.id;
    await catalogStore.deletePreset(deletedId);
    await syncCatalog();
    const replacement = catalogEntries.find(
      (candidate) => candidate.id !== deletedId,
    );
    if (replacement) {
      await selectPreset(replacement.id, { recordHistory: false });
    }
  };

  const exportPreset = () => {
    const compiled = session.getState().activeCompiled ?? activeCompiled;
    downloadPresetFile(compiled.source.id, compiled.formattedSource);
  };

  const installKeyboardShortcuts = () => {
    if (keyboardHandler) {
      return;
    }
    keyboardHandler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLElement &&
        (target.closest('.cm-editor') ||
          /^(INPUT|TEXTAREA|SELECT)$/u.test(target.tagName))
      ) {
        return;
      }

      if (event.key === 'm' || event.key === 'M') {
        overlay.toggleOpen();
        event.preventDefault();
        return;
      }
      if (event.key === 'Escape' && overlay.isOpen()) {
        overlay.toggleOpen(false);
        event.preventDefault();
        return;
      }
      if (event.key === 'n') {
        void selectAdjacentPreset(1);
        event.preventDefault();
        return;
      }
      if (event.key === 'p') {
        void selectAdjacentPreset(-1);
        event.preventDefault();
        return;
      }
      if (event.key === 'r') {
        void selectRandomPreset();
        event.preventDefault();
        return;
      }
      if (event.key === 'b' || event.key === 'Backspace') {
        void goBackPreset();
        event.preventDefault();
        return;
      }
      if (event.key === 'h' || event.key === 'H') {
        const nextMode = transitionMode === 'blend' ? 'cut' : 'blend';
        setTransitionMode(nextMode);
        setOverlayStatus(
          nextMode === 'cut'
            ? 'Transition mode: hard cut.'
            : `Transition mode: blend (${blendDuration.toFixed(2)}s).`,
        );
        event.preventDefault();
        return;
      }
      if (event.key === 'w' || event.key === 'W') {
        void cycleWaveMode(event.shiftKey ? -1 : 1);
        event.preventDefault();
        return;
      }
      if (event.key === 'i') {
        void nudgeNumericField({
          key: 'zoom',
          delta: 0.02,
          min: 0.5,
          max: 2.5,
          label: 'Zoom',
          digits: 3,
        });
        event.preventDefault();
        return;
      }
      if (event.key === 'I') {
        void nudgeNumericField({
          key: 'zoom',
          delta: -0.02,
          min: 0.5,
          max: 2.5,
          label: 'Zoom',
          digits: 3,
        });
        event.preventDefault();
        return;
      }
      if (event.key === 'o') {
        void nudgeNumericField({
          key: 'warp',
          delta: -0.01,
          min: 0,
          max: 1,
          label: 'Warp',
          digits: 3,
        });
        event.preventDefault();
        return;
      }
      if (event.key === 'O') {
        void nudgeNumericField({
          key: 'warp',
          delta: 0.01,
          min: 0,
          max: 1,
          label: 'Warp',
          digits: 3,
        });
        event.preventDefault();
        return;
      }
      if (event.key === 'j') {
        void nudgeNumericField({
          key: 'wave_scale',
          delta: -0.03,
          min: 0.25,
          max: 3,
          label: 'Wave scale',
          digits: 3,
        });
        event.preventDefault();
        return;
      }
      if (event.key === 'J') {
        void nudgeNumericField({
          key: 'wave_scale',
          delta: 0.03,
          min: 0.25,
          max: 3,
          label: 'Wave scale',
          digits: 3,
        });
        event.preventDefault();
        return;
      }
      if (event.key === 'e') {
        void nudgeNumericField({
          key: 'wave_a',
          delta: -0.04,
          min: 0,
          max: 1,
          label: 'Wave alpha',
          digits: 3,
        });
        event.preventDefault();
        return;
      }
      if (event.key === 'E') {
        void nudgeNumericField({
          key: 'wave_a',
          delta: 0.04,
          min: 0,
          max: 1,
          label: 'Wave alpha',
          digits: 3,
        });
        event.preventDefault();
        return;
      }
      if (event.key === 'q') {
        void nudgeNumericField({
          key: 'video_echo_zoom',
          delta: -0.01,
          min: 0.85,
          max: 1.3,
          label: 'Video echo zoom',
          digits: 3,
        });
        event.preventDefault();
        return;
      }
      if (event.key === 'Q') {
        void nudgeNumericField({
          key: 'video_echo_zoom',
          delta: 0.01,
          min: 0.85,
          max: 1.3,
          label: 'Video echo zoom',
          digits: 3,
        });
        event.preventDefault();
        return;
      }
      if (event.key === '<') {
        void nudgeNumericField({
          key: 'rot',
          delta: -0.003,
          min: -1,
          max: 1,
          label: 'Rotation',
          digits: 4,
        });
        event.preventDefault();
        return;
      }
      if (event.key === '>') {
        void nudgeNumericField({
          key: 'rot',
          delta: 0.003,
          min: -1,
          max: 1,
          label: 'Rotation',
          digits: 4,
        });
        event.preventDefault();
        return;
      }
      if (event.key === 'f' && activePresetId) {
        const entry = getActiveCatalogEntry();
        if (!entry) {
          return;
        }
        void catalogStore
          .setFavorite(activePresetId, !entry.isFavorite)
          .then(syncCatalog);
        event.preventDefault();
        return;
      }
      if (/^[1-5]$/u.test(event.key) && activePresetId) {
        void catalogStore
          .setRating(activePresetId, Number.parseInt(event.key, 10))
          .then(syncCatalog);
      }
    };
    document.addEventListener('keydown', keyboardHandler);
  };

  const installRequestedPresetListener = () => {
    if (requestedPresetListener || typeof window === 'undefined') {
      return;
    }
    requestedPresetListener = (event: Event) => {
      const presetId = (
        event as CustomEvent<{ presetId?: string }>
      ).detail?.presetId?.trim();
      if (!presetId) {
        return;
      }
      void selectPreset(presetId);
    };
    window.addEventListener(
      MILKDROP_PRESET_SELECTION_EVENT,
      requestedPresetListener,
    );
  };

  const installRequestedOverlayTabListener = () => {
    if (requestedOverlayTabListener || typeof window === 'undefined') {
      return;
    }
    requestedOverlayTabListener = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: MilkdropOverlayTab }>).detail
        ?.tab;
      if (!tab) {
        return;
      }
      overlay.openTab(tab);
    };
    window.addEventListener(
      MILKDROP_OVERLAY_TAB_EVENT,
      requestedOverlayTabListener,
    );
  };

  session.subscribe((state) => {
    overlay.setSessionState(state);
    const nextCompiled = state.activeCompiled;
    if (!nextCompiled) {
      return;
    }
    if (shouldFallbackToWebgl(nextCompiled)) {
      triggerWebglFallback({
        presetId: nextCompiled.source.id,
        reason: `${nextCompiled.title} uses preset features the WebGPU runtime does not support yet, so Stims switched to WebGL compatibility mode.`,
      });
      return;
    }
    const didPresetChange =
      nextCompiled.source.id !== activeCompiled.source.id ||
      nextCompiled.formattedSource !== activeCompiled.formattedSource;
    if (didPresetChange) {
      applyCompiledPreset(nextCompiled);
      void catalogStore.saveDraft(nextCompiled.source.id, state.source);
    }
    void syncCatalog();
  });

  installRequestedPresetListener();
  installRequestedOverlayTabListener();
  void syncCatalog().then(async () => {
    const requestedOverlayTab = consumeRequestedMilkdropOverlayTab();
    if (requestedOverlayTab) {
      overlay.openTab(requestedOverlayTab);
    }
    const requestedPresetId = consumeRequestedMilkdropPresetSelection();
    const startupPresetId =
      requestedPresetId ?? initialPresetId ?? prefs.lastPresetId;
    if (startupPresetId) {
      await selectPreset(startupPresetId, { recordHistory: false });
      if (activePresetId === startupPresetId) {
        return;
      }
    }
    const first = catalogEntries[0];
    if (first) {
      await selectPreset(first.id, { recordHistory: false });
    }
  });

  return {
    applyFields(updates: Record<string, string | number>) {
      return applyFieldValues(updates);
    },

    getActiveCompiledPreset() {
      return activeCompiled;
    },

    getActivePresetId() {
      return activePresetId;
    },

    selectPreset,

    setStatus(message: string) {
      setOverlayStatus(message);
    },

    attachRuntime(nextRuntime: ToyRuntimeInstance) {
      runtime = nextRuntime;
      installKeyboardShortcuts();
      nextRuntime.toy.rendererReady.then((handle) => {
        activeBackend = handle?.backend === 'webgpu' ? 'webgpu' : 'webgl';
        adapter = createMilkdropRendererAdapter({
          scene: nextRuntime.toy.scene,
          camera: nextRuntime.toy.camera,
          renderer: handle?.renderer,
          backend: activeBackend,
        });
        adapter.attach();
        adapter.setPreset(activeCompiled);
        if (shouldFallbackToWebgl(activeCompiled)) {
          triggerWebglFallback({
            presetId: activeCompiled.source.id,
            reason: `${activeCompiled.title} uses preset features the WebGPU runtime does not support yet, so Stims switched to WebGL compatibility mode.`,
          });
          return;
        }
        void syncCatalog();
      });
    },

    update(
      frame: ToyRuntimeFrame,
      options: {
        signalOverrides?: Partial<MilkdropRuntimeSignals>;
      } = {},
    ) {
      if (!runtime || !adapter) {
        return;
      }

      const detailScale = getMilkdropDetailScale({
        backend: activeBackend,
        particleScale: quality.activeQuality.particleScale,
        particleBudget: frame.performance.particleBudget,
        shaderQuality: frame.performance.shaderQuality,
      });
      vm.setDetailScale(detailScale);
      const baseSignals = signalTracker.update({
        time: frame.time,
        deltaMs: frame.deltaMs,
        analyser: frame.analyser,
        frequencyData: frame.frequencyData,
      });
      const inputOverrides = buildMilkdropInputSignalOverrides(frame.input);
      const signals = {
        ...baseSignals,
        ...inputOverrides,
        ...options.signalOverrides,
      };

      if (
        autoplay &&
        catalogEntries.length > 1 &&
        performance.now() - lastPresetSwitchAt >
          Math.max(12000, blendDuration * 1000 + 6000)
      ) {
        void selectRandomPreset();
      }

      currentFrameState = vm.step(signals);
      updateAgentDebugSnapshot();
      const activeBlendState =
        transitionMode === 'blend' &&
        frame.performance.shaderQuality !== 'low' &&
        blendState &&
        performance.now() < blendEndAtMs
          ? {
              ...blendState,
              alpha:
                1 -
                (performance.now() - (blendEndAtMs - blendDuration * 1000)) /
                  (blendDuration * 1000),
            }
          : null;

      const renderFrameState =
        frame.performance.shaderQuality === 'low' &&
        (currentFrameState.post.shaderEnabled ||
          currentFrameState.post.videoEchoEnabled)
          ? {
              ...currentFrameState,
              post: {
                ...currentFrameState.post,
                shaderEnabled: false,
                videoEchoEnabled: false,
              },
            }
          : currentFrameState;

      adapter.render({
        frameState: renderFrameState,
        blendState: activeBlendState,
      });
      runtime.toy.render();
      overlay.setInspectorState({
        compiled: activeCompiled,
        frameState: currentFrameState,
        backend: activeBackend,
      });
    },

    dispose() {
      clearDebugSnapshot('milkdrop');
      overlay.dispose();
      session.dispose();
      adapter?.dispose();
      adapter = null;
      runtime = null;
      if (keyboardHandler) {
        document.removeEventListener('keydown', keyboardHandler);
        keyboardHandler = null;
      }
      if (requestedPresetListener) {
        window.removeEventListener(
          MILKDROP_PRESET_SELECTION_EVENT,
          requestedPresetListener,
        );
        requestedPresetListener = null;
      }
      if (requestedOverlayTabListener) {
        window.removeEventListener(
          MILKDROP_OVERLAY_TAB_EVENT,
          requestedOverlayTabListener,
        );
        requestedOverlayTabListener = null;
      }
    },
  };
}
