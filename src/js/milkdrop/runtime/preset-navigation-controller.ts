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
import { FIRST_RUN_PRESET_ID } from './first-run-preset';
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

  // Prefers the deliberate first-run pick over the head of the sort order. See
  // first-run-preset.ts for the measurements behind it. Falls back to sort
  // order when that preset is missing from the catalog or unsupported here, so
  // a bad id degrades to the previous behaviour rather than to no preset.
  const getFirstSelectablePresetId = (backend = getActiveBackend()) => {
    const entries = catalogCoordinator.getCatalogEntries();
    const selectable = (entry: (typeof entries)[number]) =>
      entry.supports[backend].status !== 'unsupported';

    const firstRunEntry = entries.find(
      (entry) => entry.id === FIRST_RUN_PRESET_ID && selectable(entry),
    );

    return (firstRunEntry ?? entries.find(selectable))?.id ?? null;
  };

  let currentLoadRequestRevision = 0;

  const selectPreset = async (
    id: string,
    options: { recordHistory?: boolean } = {},
  ) => {
    const requestRevision = ++currentLoadRequestRevision;
    const trace = createPresetLoadTrace(id);
    try {
      trace.step('getPresetSource');

      const source = await catalogStore.getPresetSource(id);
      if (requestRevision !== currentLoadRequestRevision) {
        trace.done('superseded');
        return;
      }
      trace.step('resolveSource');
      if (!source) {
        trace.error(`Preset ${id} not found in store or bundle`);
        setOverlayStatus(`Preset ${id} could not be loaded.`);
        trace.done('not found');
        return;
      }
      trace.adapter('source origin', source.origin);

      const draft = await catalogStore.getDraft(id);
      if (requestRevision !== currentLoadRequestRevision) {
        trace.done('superseded');
        return;
      }
      if (draft) {
        trace.adapter(
          'draft applied',
          `overriding raw source with edited draft`,
        );
      }
      const resolvedSource: MilkdropPresetSource = {
        ...source,
        raw: draft ?? source.raw,
      };

      trace.step('compile');
      const nextState = await session.loadPreset(resolvedSource);
      if (requestRevision !== currentLoadRequestRevision) {
        trace.done('superseded');
        return;
      }
      const nextCompiled = nextState.activeCompiled;
      trace.step('compilationResult');
      if (!nextCompiled) {
        trace.error(`Compilation failed for ${id}`);
        setOverlayStatus(`Preset ${id} did not compile.`);
        trace.done('compile failed');
        return;
      }

      if (nextState.diagnostics) {
        trace.recordDiagnostics(nextState.diagnostics);
      }

      const hasErrors =
        nextState.diagnostics?.some?.((d) => d.severity === 'error') ?? false;
      if (hasErrors) {
        const errorCount =
          nextState.diagnostics?.filter?.((d) => d.severity === 'error')
            .length ?? 0;
        trace.warn(
          `Compilation had ${errorCount} error(s) — using last-good fallback`,
        );
      }

      if (shouldFallbackToWebgl(nextCompiled)) {
        const unsupportedItems =
          nextCompiled.ir?.compatibility?.gpuDescriptorPlans?.webgpu
            ?.unsupported ?? [];
        const unsupportedDetail =
          unsupportedItems.length > 0
            ? `: ${unsupportedItems.map((u) => u.reason).join('; ')}`
            : '';

        trace.adapter(
          'WebGL fallback',
          `${nextCompiled.title} uses features unsupported on WebGPU${unsupportedDetail}`,
        );
        triggerWebglFallback({
          presetId: id,
          reason: `${nextCompiled.title} uses preset features the WebGPU runtime does not support yet${unsupportedDetail}, so Stims switched to WebGL compatibility mode.`,
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
        canBlend ? `blend (${getBlendDuration().toFixed(2)}s)` : 'cut',
      );
      preparePresetTransition(
        canBlend ? cloneBlendState(currentFrameState) : null,
      );
      markPresetSwitched();

      if (options.recordHistory !== false) {
        await catalogCoordinator.rememberSelection(id);
        if (requestRevision !== currentLoadRequestRevision) {
          trace.done('superseded');
          return;
        }
      }

      rememberLastPreset(id);

      trace.step('applyCompiledPreset');
      applyCompiledPreset(nextCompiled);
      setOverlayStatus(`Loaded ${nextCompiled.title}.`);

      trace.step('catalogSync');
      await syncCatalog();
      trace.done();
    } catch (error) {
      if (requestRevision === currentLoadRequestRevision) {
        trace.error(`Unexpected failure loading preset: ${error}`);
        setOverlayStatus(`Failed to load preset "${id}".`);
        trace.done('error');
      } else {
        trace.done('superseded error');
      }
      throw error;
    }
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

    const scatterWeight = (entry: (typeof candidates)[number]) => {
      const fidelityWeight =
        entry.fidelityClass === 'exact'
          ? 8
          : entry.fidelityClass === 'near-exact'
            ? 6
            : entry.fidelityClass === 'partial'
              ? 4
              : 2;
      const favoriteWeight = entry.isFavorite ? 6 : 0;
      const historyBonus =
        entry.historyIndex !== undefined && entry.historyIndex >= 0 ? 3 : 0;
      const recentPenalty =
        entry.lastOpenedAt && entry.lastOpenedAt > Date.now() - 300_000
          ? -4
          : 0;
      return Math.max(
        1,
        fidelityWeight + favoriteWeight + historyBonus + recentPenalty,
      );
    };

    const scoredPool = candidates.map((entry) => ({
      entry,
      weight: scatterWeight(entry),
    }));
    const totalWeight = scoredPool.reduce((sum, s) => sum + s.weight, 0);
    let roll = Math.random() * totalWeight;
    const picked = scoredPool.find((s) => {
      roll -= s.weight;
      return roll <= 0;
    });

    const selectionId = picked?.entry.id ?? candidates[0]?.id;
    if (selectionId) {
      await selectPreset(selectionId);
    }
  };

  const goBackPreset = async () => {
    const previousId = await catalogCoordinator.consumePreviousSelection(
      getActivePresetId(),
    );
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
