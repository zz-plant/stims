import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getDevicePerformanceProfile } from '../core/device-profile.ts';
import { createLogger } from '../core/logger.ts';
import { noteSubstitution } from '../core/services/preset-telemetry.ts';
import {
  sampleStageLiveness,
  shouldRetireAttractRender,
} from '../core/services/stage-liveness.ts';
import {
  DEFAULT_QUALITY_PRESETS,
  QUALITY_STORAGE_KEY,
  setQualityPresetById,
} from '../core/settings-panel.ts';
import { resolvePresetId } from '../milkdrop/preset-id-resolution.ts';
import { FIRST_RUN_PRESET_ID } from '../milkdrop/runtime/first-run-preset.ts';
import { scheduleIdleTask } from '../utils/browser/idle-task.ts';
import { recordStatusMessage } from './agent-state.ts';
import type { LaunchIntent, SessionRouteState } from './contracts.ts';
import type {
  EngineSnapshot,
  MilkdropEngineAdapter,
} from './engine/milkdrop-engine-adapter.ts';
import { setAudioBands, setAudioEnergy } from './engine-audio-energy-store.ts';
import { useAudioSourceSync } from './hooks/use-audio-source-sync.ts';
import { useCatalogLoading } from './hooks/use-catalog-loading.ts';
import { useDocumentDatasetSync } from './hooks/use-document-dataset-sync.ts';
import { useFlashSafety } from './hooks/use-flash-safety.ts';
import { usePresetPreviews } from './hooks/use-preset-previews.ts';
import { usePresetRouteSync } from './hooks/use-preset-route-sync.ts';
import { useStageCanvasSync } from './hooks/use-stage-canvas-sync.ts';
import { useStoreSubscriptions } from './hooks/use-store-subscriptions.ts';
import { reportLoadStatus } from './load-status.ts';
import { decidePresetRoutePush } from './preset-route-push.ts';
import {
  buildSessionRouteSearch,
  parsePlainSearch,
  readSessionRouteState,
  stringifyPlainSearch,
} from './url-state.ts';
import { createLazyFactory } from './use-lazy-factory.ts';
import { runViewTransition } from './view-transition.ts';
import { buildLaunchIntent } from './workspace-helpers.ts';
import { useWorkspaceToast } from './workspace-toast.ts';
import { useWorkspaceYouTubePreview } from './workspace-youtube-preview.ts';

const log = createLogger('WorkspaceHooks');

/**
 * How long the attract render gets before it is judged. Covers the gap
 * between the runtime reporting ready and its first composited frame:
 * shader compile, first preset apply, first present.
 */
const ATTRACT_LIVENESS_SETTLE_MS = 2500;

/** Gap before the confirming sample, so one unlucky frame cannot condemn it. */
const ATTRACT_LIVENESS_CONFIRM_MS = 1200;

export function useWorkspaceRouteState() {
  const [routeState, setRouteState] = useState<SessionRouteState>(() =>
    readSessionRouteState(),
  );
  const previousPanelRef = useRef<SessionRouteState['panel']>(routeState.panel);

  useEffect(() => {
    const previousPanel = previousPanelRef.current;
    previousPanelRef.current = routeState.panel;

    const currentSearch = parsePlainSearch(window.location.search);
    const nextSearch = buildSessionRouteSearch(routeState, currentSearch);
    const serialized = stringifyPlainSearch(nextSearch);
    const current = window.location.search;
    if (serialized === current) {
      return;
    }

    const hash = window.location.hash;
    const newUrl = hash ? `${serialized}${hash}` : serialized;
    // Opening a panel pushes a history entry so the browser Back button (and
    // the Android back gesture) closes the sheet instead of leaving the
    // site. Every other route change — preset switches, audio source,
    // filters, panel-to-panel moves — stays a replace so history isn't
    // flooded with entries.
    if (routeState.panel !== null && previousPanel === null) {
      window.history.pushState(null, '', newUrl);
    } else {
      window.history.replaceState(null, '', newUrl);
    }
  }, [routeState]);

  useEffect(() => {
    const onPopState = () => {
      const nextState = readSessionRouteState();
      setRouteState(nextState);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const commitRoute = (nextState: SessionRouteState) => {
    setRouteState(nextState);
  };

  return {
    commitRoute,
    routeState,
    setRouteState,
  };
}

export function useWorkspaceSessionState({
  routeState,
  setRouteState,
}: {
  routeState: SessionRouteState;
  setRouteState: Dispatch<SetStateAction<SessionRouteState>>;
}) {
  const [engineSnapshot, setEngineSnapshot] = useState<EngineSnapshot | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const { motionPreference, qualityPreset, renderPreferences } =
    useStoreSubscriptions();
  const [showExtendedSources, setShowExtendedSources] = useState(false);
  const [statusMessage, setStatusMessageState] = useState<string | null>(null);
  // Status toasts are the app's confirmation channel but they evaporate;
  // mirror every message into the agent-state ring buffer so automation can
  // verify effects after the fact.
  const setStatusMessage = useCallback((message: string | null) => {
    recordStatusMessage(message);
    setStatusMessageState(message);
  }, []);
  const deferredSearch = useDeferredValue(searchQuery);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<MilkdropEngineAdapter | null>(null);
  const engineSnapshotRef = useRef<EngineSnapshot | null>(null);
  const sessionDisposedRef = useRef(false);
  const engineAdapterPromiseRef = useRef<Promise<MilkdropEngineAdapter> | null>(
    null,
  );
  const engineUnsubscribeRef = useRef<(() => void) | null>(null);
  const ensureEngineMountPromiseRef =
    useRef<Promise<MilkdropEngineAdapter> | null>(null);
  const pendingPresetIdRef = useRef<string | null>(routeState.presetId);
  // Preset ids that already timed out or failed. Loading the fallback changes
  // `activePresetId`, which re-runs the load effect; without this the effect
  // would keep re-requesting the preset that just failed, forever.
  const failedPresetIdsRef = useRef<Set<string>>(new Set());
  // The resolved route preset id the route -> engine effect last acted on.
  // Distinguishes "the route changed, push it to the engine" from "the engine
  // moved on its own and this effect is only re-running because of it" — see
  // the guard in that effect.
  const handledRouteRequestRef = useRef<string | null>(null);
  const initialLaunchIntentRef = useRef(buildLaunchIntent(routeState));

  // Frame-fresh energy for UI that pulses with the music (stage --energy,
  // launch trace): the engine snapshot only refreshes on discrete
  // emitChange events, so while audio is live poll the signal tracker each
  // animation frame and feed the audio-energy store directly. The store's
  // dead-band keeps quiet frames free, and rAF stops on hidden tabs where
  // nothing pulses anyway.
  const audioActive = engineSnapshot?.audioActive ?? false;
  useEffect(() => {
    if (!audioActive) return;
    let frameId = 0;
    const publish = () => {
      const levels = engineRef.current?.getAudioLevels();
      if (levels) {
        setAudioEnergy(levels.energy);
        setAudioBands({
          bass: levels.bass,
          mid: levels.mid,
          treble: levels.treble,
        });
      }
      frameId = requestAnimationFrame(publish);
    };
    frameId = requestAnimationFrame(publish);
    return () => cancelAnimationFrame(frameId);
  }, [audioActive]);

  // The landing page is the pitch for a visuals product and contained no
  // visuals: a full-viewport canvas sat behind the launch form with nothing
  // drawn on it, because the engine only mounted once a preset or an audio
  // source was in the route. Mount it for the bare landing view too, so an
  // arrival sees the thing they came for while reading the form.
  //
  // Audio is silent until they choose a source, so this leans on the first-run
  // preset's autonomous motion (see runtime/first-run-preset.ts) rather than on
  // audio reactivity.
  //
  // Gated on the device profile: `lowPower` covers limited memory or cores,
  // handhelds and smart TVs, and `reducedMotion` honors the OS-level
  // prefers-reduced-motion request — anyone who asked for less motion, or
  // whose device should not spend a GPU context on decoration, still gets the
  // static form.
  const [attractModeEnabled, setAttractModeEnabled] = useState(() => {
    if (routeState.previewMode) {
      return false;
    }
    const profile = getDevicePerformanceProfile();
    return !profile.lowPower && !profile.reducedMotion;
  });
  // Latches once the attract render has been judged, so a paused-then-blank
  // stage is not re-sampled every snapshot.
  const attractLivenessJudgedRef = useRef(false);

  const {
    activityCatalog,
    ensureCatalogStore,
    fallbackCatalog,
    fallbackCatalogError,
    fallbackCatalogReady,
    fullCatalogReady,
    hydrateFullCatalogNow,
    refreshCatalogActivity,
  } = useCatalogLoading();

  const previewEngineRef = useRef({
    pausePreview: () => engineRef.current?.pausePreview(),
    resumePreview: () => engineRef.current?.resumePreview(),
  });
  const { presetPreviews, requestPresetPreviews, refreshPresetPreviews } =
    usePresetPreviews({
      stageRef,
      engine: previewEngineRef.current,
      engineSnapshot,
      fallbackCatalogReady,
      isDisposed: () => sessionDisposedRef.current,
    });
  const {
    handleYoutubeUrlKeyDown,
    loadRecentYouTubeVideo,
    loadYouTubePreview,
    clearRecentYouTubeVideos,
    recentYouTubeVideos,
    youtubeCanLoad,
    youtubeFeedback,
    youtubeInputInvalid,
    youtubeLoading,
    youtubePreviewRef,
    youtubeReady,
    youtubeTransport,
    youtubeTransportControls,
    youtubeUrl,
    setYoutubeUrl,
  } = useWorkspaceYouTubePreview({
    setStatusMessage,
    initialVideoId: routeState.youtubeVideoId ?? null,
    initialStartSeconds: routeState.youtubeStartSeconds ?? null,
    onVideoLoaded: ({ id, startSeconds }) => {
      // Keep the address bar shareable: whatever is playing is what a copied
      // link will reopen.
      setRouteState((previous) =>
        previous.youtubeVideoId === id &&
        (previous.youtubeStartSeconds ?? 0) === startSeconds
          ? previous
          : {
              ...previous,
              youtubeVideoId: id,
              youtubeStartSeconds: startSeconds > 0 ? startSeconds : null,
            },
      );
    },
  });
  const { toast, dismissToast } = useWorkspaceToast({
    engineSnapshot,
    routeState,
    statusMessage,
  });

  const ensureEngineAdapter = useEffectEvent(
    createLazyFactory({
      name: 'EngineAdapter',
      factory: () =>
        import('./engine/milkdrop-engine-adapter.ts').then(
          ({ createMilkdropEngineAdapter }) => createMilkdropEngineAdapter(),
        ),
      // Subscribing here rather than in `factory` keeps a superseded adapter
      // from overwriting the live session's unsubscribe: `install` runs only
      // after createLazyFactory has confirmed this call still owns the slot.
      install: (adapter) => {
        engineUnsubscribeRef.current = adapter.subscribe((snapshot) => {
          const audioFlipped =
            Boolean(engineSnapshotRef.current?.audioActive) !==
            Boolean(snapshot.audioActive);
          engineSnapshotRef.current = snapshot;
          if (audioFlipped) {
            // The home<->live swap (launch form <-> live stage) is the one
            // transition worth the view-transition snapshot freeze: the
            // engine is crossfading presets at the same moment, which masks
            // the brief static canvas frame. In-live interactions are left
            // out so the canvas never freezes while music plays.
            runViewTransition(() => setEngineSnapshot(snapshot));
          } else {
            setEngineSnapshot(snapshot);
          }
        });
      },
      getRef: () => engineRef.current,
      setRef: (adapter) => {
        engineRef.current = adapter;
      },
      getPromiseRef: () => engineAdapterPromiseRef.current,
      setPromiseRef: (p) => {
        engineAdapterPromiseRef.current = p;
      },
      cleanup: (adapter) => adapter.dispose(),
      isDisposed: () => sessionDisposedRef.current,
    }),
  );

  const ensureEngineMounted = useEffectEvent(
    async (launchIntent?: LaunchIntent) => {
      const stage = stageRef.current;
      if (!stage) {
        throw new Error('Visualizer stage is not ready yet.');
      }

      if (ensureEngineMountPromiseRef.current) {
        return ensureEngineMountPromiseRef.current;
      }

      const intent = launchIntent ?? buildLaunchIntent(routeState);

      const mountPromise = (async () => {
        reportLoadStatus('runtime');
        const adapter = await ensureEngineAdapter();
        if (adapter.isMounted()) {
          return adapter;
        }

        await adapter.mount(stage, intent);
        return adapter;
      })();

      ensureEngineMountPromiseRef.current = mountPromise;

      try {
        return await mountPromise;
      } finally {
        ensureEngineMountPromiseRef.current = null;
      }
    },
  );

  useStageCanvasSync(stageRef);
  // The catalog's offline flash measurement for whatever is on screen, so
  // the governor can start clamped on a preset already known to strobe
  // rather than discovering it a flash at a time.
  const activeSensoryProfile = useMemo(
    () =>
      routeState.presetId
        ? fallbackCatalog.find((entry) => entry.id === routeState.presetId)
            ?.sensoryProfile
        : undefined,
    [fallbackCatalog, routeState.presetId],
  );
  useFlashSafety(stageRef, activeSensoryProfile);

  useEffect(() => {
    if (routeState.panel === 'browse') {
      void hydrateFullCatalogNow();
      return;
    }

    if (routeState.presetId) {
      if (fallbackCatalogReady) {
        const isPresetInFallback = fallbackCatalog.some(
          (entry) => entry.id === routeState.presetId,
        );
        if (
          !isPresetInFallback &&
          routeState.presetId !== FIRST_RUN_PRESET_ID
        ) {
          void hydrateFullCatalogNow();
        }
      } else {
        void hydrateFullCatalogNow();
      }
    }
  }, [
    routeState.panel,
    routeState.presetId,
    fallbackCatalogReady,
    fallbackCatalog,
    hydrateFullCatalogNow,
  ]);

  useEffect(() => {
    sessionDisposedRef.current = false;

    return () => {
      sessionDisposedRef.current = true;
      // React gives no signal distinguishing "unmounted for good" from
      // StrictMode's dev-only unmount-then-remount, which runs this cleanup and
      // the next mount body back to back in the same commit. Deferring by a
      // tick is what tells them apart: a same-tick remount flips
      // `sessionDisposedRef` back to `false` before the timer fires, so this
      // no-ops and the refs survive. The remount's ensureEngineMounted() then
      // joins the in-flight adapter promise still parked in
      // `engineAdapterPromiseRef` instead of building a second adapter — which
      // is what used to double every preset's compile/render work.
      //
      // The timer decides *whether to tear down*, not whether teardown is safe.
      // Safety comes from createLazyFactory comparing promise identity, so an
      // adapter that resolves after this ran disposes itself rather than
      // installing over a live session (see use-lazy-factory.ts).
      setTimeout(() => {
        if (!sessionDisposedRef.current) {
          return;
        }
        engineUnsubscribeRef.current?.();
        engineUnsubscribeRef.current = null;
        engineRef.current?.dispose();
        engineRef.current = null;
        engineAdapterPromiseRef.current = null;
        ensureEngineMountPromiseRef.current = null;
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (!engineRef.current?.isMounted()) {
      initialLaunchIntentRef.current = buildLaunchIntent(routeState);
    }
  }, [routeState]);

  useEffect(() => {
    if (engineSnapshot?.runtimeReady) {
      return;
    }
    if (
      !routeState.presetId &&
      !routeState.audioSource &&
      !attractModeEnabled
    ) {
      return;
    }

    const mountEngine = () => {
      void ensureEngineMounted().catch((error) => {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : 'Unable to start the visualizer runtime.',
        );
      });
    };

    // Attract-mode boots are decorative: nothing the visitor asked for depends
    // on them. Paying for the renderer boot up front (WebGPU probe + device
    // request, shader compile, first-run preset compile, first frames) used to
    // sit on the initial-load critical path as a ~2.5s main-thread block on
    // mid-range hardware. Let the shell paint and the page settle first, then
    // boot during idle budget. A deep-linked preset or audio source is a real
    // intent and still mounts immediately.
    if (!routeState.presetId && !routeState.audioSource) {
      return scheduleIdleTask(mountEngine, {
        idleTimeout: 2500,
        fallbackDelay: 800,
      });
    }

    mountEngine();
  }, [
    engineSnapshot?.runtimeReady,
    routeState.presetId,
    routeState.audioSource,
    attractModeEnabled,
    setStatusMessage,
  ]);

  // Make attract mode prove itself.
  //
  // Attract mode exists so the landing page for a visuals product has visuals
  // on it. When the boot preset renders blank, none of that is delivered and
  // the page still pays for it: a GPU device held open, a render loop at full
  // refresh rate, and a battery cost, all to composite nothing. That is
  // strictly worse than never booting — the visitor sees the same black
  // rectangle either way, and the launch card's CSS signal trace (which the
  // low-power path already relies on) is the honest fallback.
  //
  // Only the decorative case is judged: a route preset or an audio source is
  // something the visitor asked for and is never paused, however it looks.
  //
  // Two samples, spaced, after a settle: one sample can land between the
  // runtime reporting ready and its first composited frame, and reading an
  // uncomposited canvas is exactly what `sampleStageLiveness` refuses to call
  // blank. An unreadable verdict leaves attract mode alone.
  useEffect(() => {
    if (
      !attractModeEnabled ||
      attractLivenessJudgedRef.current ||
      !engineSnapshot?.runtimeReady ||
      routeState.presetId ||
      routeState.audioSource
    ) {
      return;
    }

    const timers: number[] = [];
    let cancelled = false;
    const readStage = () => {
      const canvas = stageRef.current?.querySelector('canvas');
      return canvas ? sampleStageLiveness(canvas) : null;
    };

    timers.push(
      window.setTimeout(() => {
        if (cancelled) return;
        const first = readStage();
        if (!shouldRetireAttractRender([first])) {
          // Rendering, or unjudgeable. Only a settled "rendering" is worth
          // latching: an unreadable canvas may become readable later.
          attractLivenessJudgedRef.current = first?.visible === true;
          return;
        }

        timers.push(
          window.setTimeout(() => {
            if (cancelled) return;
            const second = readStage();
            if (!shouldRetireAttractRender([first, second])) {
              attractLivenessJudgedRef.current = second?.visible === true;
              return;
            }

            attractLivenessJudgedRef.current = true;
            log.log('attract render is blank; pausing the decorative loop');
            // Paused, not disposed: the engine stays warm so pressing Play
            // demo is still instant, and `resumePreview()` on audio start
            // brings it back if the visitor's own session renders fine.
            engineRef.current?.pausePreview();
            setAttractModeEnabled(false);
          }, ATTRACT_LIVENESS_CONFIRM_MS),
        );
      }, ATTRACT_LIVENESS_SETTLE_MS),
    );

    return () => {
      cancelled = true;
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [
    attractModeEnabled,
    engineSnapshot?.runtimeReady,
    routeState.presetId,
    routeState.audioSource,
  ]);

  usePresetRouteSync({
    engineSnapshot,
    pendingPresetIdRef,
    routeState,
    setRouteState,
  });

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.isMounted()) {
      return;
    }

    if (routeState.panel === 'editor') {
      engine.openTool('editor');
      return;
    }

    engine.setOverlayOpen(false);
  }, [routeState.panel]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine?.isMounted()) {
      return;
    }

    engine.setCollectionTag(routeState.collectionTag ?? null);
  }, [routeState.collectionTag]);

  useEffect(() => {
    const routePresetId = routeState.presetId;
    const requestedPresetId = routePresetId
      ? (resolvePresetId(engineSnapshot?.catalogEntries ?? [], routePresetId) ??
        routePresetId)
      : null;

    // Every branch below is decided by `decidePresetRoutePush` so the rules
    // (especially the engine-moved guard that stops the route and the engine
    // fighting over the address bar) are unit-testable in isolation.
    const decision = decidePresetRoutePush({
      engineMounted: Boolean(engineRef.current?.isMounted()),
      requestedPresetId,
      activePresetId: engineSnapshot?.activePresetId,
      handledRouteRequestId: handledRouteRequestRef.current,
      pendingPresetId: pendingPresetIdRef.current,
      hasFailed: requestedPresetId
        ? failedPresetIdsRef.current.has(requestedPresetId)
        : false,
    });

    if (decision !== 'load') {
      if (decision === 'engine-not-mounted') {
        if (requestedPresetId) {
          log.log(`engine not mounted, deferring preset ${requestedPresetId}`);
        }
        // Nothing was handled while unmounted; let the request through again
        // once the engine mounts.
        handledRouteRequestRef.current = null;
      } else if (decision === 'no-request') {
        handledRouteRequestRef.current = null;
      } else if (decision === 'already-active') {
        pendingPresetIdRef.current = null;
        handledRouteRequestRef.current = requestedPresetId;
      } else if (decision === 'engine-moved') {
        // Deliberately NOT clearing pendingPresetIdRef: it is already null on
        // an engine-initiated move, and usePresetRouteSync needs it null to
        // publish the engine's new id to the URL.
        log.log(
          `engine moved to ${engineSnapshot?.activePresetId ?? 'none'} on its own; not re-pushing route preset ${requestedPresetId}`,
        );
      }
      return;
    }
    // `decision === 'load'` already implies this, but the compiler cannot see
    // through the helper; this keeps the rest of the effect non-null.
    if (!requestedPresetId || !engineRef.current) {
      return;
    }

    pendingPresetIdRef.current = requestedPresetId;
    handledRouteRequestRef.current = requestedPresetId;
    log.log(
      `requesting ${requestedPresetId} (active: ${engineSnapshot?.activePresetId ?? 'none'})`,
    );
    // A slow or unavailable preset used to leave a black canvas and a "Try
    // again" toast with nothing to try again with. Fall back to the known-good
    // first-run preset so the visitor still ends up watching something.
    const fallBackToFirstRunPreset = (message: string) => {
      failedPresetIdsRef.current.add(requestedPresetId);
      pendingPresetIdRef.current = null;

      const engine = engineRef.current;
      if (!engine || requestedPresetId === FIRST_RUN_PRESET_ID) {
        noteSubstitution(
          'preset-load-failed',
          `${requestedPresetId}: ${message}`,
        );
        setStatusMessage(message);
        return;
      }

      noteSubstitution('fallback-preset', `${requestedPresetId}: ${message}`);
      setStatusMessage(`${message} Showing another preset instead.`);
      void engine.loadPreset(FIRST_RUN_PRESET_ID).catch(() => {
        log.log(`fallback preset ${FIRST_RUN_PRESET_ID} also failed`);
      });
    };

    let timedOut = false;
    let fellBack = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      if (pendingPresetIdRef.current === requestedPresetId) {
        fellBack = true;
        fallBackToFirstRunPreset(`Preset "${requestedPresetId}" timed out.`);
      }
    }, 10_000);

    void engineRef.current.loadPreset(requestedPresetId).then(
      () => {
        clearTimeout(timeoutId);
        if (timedOut) {
          // The fallback fired while this load was still finishing — a race
          // the wall-clock timer cannot avoid. The visitor asked for this
          // preset and it did load (the compile is cached now), so reclaim
          // the stage from the substitute instead of stranding them on it.
          //
          // Unless the visitor has since navigated: the fallback cleared
          // pendingPresetIdRef, so a non-null value here means a NEWER
          // request is in flight — reclaiming now would hijack it with a
          // later engine revision. Their pick wins; only the failed-preset
          // mark is lifted so the original id stays retryable.
          if (fellBack) {
            failedPresetIdsRef.current.delete(requestedPresetId);
            if (pendingPresetIdRef.current !== null) {
              log.log(
                `skipping reclaim of ${requestedPresetId}: ${pendingPresetIdRef.current} was requested meanwhile`,
              );
              return;
            }
            setStatusMessage(null);
            log.log(`reclaiming ${requestedPresetId} after timeout fallback`);
            void engineRef.current?.loadPreset(requestedPresetId).catch(() => {
              failedPresetIdsRef.current.add(requestedPresetId);
            });
          }
          return;
        }
        log.log(`loaded ${requestedPresetId}`);
        if (pendingPresetIdRef.current === requestedPresetId) {
          pendingPresetIdRef.current = null;
        }
      },
      () => {
        clearTimeout(timeoutId);
        if (timedOut) return;
        if (pendingPresetIdRef.current === requestedPresetId) {
          fallBackToFirstRunPreset(
            `"${requestedPresetId}" could not be loaded.`,
          );
        }
      },
    );

    return () => clearTimeout(timeoutId);
  }, [
    engineSnapshot?.activePresetId,
    engineSnapshot?.catalogEntries,
    routeState.presetId,
    setStatusMessage,
  ]);

  useAudioSourceSync({
    engineRef,
    engineSnapshot,
    routeState,
    setRouteState,
    setStatusMessage,
  });

  useDocumentDatasetSync({
    audioActive: engineSnapshot?.audioActive,
    agentMode: routeState.agentMode,
  });

  return {
    deferredSearch,
    dismissToast,
    engineSnapshot,
    exportPreset: () => {
      engineRef.current?.exportPreset();
    },
    goBackPreset: async () => {
      await engineRef.current?.goBackPreset();
    },
    revertEditorSource: () => {
      engineRef.current?.revertEditorSource();
    },
    duplicatePreset: async () => {
      await engineRef.current?.duplicatePreset();
    },
    deleteActivePreset: async () => {
      await engineRef.current?.deleteActivePreset();
    },
    getVideoExportRuntime: () =>
      engineRef.current?.getVideoExportRuntime() ?? null,
    fallbackCatalog,
    fallbackCatalogError,
    fallbackCatalogReady,
    fullCatalogReady,
    handleYoutubeUrlKeyDown,
    activityCatalog,
    importPresetFiles: async (files: FileList | File[] | null) => {
      if (!files?.length) {
        return;
      }
      const adapter = await ensureEngineMounted();
      await adapter.importPreset(files);
    },
    loadYouTubePreview,
    loadRecentYouTubeVideo,
    motionPreference,
    pendingPresetIdRef,
    qualityPreset,
    recentYouTubeVideos,
    refreshCatalogActivity,
    renderPreferences,
    searchQuery,
    presetPreviews,
    setQualityPreset: (presetId: string) => {
      if (engineRef.current?.isMounted()) {
        engineRef.current.setQualityPreset(presetId);
        return;
      }
      setQualityPresetById(presetId, {
        presets: DEFAULT_QUALITY_PRESETS,
        storageKey: QUALITY_STORAGE_KEY,
      });
    },
    setAutoplay: (enabled: boolean) => {
      engineRef.current?.setAutoplay(enabled);
    },
    setTransitionMode: (mode: 'blend' | 'cut') => {
      engineRef.current?.setTransitionMode(mode);
    },
    startManualCrossfade: () => {
      engineRef.current?.startManualCrossfade();
    },
    setCrossfade: (position: number) => {
      engineRef.current?.setCrossfade(position);
    },
    getCrossfade: () => engineRef.current?.getCrossfade() ?? null,
    setBlendDuration: (value: number) => {
      engineRef.current?.setBlendDuration(value);
    },
    updateEditorSource: (source: string) => {
      engineRef.current?.updateEditorSource(source);
    },
    updateFieldLive: (key: string, value: number) => {
      engineRef.current?.updateFieldLive(key, value);
    },
    applyEditorSourceAwaited: async (source: string) =>
      (await engineRef.current?.applyEditorSourceAwaited(source)) ?? null,
    applyEditorFieldsAwaited: async (
      updates: Record<string, string | number>,
    ) => (await engineRef.current?.applyEditorFieldsAwaited(updates)) ?? null,
    getEditorSessionState: () =>
      engineRef.current?.getEditorSessionState() ?? null,
    updateInspectorField: (key: string, value: number) => {
      engineRef.current?.updateInspectorField?.(key, value);
    },
    getActiveCompiledPreset: () =>
      engineRef.current?.getActiveCompiledPreset() ?? null,
    setSearchQuery,
    setShowExtendedSources,
    setStatusMessage,
    setYoutubeUrl,
    showExtendedSources,
    stageRef,
    refreshPresetPreviews,
    startAudioSource: async (request: {
      cropTarget?: HTMLElement | null;
      launchState?: SessionRouteState;
      source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file';
      stream?: MediaStream;
    }) => {
      const launchIntent = buildLaunchIntent(request.launchState ?? routeState);
      initialLaunchIntentRef.current = launchIntent;
      const adapter = await ensureEngineMounted(launchIntent);

      if (request.source === 'demo' || request.source === 'microphone') {
        await adapter.setAudioSource({
          source: request.source,
          ...(request.stream ? { stream: request.stream } : {}),
        });
        return;
      }

      if (!request.stream) {
        throw new Error('A captured media stream is required for tab audio.');
      }

      await adapter.setAudioSource({
        source: request.source,
        stream: request.stream,
        cropTarget: request.cropTarget,
      });
    },
    statusMessage,
    toast,
    toggleFavoritePreset: async (presetId: string, favorite: boolean) => {
      const store = await ensureCatalogStore();
      await store.setFavorite(presetId, favorite);
      await refreshCatalogActivity();
    },
    toggleExtendedSources: () => setShowExtendedSources((current) => !current),
    requestPresetPreviews,
    youtubeCanLoad,
    youtubeFeedback,
    youtubeInputInvalid,
    youtubeLoading,
    youtubePreviewRef,
    youtubeReady,
    youtubeTransport,
    youtubeTransportControls,
    youtubeUrl,
    clearRecentYouTubeVideos,
    pausePreview: () => {
      engineRef.current?.pausePreview();
    },
    resumePreview: () => {
      engineRef.current?.resumePreview();
    },
    stopAudio: async () => {
      await engineRef.current?.stopAudio().catch((error) => {
        console.debug('Audio stop failed.', error);
      });
    },
  };
}
