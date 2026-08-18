import { notePresetShown } from '../../core/services/preset-telemetry';
import { compileMilkdropPresetSource } from '../compiler';
import type {
  MilkdropCatalogStore,
  MilkdropCompiledPreset,
  MilkdropEditorSession,
  MilkdropPresetSource,
  MilkdropRenderBackend,
} from '../types';
import { describeWebglFallback } from './backend-fallback';
import type { MilkdropCatalogCoordinator } from './catalog-coordinator';
import { FIRST_RUN_PRESET_ID } from './first-run-preset';
import { createPresetLoadTrace } from './preset-load-trace';

export function createMilkdropPresetNavigationController({
  catalogStore,
  catalogCoordinator,
  session,
  getActivePresetId,
  getActiveBackend,
  applyCompiledPreset,
  applyPresetPerformanceOverride,
  beginPresetTransition,
  setOverlayStatus,
  shouldFallbackToWebgl,
  triggerWebglFallback,
  rememberLastPreset,
}: {
  catalogStore: MilkdropCatalogStore;
  catalogCoordinator: MilkdropCatalogCoordinator;
  session: MilkdropEditorSession;
  getActivePresetId: () => string;
  getActiveBackend: () => MilkdropRenderBackend;
  applyCompiledPreset: (compiled: MilkdropCompiledPreset) => void;
  applyPresetPerformanceOverride: (presetId: string) => void;
  /**
   * Starts the crossfade into the preset about to be applied and reports what
   * it decided. The blend-vs-cut policy lives with the frame state it reads,
   * so this controller does not re-derive it.
   */
  beginPresetTransition: () => {
    mode: 'blend' | 'cut';
    durationSeconds: number;
  };
  setOverlayStatus: (message: string) => void;
  shouldFallbackToWebgl: (compiled: MilkdropCompiledPreset) => boolean;
  triggerWebglFallback: (args: { presetId: string; reason: string }) => void;
  rememberLastPreset: (id: string) => void;
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

  // Best-effort warm-up for the next likely switch. Resolves the adjacent
  // selectable preset's source and pre-compiles it into the shared raw-string
  // cache in idle, so a next/prev or autoplay advance applies in ~0ms instead
  // of blocking the main thread for a full parse+IR rebuild right before the
  // blend begins.
  let adjacentPrefetchTimer: ReturnType<typeof setTimeout> | null = null;

  const prefetchAdjacentPreset = async (presetId: string) => {
    const entries = catalogCoordinator.getCatalogEntries();
    const backend = getActiveBackend();
    const pool = entries.filter(
      (entry) => entry.supports[backend].status !== 'unsupported',
    );
    const currentIndex = pool.findIndex((entry) => entry.id === presetId);
    const next = pool[(currentIndex + 1) % pool.length];
    if (!next || next.id === getActivePresetId()) {
      return;
    }
    try {
      const source = await catalogStore.getPresetSource(next.id);
      if (!source) {
        return;
      }
      compileMilkdropPresetSource(source.raw, source, {
        cacheCompile: true,
      });
    } catch {
      // Prefetch is invisible to the user; a failure just costs a cold
      // compile later.
    }
  };

  const scheduleAdjacentPresetPrefetch = (presetId: string) => {
    if (adjacentPrefetchTimer !== null) {
      clearTimeout(adjacentPrefetchTimer);
    }
    adjacentPrefetchTimer = setTimeout(() => {
      adjacentPrefetchTimer = null;
      void prefetchAdjacentPreset(presetId);
    }, 250);
  };

  const selectPreset = async (
    id: string,
    options: { recordHistory?: boolean; skipIfAlreadyActive?: boolean } = {},
  ) => {
    const requestRevision = ++currentLoadRequestRevision;
    const trace = createPresetLoadTrace(id);
    try {
      // Startup sets this. The first-run preset is compiled into the bundle and
      // is already mounted and rendering by the time catalog selection resolves
      // to that same id, so the fetch + recompile + re-apply below would just
      // rebuild what is on screen. A stored draft still has to win, so only
      // skip when there is nothing edited to apply.
      if (options.skipIfAlreadyActive && id === getActivePresetId()) {
        trace.step('reuseActive');
        if (!(await catalogStore.getDraft(id))) {
          applyPresetPerformanceOverride(id);
          rememberLastPreset(id);
          trace.done('already active');
          return;
        }
      }

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
        const reason = describeWebglFallback(nextCompiled);
        trace.adapter('WebGL fallback', reason);
        triggerWebglFallback({ presetId: id, reason });
        trace.done('fallback to WebGL');
        return;
      }

      trace.step('performanceOverride');
      applyPresetPerformanceOverride(nextCompiled.source.id);

      trace.step('blendTransition');
      const transition = beginPresetTransition();
      trace.adapter(
        'transition',
        transition.mode === 'blend'
          ? `blend (${transition.durationSeconds.toFixed(2)}s)`
          : 'cut',
      );

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
      notePresetShown(nextCompiled.source.id);
      setOverlayStatus(`Loaded ${nextCompiled.title}.`);
      scheduleAdjacentPresetPrefetch(id);

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
