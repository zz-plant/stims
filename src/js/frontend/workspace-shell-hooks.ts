import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  acquireMicrophoneStream,
  describeInputProcessingWarning,
} from '../core/audio-constants.ts';
import { resolvePresetCatalogEntry } from '../milkdrop/preset-id-resolution.ts';
import { FIRST_RUN_PRESET_ID } from '../milkdrop/runtime/first-run-preset.ts';
import { isInAppBrowser } from '../utils/browser/device-detect.ts';
import {
  formatPresetShareCopy,
  shareOrCopyLink,
} from '../utils/media/share-link.ts';
import type {
  AudioSource,
  PanelState,
  PresetCatalogEntry,
  SessionRouteState,
} from './contracts.ts';
import type { EngineSnapshot } from './engine/milkdrop-engine-adapter.ts';
import { buildCanonicalUrl } from './url-state.ts';
import {
  buildStarterPresets,
  getCollectionTags,
  isDocumentAudioActive,
  mapRuntimeCatalogEntry,
  matchesPreset,
  mergeCatalogActivity,
  pickFavoritePresets,
  pickRecentPresets,
} from './workspace-helpers.ts';

const IN_APP_BROWSER_LIMITED_MIC_MESSAGE =
  "In-app browsers (Instagram, TikTok, Twitter) limit live mic access. Started with Demo Audio. Tap '...' to open in Safari/Chrome.";

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
  commitRoute: (nextState: SessionRouteState) => void;
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
  startAudioSource,
  updateEditorSource,
  stageRef: _stageRef,
  youtubePreviewRef,
}: WorkspaceShellOrchestrationArgs) {
  const audioStartInProgressRef = useRef(false);
  const fileAudioContextRef = useRef<AudioContext | null>(null);

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

  const filteredCatalog = useMemo(
    () =>
      enrichedCatalog.filter((entry) => {
        if (
          routeState.collectionTag &&
          !entry.tags?.includes(routeState.collectionTag)
        ) {
          return false;
        }
        return matchesPreset(entry, deferredSearch);
      }),
    [enrichedCatalog, routeState.collectionTag, deferredSearch],
  );

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

  const updatePanel = useCallback(
    (panel: PanelState) => {
      if (panel === routeState.panel) return;
      commitRoute({ ...routeState, panel });
    },
    [commitRoute, routeState],
  );

  const handleVisualSearch = useCallback(async () => {
    updatePanel(routeState.panel === 'finder' ? null : 'finder');
  }, [updatePanel, routeState.panel]);

  const handlePresetSelection = (presetId: string) => {
    commitRoute({ ...routeState, presetId, panel: null });
  };

  const handleBrowseRecovery = () => {
    commitRoute({ ...routeState, presetId: null, panel: 'browse' });
  };

  const handleFeaturedPresetSelection = () => {
    if (!shellState.featuredPreset) {
      return;
    }

    handlePresetSelection(shellState.featuredPreset.id);
  };

  const handleShufflePreset = () => {
    const activePresetId =
      routeState.presetId ?? engineSnapshot?.activePresetId;
    const preferredPool =
      shellState.filteredCatalog.length > 1
        ? shellState.filteredCatalog
        : shellState.catalog.length > 1
          ? shellState.catalog
          : [];
    const shuffledPool = preferredPool.filter(
      (entry) => entry.id !== activePresetId,
    );
    const fallbackPool =
      shellState.filteredCatalog.length > 0
        ? shellState.filteredCatalog
        : shellState.catalog;
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

  const handleAudioFile = async (file: File) => {
    if (
      !file.type.startsWith('audio/') &&
      !file.name.match(/\.(mp3|wav|flac|ogg|m4a|aac|opus|webm)$/i)
    ) {
      return;
    }
    try {
      setStatusMessage(null);

      fileAudioContextRef.current?.close();
      const audioContext = new AudioContext();
      fileAudioContextRef.current = audioContext;
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      const destination = audioContext.createMediaStreamDestination();
      source.connect(destination);
      source.connect(audioContext.destination);
      source.start(0);

      const { nextRouteState, healMessage } = buildHealedPresetRoute(
        routeState,
        shellState.missingRequestedPreset,
        shellState.featuredPreset,
        'file',
      );

      if (healMessage) {
        setStatusMessage(healMessage);
      }

      commitRoute(nextRouteState);
      await startAudioSource({
        source: 'file',
        stream: destination.stream,
        launchState: nextRouteState,
      });
      setStatusMessage(`Playing: ${file.name}`);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Unable to play audio file.',
      );
    }
  };

  const handlePlayPreset = async (presetId: string) => {
    commitRoute({
      ...routeState,
      panel: null,
      presetId,
    });
  };

  const handleAudioStart = async (
    source: 'demo' | 'microphone' | 'tab' | 'youtube' | 'file',
    deviceId?: string,
  ) => {
    if (audioStartInProgressRef.current) return;
    audioStartInProgressRef.current = true;

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
            return;
          }

          setStatusMessage(
            insecure
              ? 'Microphone needs a secure connection. Open this site over HTTPS and try again.'
              : 'Microphone capture is not available in this browser.',
          );
          return;
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
            return;
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
                  ? 'Microphone is currently in use by another app (e.g. Zoom, Teams).'
                  : error instanceof Error && error.message
                    ? error.message
                    : 'Unable to access microphone.';
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
        return;
      }

      if (source === 'demo') {
        commitRoute(nextRouteState);
        await startAudioSource({ source, launchState: nextRouteState });
        return;
      }

      const { captureDisplayAudioStream } = await import(
        '../ui/audio-advanced-sources.ts'
      );
      const stream = await captureDisplayAudioStream({
        unavailableMessage:
          'Tab and YouTube capture need a desktop browser. Use the microphone instead.',
        missingAudioMessage:
          source === 'youtube'
            ? 'No YouTube audio track was captured. Re-share and enable Share tab audio.'
            : 'No tab audio track was captured. Re-share and enable Share tab audio.',
        // For YouTube the player lives in this tab, so pre-select it. For a
        // plain tab capture the user is reaching for a different tab.
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
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : 'Audio start failed.',
      );
    } finally {
      audioStartInProgressRef.current = false;
    }
  };

  const handleAudioStop = () => {
    commitRoute({ ...routeState, audioSource: null });
    setStatusMessage('Audio stopped.');
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
    const currentUrl = buildCanonicalUrl(
      { ...routeState, agentMode: false },
      window.location,
    );
    const href = currentUrl.toString();

    let shareTitle = 'Stims visualizer';
    let shareText = 'Open this Stims visualizer view.';

    if (selectedPreset) {
      const shareCopy = formatPresetShareCopy({
        id: selectedPreset.id,
        title: selectedPreset.title,
        author: selectedPreset.author,
      });
      shareTitle = shareCopy.title;
      shareText = shareCopy.text;
    }

    const result = await shareOrCopyLink(href, {
      title: shareTitle,
      text: shareText,
    });

    if (result === 'shared') {
      setStatusMessage('Link shared.');
      return;
    }

    if (result === 'copied') {
      setStatusMessage('Link copied.');
      return;
    }

    if (result === 'cancelled') {
      return;
    }

    setStatusMessage(
      `Current link: ${currentUrl.pathname}${currentUrl.search}`,
    );
  };

  useEffect(() => {
    return () => {
      fileAudioContextRef.current?.close();
    };
  }, []);

  return {
    ...shellState,
    handleAudioStart,
    handleAudioStop,
    handleBrowseRecovery,
    handleFeaturedPresetSelection,
    handleImport,
    handlePlayPreset,
    handlePresetSelection,
    handlePreviousPreset,
    handleShowCurrentLink,
    handleAudioFile,
    handleShufflePreset,
    handleVisualSearch,
    updatePanel,
    updateEditorSource: shellState.updateEditorSource,
  };
}
