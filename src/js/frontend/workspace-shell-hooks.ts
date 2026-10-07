/**
 * Workspace Shell Lifecycle Hooks — coordinates URL routing synchronizations, microphone
 * permissions, link sharing, and canonical state transitions across the top-level visualizer shell.
 */

import { type SetStateAction, useCallback, useMemo, useRef } from 'react';
import { getActiveAccessibilityPreference } from '../core/accessibility-preferences.ts';
import {
  acquireMicrophoneStream,
  describeInputProcessingWarning,
} from '../core/audio-constants.ts';
import { noteGrowthEvent } from '../core/services/preset-telemetry.ts';
import { resolvePresetCatalogEntry } from '../milkdrop/preset-id-resolution.ts';
import { FIRST_RUN_PRESET_ID } from '../milkdrop/runtime/first-run-preset.ts';
import { isInAppBrowser } from '../utils/browser/device-detect.ts';
import {
  formatPresetShareCopy,
  shareOrCopyLink,
} from '../utils/media/share-link.ts';
import type {
  AudioSource,
  AudioStartOutcome,
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';
import type { EngineSnapshot } from './engine/milkdrop-engine-adapter.ts';
import { disposeActiveFileAudio } from './file-audio.ts';
import {
  buildCanonicalUrl,
  buildRemixShareUrl,
  REMIX_URL_FAILED,
} from './url-state.ts';
import { codeForLocalShare } from './workspace-actions.ts';
import {
  buildStarterPresets,
  createFieldMatcher,
  getCollectionTags,
  isDocumentAudioActive,
  mapRuntimeCatalogEntry,
  matchesPreset,
  mergeCatalogActivity,
  passesFlashPreference,
  pickFavoritePresets,
  pickRecentPresets,
} from './workspace-helpers.ts';

const IN_APP_BROWSER_LIMITED_MIC_MESSAGE =
  "In-app browsers (Instagram, TikTok, Twitter) limit live mic access. Started with demo audio. Tap '…' to open in Safari/Chrome.";

/**
 * When the requested preset is missing (e.g. a dead link), fall back to the
 * featured preset and surface the heal in a status message. Shared by the
 * file-audio and microphone/demo start paths.
 */
function buildHealedPresetRoute(
  routeState: SessionRouteState,
  missingRequestedPreset: boolean,
  featuredPreset: PresetCatalogEntry | null | undefined,
  audioSource: AudioSource,
): {
  nextRouteState: SessionRouteState;
  healMessage: string | null;
} {
  const healedPresetId = missingRequestedPreset
    ? (featuredPreset?.id ?? null)
    : routeState.presetId;
  const healMessage =
    missingRequestedPreset && featuredPreset
      ? `Requested preset unavailable. Starting with ${featuredPreset.title}.`
      : null;
  return {
    nextRouteState: {
      ...routeState,
      audioSource,
      panel: null,
      presetId: healedPresetId,
    },
    healMessage,
  };
}

type WorkspaceShellOrchestrationArgs = {
  commitRoute: (nextState: SetStateAction<SessionRouteState>) => void;
  deferredSearch: string;
  engineSnapshot: EngineSnapshot | null;
  fallbackCatalog: PresetCatalogEntry[];
  fallbackCatalogError: string | null;
  fallbackCatalogReady: boolean;
  fullCatalogReady?: boolean;
  activityCatalog: PresetCatalogEntry[];
  goBackPreset: () => Promise<void>;
  importPresetFiles: (files: FileList | File[] | null) => Promise<void>;
  routeState: SessionRouteState;
  setStatusMessage: (message: string | null) => void;
  /** Holds or releases the stage; returns the state actually applied. */
  setPlaybackPaused: (paused: boolean) => boolean;
  startAudioSource: (request: {
    cropTarget?: HTMLElement | null;
    launchState?: SessionRouteState;
    source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file';
    stream?: MediaStream;
  }) => Promise<void>;
  updateEditorSource: (source: string) => void;
  stageRef: React.RefObject<HTMLDivElement | null>;
  youtubePreviewRef: React.RefObject<HTMLDivElement | null>;
};

export function useWorkspaceShellOrchestration({
  commitRoute,
  deferredSearch,
  engineSnapshot,
  fallbackCatalog,
  fallbackCatalogError,
  fallbackCatalogReady,
  fullCatalogReady,
  activityCatalog,
  goBackPreset,
  importPresetFiles,
  routeState,
  setStatusMessage,
  setPlaybackPaused,
  startAudioSource,
  updateEditorSource,
  stageRef: _stageRef,
  youtubePreviewRef,
}: WorkspaceShellOrchestrationArgs) {
  const audioStartInProgressRef = useRef(false);

  // Dep on the narrow snapshot fields, never the snapshot object: while audio
  // plays the snapshot is rebuilt every frame (audioEnergy changes), and a
  // whole-object dep made this remap+merge the full catalog per frame — and
  // hand a fresh catalog identity to every consumer, re-filtering the browse
  // panel at frame rate. catalogEntries/runtimeReady keep stable identities
  // across those rebuilds (see engine-snapshot.ts equality).
  const snapshotCatalogEntries = engineSnapshot?.catalogEntries;
  const snapshotRuntimeReady = engineSnapshot?.runtimeReady ?? false;
  const enrichedCatalog = useMemo(() => {
    const runtimeCatalog = (snapshotCatalogEntries ?? []).map(
      mapRuntimeCatalogEntry,
    );
    const runtimeCatalogReady =
      snapshotRuntimeReady || runtimeCatalog.length > 0;
    const rawCatalog = runtimeCatalogReady ? runtimeCatalog : fallbackCatalog;
    return mergeCatalogActivity(rawCatalog, activityCatalog);
  }, [
    snapshotCatalogEntries,
    snapshotRuntimeReady,
    fallbackCatalog,
    activityCatalog,
  ]);

  const catalogReady = useMemo(
    () =>
      (snapshotRuntimeReady || fallbackCatalogReady) &&
      enrichedCatalog.length > 0,
    [snapshotRuntimeReady, fallbackCatalogReady, enrichedCatalog],
  );

  // Only report a catalog error when there is nothing to show — a fallback
  // fetch failure is irrelevant once the runtime catalog is populated.
  const catalogError = useMemo(
    () => (enrichedCatalog.length === 0 ? fallbackCatalogError : null),
    [enrichedCatalog, fallbackCatalogError],
  );

  const filteredCatalog = useMemo(() => {
    const matcher = deferredSearch
      ? createFieldMatcher(deferredSearch, { allowSubsequence: false })
      : null;
    return enrichedCatalog.filter((entry) => {
      if (
        routeState.collectionTag &&
        !entry.tags?.includes(routeState.collectionTag)
      ) {
        return false;
      }
      return matcher ? matchesPreset(entry, matcher) : true;
    });
  }, [enrichedCatalog, routeState.collectionTag, deferredSearch]);

  const currentPreset = useMemo(
    () =>
      filteredCatalog.find(
        (entry) => entry.id === engineSnapshot?.activePresetId,
      ) ??
      enrichedCatalog.find(
        (entry) => entry.id === engineSnapshot?.activePresetId,
      ) ??
      null,
    [filteredCatalog, enrichedCatalog, engineSnapshot?.activePresetId],
  );

  const starterPresets = useMemo(
    () => buildStarterPresets(enrichedCatalog),
    [enrichedCatalog],
  );

  // The deliberate first-run pick wins: it is measured for audio reactivity
  // and brightness (see milkdrop/runtime/first-run-preset.ts). Falling
  // through to catalog order resurfaces eos-glowsticks — the near-black
  // preset that pick exists to replace — exactly on the healed-deep-link and
  // featured surfaces where a first impression is being made.
  const featuredPreset = useMemo(
    () =>
      enrichedCatalog.find((entry) => entry.id === FIRST_RUN_PRESET_ID) ??
      starterPresets[0]?.preset ??
      enrichedCatalog[0] ??
      null,
    [starterPresets, enrichedCatalog],
  );

  const resolvedRequestedPreset = useMemo(
    () =>
      routeState.presetId
        ? resolvePresetCatalogEntry(enrichedCatalog, routeState.presetId)
        : null,
    [enrichedCatalog, routeState.presetId],
  );

  const selectedPreset = useMemo(
    () => resolvedRequestedPreset ?? currentPreset ?? null,
    [resolvedRequestedPreset, currentPreset],
  );

  const audioActive = useMemo(
    () => engineSnapshot?.audioActive || isDocumentAudioActive(),
    [engineSnapshot?.audioActive],
  );

  const runtimeReady = useMemo(
    () => Boolean(engineSnapshot?.runtimeReady),
    [engineSnapshot?.runtimeReady],
  );

  const engineReady = useMemo(() => catalogError === null, [catalogError]);

  // No pendingPresetIdRef shield here: the ref is seeded with the arrival's
  // route preset id (workspace-hooks.ts) so the engine→route sync cannot
  // clobber a deep link while its launch-intent load is in flight. But once
  // the FULL catalog has settled and still cannot resolve the id, that load
  // can never succeed (loadPreset draws from the same store+bundle), so the
  // seed would otherwise suppress "missing" forever — stranding a dead share
  // link on the launch form with the heal path never firing.
  const missingRequestedPreset = Boolean(
    routeState.presetId &&
      catalogReady &&
      (fullCatalogReady ?? true) &&
      !resolvedRequestedPreset,
  );

  const loadingRequestedPreset = Boolean(
    routeState.presetId && !selectedPreset && !missingRequestedPreset,
  );

  const shellState = useMemo(
    () => ({
      catalog: enrichedCatalog,
      catalogError,
      catalogReady: catalogReady,
      collectionTags: getCollectionTags(enrichedCatalog),
      currentPreset,
      engineReady,
      favoritePresets: pickFavoritePresets(enrichedCatalog),
      featuredPreset,
      filteredCatalog,
      audioActive,
      loadingRequestedPreset,
      missingRequestedPreset,
      recentPresets: pickRecentPresets(enrichedCatalog),
      runtimeReady,
      selectedPreset,
      starterPresets,
      stageAnchoredToolOpen: routeState.panel === 'editor',
      updateEditorSource,
    }),
    [
      enrichedCatalog,
      catalogError,
      catalogReady,
      currentPreset,
      engineReady,
      featuredPreset,
      filteredCatalog,
      audioActive,
      loadingRequestedPreset,
      missingRequestedPreset,
      routeState.panel,
      runtimeReady,
      selectedPreset,
      starterPresets,
      updateEditorSource,
    ],
  );

  // Functional update on purpose: this runs from Escape handlers and
  // shortcuts that can land in the same keystroke as a preset change, and
  // spreading the captured `routeState` here reverted that change.
  const updatePanel = useCallback(
    (panel: PanelState) => {
      commitRoute((current) =>
        current.panel === panel ? current : { ...current, panel },
      );
    },
    [commitRoute],
  );

  const handleVisualSearch = useCallback(async () => {
    updatePanel(routeState.panel === 'finder' ? null : 'finder');
  }, [updatePanel, routeState.panel]);

  const handlePresetSelection = (presetId: string) => {
    commitRoute((current) => ({ ...current, presetId, panel: null }));
  };

  const handleShufflePreset = () => {
    const activePresetId =
      routeState.presetId ?? engineSnapshot?.activePresetId;
    // Reduce flashing hid measured high-risk presets from Browse while
    // shuffle could still land on one. Filtered before every pool below so
    // no fallback reaches them.
    const reduceFlashing = getActiveAccessibilityPreference().reduceFlashing;
    const allowed = (entries: PresetCatalogEntry[]) =>
      reduceFlashing
        ? entries.filter((entry) => passesFlashPreference(entry, true))
        : entries;
    const filteredCatalog = allowed(shellState.filteredCatalog);
    const catalog = allowed(shellState.catalog);
    const preferredPool =
      filteredCatalog.length > 1
        ? filteredCatalog
        : catalog.length > 1
          ? catalog
          : [];
    const shuffledPool = preferredPool.filter(
      (entry) => entry.id !== activePresetId,
    );
    const fallbackPool = filteredCatalog.length > 0 ? filteredCatalog : catalog;
    const nextPool = shuffledPool.length > 0 ? shuffledPool : fallbackPool;
    if (!nextPool.length) {
      return;
    }
    const scatterWeight = (entry: PresetCatalogEntry) => {
      const fidelityClass = entry.visualCertification?.fidelityClass;
      const fidelityWeight =
        fidelityClass === 'exact'
          ? 8
          : fidelityClass === 'near-exact'
            ? 6
            : fidelityClass === 'partial'
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
    const scoredPool = nextPool.map((entry) => ({
      entry,
      weight: scatterWeight(entry),
    }));
    const totalWeight = scoredPool.reduce((sum, s) => sum + s.weight, 0);
    let roll = Math.random() * totalWeight;
    const picked = scoredPool.find((s) => {
      roll -= s.weight;
      return roll <= 0;
    });

    const nextPreset = picked?.entry ?? nextPool[0];
    if (!nextPreset) {
      return;
    }

    handlePresetSelection(nextPreset.id);
  };

  const handlePreviousPreset = () => {
    void goBackPreset();
  };

  const handlePlayPreset = async (presetId: string) => {
    commitRoute({
      ...routeState,
      panel: null,
      presetId,
    });
  };

  /**
   * Starts `source` and says whether it is now playing. Failures are still
   * shown to the visitor as a status message; the outcome hands the same
   * message to callers that report on their own (the agent bridge), which
   * otherwise had to read the status log and wait out a timeout.
   */
  const handleAudioStart = async (
    source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file',
    deviceId?: string,
  ): Promise<AudioStartOutcome> => {
    if (audioStartInProgressRef.current) {
      return {
        ok: false,
        source: null,
        message: 'Another audio source is still starting.',
      };
    }
    audioStartInProgressRef.current = true;

    // Starting any other source replaces file playback, and the file element
    // loops, so without this it would keep playing underneath the new source.
    // `'file'` is excluded because that path runs `startAudioSource` directly
    // after adopting its own handle; disposing here would tear it straight
    // back down.
    if (source !== 'file') {
      disposeActiveFileAudio();
    }

    // Pre-warm the shared Three.js AudioContext while we're still inside
    // the user gesture (click/tap). On iOS Safari, AudioContext.resume()
    // called outside a user gesture stays suspended — the context is
    // created deep inside the engine after getUserMedia + engine mount,
    // which breaks the gesture chain. Three.js uses a singleton context
    // (AudioContext.getContext()), so resuming it here ensures the
    // AudioListener created later reuses an already-running context.
    try {
      const { AudioContext: ThreeAudioContext } = await import('three');
      const ctx = ThreeAudioContext.getContext() as unknown as AudioContext;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
    } catch {
      // AudioContext not available — engine will handle the error.
    }

    try {
      setStatusMessage(null);
      const { nextRouteState, healMessage } = buildHealedPresetRoute(
        routeState,
        shellState.missingRequestedPreset,
        shellState.featuredPreset,
        source,
      );

      if (healMessage) {
        setStatusMessage(healMessage);
      }

      if (source === 'microphone') {
        const inApp = isInAppBrowser();

        if (!navigator.mediaDevices?.getUserMedia) {
          const insecure =
            typeof window !== 'undefined' &&
            window.isSecureContext === false &&
            window.location?.protocol === 'http:' &&
            !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(
              window.location.hostname,
            );

          if (inApp) {
            const demoRouteState = {
              ...nextRouteState,
              audioSource: 'demo' as const,
            };
            commitRoute(demoRouteState);
            await startAudioSource({
              source: 'demo',
              launchState: demoRouteState,
            });
            setStatusMessage(IN_APP_BROWSER_LIMITED_MIC_MESSAGE);
            return {
              ok: false,
              source: 'demo',
              message: IN_APP_BROWSER_LIMITED_MIC_MESSAGE,
            };
          }

          const message = insecure
            ? 'Microphone needs a secure connection. Open this site over HTTPS and try again.'
            : 'Microphone capture is not available in this browser.';
          setStatusMessage(message);
          return { ok: false, source: null, message };
        }

        let permissionStream: MediaStream;
        try {
          permissionStream = await acquireMicrophoneStream({ deviceId });
        } catch (error) {
          if (inApp) {
            const demoRouteState = {
              ...nextRouteState,
              audioSource: 'demo' as const,
            };
            commitRoute(demoRouteState);
            await startAudioSource({
              source: 'demo',
              launchState: demoRouteState,
            });
            setStatusMessage(IN_APP_BROWSER_LIMITED_MIC_MESSAGE);
            return {
              ok: false,
              source: 'demo',
              message: IN_APP_BROWSER_LIMITED_MIC_MESSAGE,
            };
          }

          const errName =
            error instanceof DOMException ||
            (error && typeof error === 'object' && 'name' in error)
              ? (error as Error).name
              : '';
          const msg =
            errName === 'NotAllowedError' || errName === 'PermissionDeniedError'
              ? 'Microphone access was denied. Check browser settings and OS Privacy Settings (macOS Privacy & Security / Windows Privacy Settings).'
              : errName === 'NotFoundError'
                ? 'No microphone hardware found. Please connect a microphone and try again.'
                : errName === 'NotReadableError' ||
                    errName === 'TrackStartError'
                  ? 'Microphone is in use by another app (for example, Zoom or Teams). Close that app and try again.'
                  : error instanceof Error && error.message
                    ? error.message
                    : 'Unable to access the microphone.';
          throw new Error(msg);
        }

        try {
          await startAudioSource({
            source,
            stream: permissionStream,
            launchState: nextRouteState,
          });
        } catch (error) {
          permissionStream.getTracks().forEach((track) => track.stop());
          throw error;
        }
        commitRoute(nextRouteState);
        // Read back what the browser actually granted. Asking for the
        // processing flags off is not the same as getting them off, and a
        // gain-controlled feed looks fine while quietly flattening every
        // beat the presets are supposed to move to.
        const processingWarning =
          describeInputProcessingWarning(permissionStream);
        if (processingWarning) {
          setStatusMessage(processingWarning);
        }
        return { ok: true, source };
      }

      if (source === 'demo') {
        commitRoute(nextRouteState);
        await startAudioSource({ source, launchState: nextRouteState });
        return { ok: true, source };
      }

      const { captureDisplayAudioStream } = await import(
        '../ui/audio-advanced-sources.ts'
      );
      const stream = await captureDisplayAudioStream({
        unavailableMessage:
          'Tab, system, and YouTube capture need a desktop browser. Use the microphone instead.',
        missingAudioMessage:
          source === 'youtube'
            ? 'No YouTube audio track was captured. Re-share and enable Share tab audio.'
            : 'No tab or system audio track was captured. Re-share and enable Share audio.',
        // For YouTube the player lives in this tab, so pre-select it. For a
        // plain tab/system capture the user is reaching for a different tab or desktop audio.
        preferCurrentTab: source === 'youtube',
        onEnded: () => {
          setStatusMessage(
            'Screen sharing stopped, so the audio feed ended. Start capture again to keep going.',
          );
        },
      });
      commitRoute(nextRouteState);
      await startAudioSource({
        source,
        stream,
        cropTarget: youtubePreviewRef.current,
        launchState: nextRouteState,
      });
      return { ok: true, source };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Audio start failed.';
      setStatusMessage(message);
      return { ok: false, source: null, message };
    } finally {
      audioStartInProgressRef.current = false;
    }
  };

  const handleAudioStop = () => {
    // The engine side is torn down by the route change, but a playing file is
    // ours: it is an <audio> element with `loop = true`, so leaving it alone
    // meant the track carried on audibly after the UI said audio had stopped.
    disposeActiveFileAudio();
    commitRoute((current) => ({ ...current, audioSource: null }));
    setStatusMessage('Audio stopped.');
  };

  /**
   * Space, and the dock's pause button. Holds the picture where it is and
   * keeps everything else — preset, history, the audio session — so a second
   * press carries on from the same frame. Stopping audio is a different verb
   * (it unmounts the engine and returns to the start page) and lives in the
   * menu under its own name.
   */
  const handleTogglePlayback = () => {
    const paused = !(engineSnapshot?.playbackPaused ?? false);
    const applied = setPlaybackPaused(paused);
    if (paused && !applied) {
      // Nothing is live to hold: before playback starts the stage is the
      // idle preview, which has no pause.
      return;
    }
    setStatusMessage(applied ? 'Paused. Press Space to resume.' : 'Resumed.');
  };

  const handleImport = async (files: FileList | File[] | null) => {
    try {
      await importPresetFiles(files);
      updatePanel('editor');
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'Preset import failed. The files may be unreadable or storage may be full.',
      );
    }
  };

  const handleShowCurrentLink = async () => {
    // The preset on stage, not the route's: the route can trail the engine
    // (a Remix selects its new preset in the runtime), and sharing from the
    // route right after a Remix linked the parent instead.
    const activeId = engineSnapshot?.activePresetId ?? routeState.presetId;
    const sharedPreset =
      (activeId
        ? shellState.catalog.find((entry) => entry.id === activeId)
        : null) ?? selectedPreset;
    const currentUrl = buildCanonicalUrl(
      { ...routeState, presetId: activeId ?? null, agentMode: false },
      window.location,
    );
    // A preset made or imported here has an id no one else can load, so the
    // link carries its code (an edited one already does, via the address
    // bar's #code=). Without it the recipient got "could not be loaded".
    const local = Boolean(sharedPreset && !sharedPreset.bundledFile);
    const source = engineSnapshot?.sessionState?.source;
    let href = currentUrl.toString();
    if (local && source && !currentUrl.hash) {
      try {
        href = buildRemixShareUrl(
          currentUrl,
          codeForLocalShare(source, {
            local,
            dirty: false,
            title: sharedPreset?.title,
          }),
        );
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : REMIX_URL_FAILED,
        );
        return;
      }
    }

    let shareTitle = 'Stims visualizer';
    let shareText = 'Open this Stims visualizer view.';

    if (sharedPreset) {
      const shareCopy = formatPresetShareCopy({
        id: sharedPreset.id,
        title: sharedPreset.title,
        author: sharedPreset.author,
      });
      shareTitle = shareCopy.title;
      shareText = shareCopy.text;
    }

    const result = await shareOrCopyLink(href, {
      title: shareTitle,
      text: shareText,
    });

    noteGrowthEvent(
      result === 'shared'
        ? 'share-shared'
        : result === 'copied'
          ? 'share-copied'
          : result === 'cancelled'
            ? 'share-cancelled'
            : 'share-unavailable',
      sharedPreset?.id,
    );

    const carries = local ? " — it carries this preset's code" : '';
    if (result === 'shared') {
      setStatusMessage(`Link shared${carries}.`);
      return;
    }

    if (result === 'copied') {
      setStatusMessage(`Link copied${carries}.`);
      return;
    }

    if (result === 'cancelled') {
      return;
    }

    setStatusMessage(
      `Current link: ${currentUrl.pathname}${currentUrl.search}`,
    );
  };

  return {
    ...shellState,
    handleAudioStart,
    handleAudioStop,
    handleTogglePlayback,
    handleImport,
    handlePlayPreset,
    handlePresetSelection,
    handlePreviousPreset,
    handleShowCurrentLink,
    handleShufflePreset,
    handleVisualSearch,
    updatePanel,
    updateEditorSource: shellState.updateEditorSource,
  };
}
