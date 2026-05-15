import type {
  MilkdropBlendState,
  MilkdropCatalogStore,
  MilkdropCompiledPreset,
  MilkdropEditorSession,
  MilkdropFrameState,
  MilkdropPresetSource,
  MilkdropRenderBackend,
} from '../types';
import type { MilkdropCatalogCoordinator } from './catalog-coordinator';
import { createPresetLoadTrace } from './preset-load-trace';
import { cloneBlendState, estimateFrameBlendWorkload } from './session';

const MAX_BLEND_WORKLOAD = 900;

export function createMilkdropPresetNavigationController({
  catalogStore,
  catalogCoordinator,
  session,
  getActivePresetId,
  getActiveBackend,
  getCurrentFrameState,
  getBlendDuration,
  getTransitionMode,
  applyCompiledPreset,
  applyPresetPerformanceOverride,
  setOverlayStatus,
  shouldFallbackToWebgl,
  triggerWebglFallback,
  rememberLastPreset,
  preparePresetTransition,
  markPresetSwitched,
}: {
  catalogStore: MilkdropCatalogStore;
  catalogCoordinator: MilkdropCatalogCoordinator;
  session: MilkdropEditorSession;
  getActivePresetId: () => string;
  getActiveBackend: () => MilkdropRenderBackend;
  getCurrentFrameState: () => MilkdropFrameState | null;
  getBlendDuration: () => number;
  getTransitionMode: () => 'blend' | 'cut';
  applyCompiledPreset: (compiled: MilkdropCompiledPreset) => void;
  applyPresetPerformanceOverride: (presetId: string) => void;
  setOverlayStatus: (message: string) => void;
  shouldFallbackToWebgl: (compiled: MilkdropCompiledPreset) => boolean;
  triggerWebglFallback: (args: { presetId: string; reason: string }) => void;
  rememberLastPreset: (id: string) => void;
  preparePresetTransition: (blendState: MilkdropBlendState | null) => void;
  markPresetSwitched: () => void;
}) {
  const syncCatalog = () =>
    catalogCoordinator.scheduleCatalogSync({
      activePresetId: getActivePresetId(),
      activeBackend: getActiveBackend(),
    });

  const isBackendSelectable = (id: string, backend = getActiveBackend()) => {
    const entry = catalogCoordinator
      .getCatalogEntries()
      .find((candidate) => candidate.id === id);
    if (!entry) {
      return true;
    }
    return entry.supports[backend].status !== 'unsupported';
  };

  const getFirstSelectablePresetId = (backend = getActiveBackend()) =>
    catalogCoordinator.getCatalogEntries().find((entry) => {
      return entry.supports[backend].status !== 'unsupported';
    })?.id ?? null;

  const selectPreset = async (
    id: string,
    options: { recordHistory?: boolean } = {},
  ) => {
    const trace = createPresetLoadTrace(id);
    trace.step('getPresetSource');

    const source = await catalogStore.getPresetSource(id);
    trace.step('resolveSource');
    if (!source) {
      trace.error(`Preset ${id} not found in store or bundle`);
      setOverlayStatus(`Preset ${id} could not be loaded.`);
      trace.done('not found');
      return;
    }
    trace.adapter('source origin', source.origin);

    const draft = await catalogStore.getDraft(id);
    if (draft) {
      trace.adapter('draft applied', `overriding raw source with edited draft`);
    }
    const resolvedSource: MilkdropPresetSource = {
      ...source,
      raw: draft ?? source.raw,
    };

    trace.step('compile');
    const nextState = await session.loadPreset(resolvedSource);
    const nextCompiled = nextState.activeCompiled;
    trace.step('compilationResult');
    if (!nextCompiled) {
      trace.error(`Compilation failed for ${id}`);
      setOverlayStatus(`Preset ${id} did not compile.`);
      trace.done('compile failed');
      return;
    }

    const hasErrors =
      nextState.diagnostics?.some?.((d) => d.severity === 'error') ?? false;
    if (hasErrors) {
      const errorCount =
        nextState.diagnostics?.filter?.((d) => d.severity === 'error').length ??
        0;
      trace.warn(
        `Compilation had ${errorCount} error(s) — using last-good fallback`,
      );
    }

    if (shouldFallbackToWebgl(nextCompiled)) {
      trace.adapter(
        'WebGL fallback',
        `${nextCompiled.title} uses features unsupported on WebGPU`,
      );
      triggerWebglFallback({
        presetId: id,
        reason: `${nextCompiled.title} uses preset features the WebGPU runtime does not support yet, so Stims switched to WebGL compatibility mode.`,
      });
      trace.done('fallback to WebGL');
      return;
    }

    trace.step('performanceOverride');
    applyPresetPerformanceOverride(nextCompiled.source.id);

    trace.step('blendTransition');
    const currentFrameState = getCurrentFrameState();
    const canBlend =
      getTransitionMode() === 'blend' &&
      getBlendDuration() > 0 &&
      estimateFrameBlendWorkload(currentFrameState) < MAX_BLEND_WORKLOAD;
    trace.adapter(
      'transition',
      canBlend ? `blend (${getBlendDuration()}ms)` : 'cut',
    );
    preparePresetTransition(
      canBlend ? cloneBlendState(currentFrameState) : null,
    );
    markPresetSwitched();

    if (options.recordHistory !== false) {
      await catalogCoordinator.rememberSelection(id);
    }

    rememberLastPreset(id);

    trace.step('applyCompiledPreset');
    applyCompiledPreset(nextCompiled);
    setOverlayStatus(`Loaded ${nextCompiled.title}.`);

    trace.step('catalogSync');
    await syncCatalog();
    trace.done();
  };

  const selectAdjacentPreset = async (direction: 1 | -1) => {
    const catalogEntries = catalogCoordinator.getCatalogEntries();
    if (!catalogEntries.length) {
      return;
    }
    const selectableEntries = catalogEntries.filter(
      (entry) => entry.supports[getActiveBackend()].status !== 'unsupported',
    );
    const navigationPool = selectableEntries.length
      ? selectableEntries
      : catalogEntries;
    const currentIndex = catalogEntries.findIndex(
      (entry) => entry.id === getActivePresetId(),
    );
    const navigationIndex = navigationPool.findIndex(
      (entry) => entry.id === getActivePresetId(),
    );
    const nextIndex =
      navigationIndex >= 0
        ? (navigationIndex + direction + navigationPool.length) %
          navigationPool.length
        : currentIndex >= 0
          ? Math.min(currentIndex, navigationPool.length - 1)
          : 0;
    const next = navigationPool[nextIndex];
    if (next) {
      await selectPreset(next.id);
    }
  };

  const selectRandomPreset = async () => {
    const catalogEntries = catalogCoordinator.getCatalogEntries();
    if (!catalogEntries.length) {
      return;
    }
    const activePresetId = getActivePresetId();
    const activeBackend = getActiveBackend();
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
    const previousId = await catalogCoordinator.consumePreviousSelection();
    if (previousId) {
      await selectPreset(previousId, { recordHistory: false });
    }
  };

  return {
    getFirstSelectablePresetId,
    isBackendSelectable,
    selectPreset,
    selectAdjacentPreset,
    selectRandomPreset,
    goBackPreset,
  };
}
