import { setCompatibilityMode } from '../core/render-preferences';
import type { ToyRuntimeFrame, ToyRuntimeInstance } from '../core/toy-runtime';
import type { QualityPresetManager } from '../utils/toy-settings';
import { createMilkdropCatalogStore } from './catalog-store';
import { compileMilkdropPresetSource } from './compiler';
import { createMilkdropEditorSession } from './editor-session';
import { MilkdropOverlay } from './overlay';
import { createMilkdropRendererAdapter } from './renderer-adapter';
import { createMilkdropSignalTracker } from './runtime-signals';
import type {
  MilkdropCatalogEntry,
  MilkdropCompiledPreset,
  MilkdropFrameState,
  MilkdropPresetSource,
} from './types';
import { createMilkdropVM } from './vm';

const UI_PREFS_KEY = 'stims:milkdrop:ui';

type UiPrefs = {
  autoplay?: boolean;
  blendDuration?: number;
  lastPresetId?: string;
};

const DEFAULT_PRESET_SOURCE = `title=Signal Bloom
author=Stim Webtoys
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
shape_1_enabled=1
shape_1_sides=6
shape_1_x=0.5
shape_1_y=0.5
shape_1_rad=0.17
shape_1_ang=0
shape_1_a=0.18
shape_1_r=1
shape_1_g=0.48
shape_1_b=0.84
shape_1_border_a=0.9
shape_1_border_r=1
shape_1_border_g=0.78
shape_1_border_b=1
shape_1_additive=1
shape_1_thickoutline=1

per_frame_1=zoom = 1.0 + bass_att * 0.08
per_frame_2=rot = rot + beat_pulse * 0.004
per_frame_3=wave_y = 0.5 + sin(time * 0.35) * 0.08
per_frame_4=shape_1_ang = shape_1_ang + 0.01 + treble_att * 0.01

per_pixel_1=warp = warp + sin(rad * 10 + time * 0.8) * 0.03
`;

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

function cloneBlendState(frameState: MilkdropFrameState | null) {
  if (!frameState) {
    return null;
  }
  return {
    waveform: {
      ...frameState.waveform,
      positions: [...frameState.waveform.positions],
      color: { ...frameState.waveform.color },
    },
    trails: frameState.trails.map((trail) => ({
      ...trail,
      positions: [...trail.positions],
      color: { ...trail.color },
    })),
    shapes: frameState.shapes.map((shape) => ({
      ...shape,
      color: { ...shape.color },
      borderColor: { ...shape.borderColor },
    })),
    alpha: 1,
  };
}

export function createMilkdropExperience({
  container,
  quality,
}: {
  container?: HTMLElement | null;
  quality: QualityPresetManager;
}) {
  const prefs = readUiPrefs();
  const catalogStore = createMilkdropCatalogStore();
  const defaultPreset = compileMilkdropPresetSource(DEFAULT_PRESET_SOURCE, {
    id: 'signal-bloom',
    title: 'Signal Bloom',
    origin: 'bundled',
    author: 'Stim Webtoys',
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
        void catalogStore.setFavorite(id, favorite).then(refreshCatalog);
      },
      onToggleAutoplay: (enabled) => {
        autoplay = enabled;
        writeUiPrefs({ autoplay: enabled });
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
      onEditorSourceChange: (source) => {
        void session.applySource(source);
      },
      onRevertToActive: () => {
        void session.resetToActive();
      },
      onInspectorFieldChange: (key, value) => {
        void session.updateField(key, value);
      },
      onRetryWebGL: () => {
        setCompatibilityMode(true);
        window.location.reload();
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
  let lastPresetSwitchAt = performance.now();
  let catalogEntries: MilkdropCatalogEntry[] = [];
  let activeBackend: 'webgl' | 'webgpu' = 'webgl';

  overlay.setAutoplay(autoplay);
  overlay.setBlendDuration(blendDuration);
  overlay.setSessionState(session.getState());

  const refreshCatalog = async () => {
    catalogEntries = await catalogStore.listPresets();
    overlay.setCatalog(catalogEntries, activePresetId);
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
  };

  const selectPreset = async (id: string) => {
    const source = await catalogStore.getPresetSource(id);
    if (!source) {
      overlay.setStatus(`Preset ${id} could not be loaded.`);
      return;
    }
    const draft = await catalogStore.getDraft(id);
    const resolvedSource: MilkdropPresetSource = {
      ...source,
      raw: draft ?? source.raw,
    };

    blendState = cloneBlendState(currentFrameState);
    blendEndAtMs = performance.now() + blendDuration * 1000;
    lastPresetSwitchAt = performance.now();
    await catalogStore.recordRecent(id);
    writeUiPrefs({ lastPresetId: id });
    const nextState = await session.loadPreset(resolvedSource);
    if (nextState.activeCompiled) {
      applyCompiledPreset(nextState.activeCompiled);
      overlay.setStatus(`Loaded ${nextState.activeCompiled.title}.`);
    }
    await refreshCatalog();
  };

  const selectRandomPreset = async () => {
    if (!catalogEntries.length) {
      return;
    }
    const supported = catalogEntries.filter(
      (entry) =>
        entry.id !== activePresetId &&
        (activeBackend === 'webgpu'
          ? entry.supports.webgpu
          : entry.supports.webgl),
    );
    const pool = supported.length
      ? supported
      : catalogEntries.filter((entry) => entry.id !== activePresetId);
    if (!pool.length) {
      return;
    }
    const selection = pool[
      Math.floor(Math.random() * pool.length)
    ] as MilkdropCatalogEntry;
    await selectPreset(selection.id);
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
      await refreshCatalog();
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
    await refreshCatalog();
    await selectPreset(saved.id);
  };

  const exportPreset = () => {
    const compiled = session.getState().activeCompiled ?? activeCompiled;
    downloadPresetFile(compiled.source.id, compiled.formattedSource);
  };

  session.subscribe((state) => {
    overlay.setSessionState(state);
    const nextCompiled = state.activeCompiled;
    if (!nextCompiled) {
      return;
    }
    const didPresetChange =
      nextCompiled.source.id !== activeCompiled.source.id ||
      nextCompiled.formattedSource !== activeCompiled.formattedSource;
    if (didPresetChange) {
      applyCompiledPreset(nextCompiled);
      void catalogStore.saveDraft(nextCompiled.source.id, state.source);
    }
    void refreshCatalog();
  });

  void refreshCatalog().then(async () => {
    const initialPresetId = prefs.lastPresetId;
    if (
      initialPresetId &&
      catalogEntries.some((entry) => entry.id === initialPresetId)
    ) {
      await selectPreset(initialPresetId);
      return;
    }
    const first = catalogEntries[0];
    if (first) {
      await selectPreset(first.id);
    }
  });

  return {
    attachRuntime(nextRuntime: ToyRuntimeInstance) {
      runtime = nextRuntime;
      nextRuntime.toy.rendererReady.then((handle) => {
        activeBackend = handle?.backend === 'webgpu' ? 'webgpu' : 'webgl';
        adapter = createMilkdropRendererAdapter({
          scene: nextRuntime.toy.scene,
          backend: activeBackend,
        });
        adapter.attach();
        adapter.setPreset(activeCompiled);
      });
    },

    update(frame: ToyRuntimeFrame) {
      if (!runtime || !adapter) {
        return;
      }

      const detailScale =
        (quality.activeQuality.particleScale ?? 1) *
        frame.performance.particleBudget;
      vm.setDetailScale(detailScale);
      const signals = signalTracker.update({
        time: frame.time,
        deltaMs: frame.deltaMs,
        analyser: frame.analyser,
        frequencyData: frame.frequencyData,
      });

      if (
        autoplay &&
        catalogEntries.length > 1 &&
        performance.now() - lastPresetSwitchAt >
          Math.max(12000, blendDuration * 1000 + 6000)
      ) {
        void selectRandomPreset();
      }

      currentFrameState = vm.step(signals);
      const activeBlendState =
        blendState && performance.now() < blendEndAtMs
          ? {
              ...blendState,
              alpha:
                1 -
                (performance.now() - (blendEndAtMs - blendDuration * 1000)) /
                  (blendDuration * 1000),
            }
          : null;

      adapter.render({
        frameState: currentFrameState,
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
      overlay.dispose();
      session.dispose();
      adapter?.dispose();
      adapter = null;
      runtime = null;
    },
  };
}
