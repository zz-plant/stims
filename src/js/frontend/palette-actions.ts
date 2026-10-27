/**
 * The command palette's actions: every verb the palette, the agent API and
 * the keyboard shortcuts bound to a palette id can run.
 *
 * This list was ~580 lines inside the app shell's render function. It is
 * plain data built from a context, so it lives here and can be read (and
 * tested) on its own. Handlers read the engine and route through the refs in
 * the context at run time, so the list only needs rebuilding when a row's
 * label or presence changes — the flags at the bottom of the context.
 */
import { getActiveAccessibilityPreference } from '../core/accessibility-preferences.ts';
import {
  getLivePerformanceMode,
  toggleLivePerformanceMode,
} from '../core/live-performance-mode.ts';
import { isPresetLocked, togglePresetLock } from '../core/preset-lock.ts';
import {
  getExternalDisplayState,
  hasMultipleScreens,
} from '../core/services/external-display-service.ts';
import { getProjectorState } from '../core/services/projector-window-service.ts';
import { isRecordingActive } from '../core/services/recording-state.ts';
import {
  stageUtilityMode,
  toggleBlackout,
} from '../core/services/stage-utilities.ts';
import { setCompatibilityMode } from '../core/state/render-preference-store.ts';
import {
  setThemePreference,
  type ThemeChoice,
} from '../core/theme-preferences.ts';
import { createTwoStepConfirm } from '../core/two-step-confirm.ts';
import {
  isWatchHudActive,
  toggleWatcherHud,
} from '../milkdrop/overlay/watcher-hud.ts';
import { DEFAULT_BLEND_DURATION_SECONDS } from '../milkdrop/runtime/first-run-preset.ts';
import type { CommandAction } from './command-palette-registry.ts';
import type { EngineSnapshot } from './engine/engine-snapshot.ts';
import type { EngineContextValue } from './engine-context.tsx';
import { nextFileTrack, previousFileTrack } from './file-audio.ts';
import { openPerformPicker } from './perform-pins.ts';
import { cyclePresetWaveMode, nudgePresetField } from './preset-nudges.ts';
import { buildPresetSetShareUrl, saveNamedSet } from './preset-sets.ts';
import {
  followMusicTempoAction,
  nudgeTempoAction,
  tapTempoAction,
} from './tempo-actions.ts';
import {
  cameraMenuLabel,
  castMenuLabel,
  endWatchParty,
  isCameraInputOn,
  nearbyPresetRequest,
  openRecordPanel,
  panelToggleLabel,
  playbackToggleLabel,
  playNearbyPreset,
  presentToExternalDisplayAction,
  projectorMenuLabel,
  recordMenuLabel,
  setTransition,
  startAudioSource,
  startOrCopyWatchPartyAction,
  toggleAutoplay,
  toggleCameraAction,
  togglePanel,
  toggleProjectorAction,
  toggleReduceFlashingAction,
} from './workspace-actions.ts';

/**
 * Rows whose effect depends on state (a toggle, a panel that closes when it
 * is already open) read their label through a getter, so the palette shows
 * what the row will do when it renders rather than when the list was last
 * rebuilt. The list rebuilds only on the flags in PaletteActionContext.
 */
const TUNE_SUFFIX = ' (edits this preset)';

import type { WorkspaceContextValue } from './workspace-context.tsx';

export type PaletteActionContext = {
  engineRef: { readonly current: EngineContextValue };
  engineBridgeRef: { readonly current: EngineContextValue };
  engineSnapshotRef: { readonly current: EngineSnapshot | null };
  uiRef: { readonly current: WorkspaceContextValue };
  paletteSurface: Parameters<typeof togglePanel>[0];
  handleToggleFullscreen: () => void;
  setShowShortcuts: (show: boolean) => void;
  setShowManageSets?: (show: boolean) => void;
  toggleFavoriteCurrentPreset: () => void;
  // Row labels and the row set depend on these.
  liveMode: boolean;
  isFullscreen: boolean;
  hostingWatchParty: boolean;
  themeChoice: ThemeChoice;
  editorDirty: boolean;
  playbackPaused: boolean;
};

const THEME_ORDER: ThemeChoice[] = ['dark', 'light', 'system'];

function nextTheme(choice: ThemeChoice): ThemeChoice {
  return THEME_ORDER[(THEME_ORDER.indexOf(choice) + 1) % THEME_ORDER.length];
}

function themeName(choice: ThemeChoice): string {
  return choice === 'system' ? 'match system' : choice;
}

export function buildPaletteActions(
  context: PaletteActionContext,
): CommandAction[] {
  const {
    engineRef,
    engineBridgeRef,
    engineSnapshotRef,
    uiRef,
    paletteSurface,
    handleToggleFullscreen,
    setShowShortcuts,
    toggleFavoriteCurrentPreset,
    liveMode,
    isFullscreen,
    hostingWatchParty,
    themeChoice,
    editorDirty,
    playbackPaused,
  } = context;
  const routePanel = () => uiRef.current.routeState?.panel ?? null;
  const currentPresetSaved = () => {
    const engine = engineBridgeRef.current;
    const id = engine.selectedPreset?.id ?? engine.featuredPreset?.id ?? null;
    return (
      id !== null && engine.favoritePresets.some((preset) => preset.id === id)
    );
  };
  // Clearing the queue has no undo. From a list of commands there is no
  // button to relabel, so the first run arms it and says so; running it
  // again within a few seconds clears.
  const clearQueue = createTwoStepConfirm({
    onConfirm: () => {
      uiRef.current.presetQueue.clear();
      uiRef.current.setStatusMessage('Queue cleared.');
    },
    onChange: ({ armed }) => {
      if (!armed) return;
      const count = uiRef.current.presetQueue.presetIds.length;
      uiRef.current.setStatusMessage(
        `Run “Clear the queue” again to remove all ${count} queued.`,
      );
    },
  });
  return [
    {
      id: 'open-browse',
      group: 'Presets',
      get label() {
        return panelToggleLabel('browse', routePanel() === 'browse');
      },
      run: () => togglePanel(paletteSurface, 'browse'),
    },
    {
      id: 'next-preset',
      group: 'Presets',
      label: 'Play a random preset',
      keywords: ['shuffle', 'surprise', 'next'],
      run: () => void engineRef.current.handleShufflePreset(),
    },
    {
      id: 'previous-preset',
      group: 'Presets',
      label: 'Back to the last preset',
      keywords: ['back', 'previous'],
      run: () => void engineRef.current.handlePreviousPreset(),
    },
    {
      id: 'save-preset',
      group: 'Presets',
      // The row toggles: on a saved preset it removes it from saved.
      get label() {
        return currentPresetSaved() ? 'Remove from saved' : 'Save preset';
      },
      keywords: ['favorite', 'star'],
      run: toggleFavoriteCurrentPreset,
    },
    {
      id: 'find-similar',
      group: 'Presets',
      label: panelToggleLabel('finder', false),
      keywords: ['similar', 'match', 'sound', 'look'],
      run: () => void engineRef.current.handleVisualSearch(),
    },
    {
      // The small step next to next-preset's big one. Shares its body with
      // the dock's Nearby button (workspace-actions.ts) so both mean the
      // same thing.
      id: 'nearby-preset',
      group: 'Presets',
      label: 'Play a similar-looking preset',
      keywords: ['similar', 'like', 'neighbour', 'neighbor'],
      run: () =>
        void playNearbyPreset(
          nearbyPresetRequest({
            stage: uiRef.current.stageRef.current,
            catalog: engineBridgeRef.current.catalog,
            currentPresetId:
              engineBridgeRef.current.selectedPreset?.id ??
              engineBridgeRef.current.featuredPreset?.id ??
              null,
            play: (presetId) =>
              engineBridgeRef.current.handlePresetSelection(presetId),
            announce: uiRef.current.setStatusMessage,
          }),
        ),
    },
    {
      // Pauses auto-advance without touching the autoplay preference, so
      // unlocking returns whatever the visitor had set. The MilkDrop
      // keybinding layer's `L` flips the same store.
      id: 'toggle-preset-lock',
      group: 'Presets',
      get label() {
        return isPresetLocked() ? 'Let autoplay move on' : 'Keep this preset';
      },
      keywords: ['lock', 'hold', 'stay', 'pin', 'autoplay'],
      run: () =>
        uiRef.current.setStatusMessage(
          togglePresetLock()
            ? 'Keeping this preset. Autoplay won’t change it.'
            : 'Autoplay can move on again.',
        ),
    },
    {
      id: 'open-editor',
      group: 'Create',
      get label() {
        return panelToggleLabel('editor', routePanel() === 'editor');
      },
      run: () => togglePanel(paletteSurface, 'editor'),
    },
    {
      // The stage watch HUD (watcher-hud.ts): the variables pinned in the
      // editor's Inspect tab, plotted over the running stage at display rate.
      // Reachable with the editor closed — watching a tweak play out full
      // screen is the point of the overlay.
      id: 'toggle-watcher-hud',
      group: 'Create',
      get label() {
        return isWatchHudActive()
          ? 'Hide variable graphs on the stage'
          : 'Graph the variables pinned in Inspect, over the stage';
      },
      keywords: ['watch', 'graph', 'plot', 'inspect', 'pin', 'hud', 'stage'],
      run: () => {
        const on = toggleWatcherHud(uiRef.current.stageRef?.current ?? null);
        uiRef.current.setStatusMessage(
          on
            ? 'Variable watch HUD on — it plots the variables you pin in Inspect.'
            : uiRef.current.stageRef?.current
              ? 'Variable watch HUD off.'
              : 'The stage is not running yet.',
        );
      },
    },
    {
      id: 'open-refine',
      group: 'Create',
      get label() {
        return panelToggleLabel('refine', routePanel() === 'refine');
      },
      run: () => togglePanel(paletteSurface, 'refine'),
    },
    {
      id: 'open-generate',
      group: 'Create',
      get label() {
        return panelToggleLabel('synthesize', routePanel() === 'synthesize');
      },
      keywords: ['synthesize', 'create', 'make'],
      run: () => togglePanel(paletteSurface, 'synthesize'),
    },
    {
      id: 'open-record',
      group: 'Share',
      // Opens the form, starts recording with the remembered format, or
      // closes the panel and saves the take: the label says which.
      get label() {
        return recordMenuLabel({
          panelOpen: routePanel() === 'capture',
          recording: isRecordingActive(),
        });
      },
      keywords: ['capture', 'export'],
      run: () => openRecordPanel(paletteSurface),
    },
    {
      id: 'open-settings',
      group: 'View',
      get label() {
        return panelToggleLabel('settings', routePanel() === 'settings');
      },
      run: () => togglePanel(paletteSurface, 'settings'),
    },
    {
      id: 'open-shortcuts',
      group: 'View',
      label: 'Shortcuts and gestures',
      keywords: ['help', 'keys', 'bindings', 'gestures', 'swipe', 'touch'],
      run: () => setShowShortcuts(true),
    },
    {
      // Cycles rather than offering three entries: the palette is a list you
      // scan, and three near-identical theme rows cost more attention than
      // the one extra press cycling costs.
      id: 'cycle-theme',
      group: 'View',
      // Names the theme it switches to; "Theme: dark" read as the current
      // value and then changed it.
      label: `Switch theme to ${themeName(nextTheme(themeChoice))} (now ${themeName(themeChoice)})`,
      keywords: ['dark', 'light', 'appearance', 'contrast', 'theme'],
      run: () => {
        const next = nextTheme(themeChoice);
        setThemePreference({ theme: next });
        uiRef.current.setStatusMessage(`Theme: ${themeName(next)}`);
      },
    },
    {
      // The reason this is worth a palette slot when the other graphics
      // settings are not: it is the one people reach for mid-playback, when
      // a preset is chugging and Settings is three interactions away.
      id: 'use-webgl',
      group: 'View',
      label: 'Switch renderer to WebGL (reloads the page and stops the sound)',
      keywords: ['backend', 'webgpu', 'compatibility', 'slow', 'performance'],
      run: () => {
        setCompatibilityMode(true);
        // The choice only takes effect on the next load, and the person
        // reached for this because the current one is chugging — do the
        // reload here instead of naming it in a toast. A dirty editor
        // still gets the beforeunload prompt below.
        window.location.reload();
      },
    },
    {
      id: 'toggle-fullscreen',
      group: 'View',
      label: isFullscreen ? 'Exit full screen' : 'Full screen',
      run: handleToggleFullscreen,
    },
    {
      id: 'toggle-camera',
      group: 'View',
      get label() {
        return cameraMenuLabel(isCameraInputOn());
      },
      keywords: ['webcam', 'video', 'input', 'source'],
      run: () => toggleCameraAction(uiRef.current.setStatusMessage),
    },
    {
      id: 'toggle-projector',
      group: 'Share',
      get label() {
        return projectorMenuLabel(
          getProjectorState().open,
          hasMultipleScreens(),
        );
      },
      keywords: [
        'projector',
        'monitor',
        'second screen',
        'display',
        'output',
        'mirror',
      ],
      run: () =>
        toggleProjectorAction({
          stage: () => uiRef.current.stageRef.current,
          announce: uiRef.current.setStatusMessage,
        }),
    },
    {
      id: 'external-display',
      group: 'Share',
      get label() {
        return castMenuLabel(getExternalDisplayState().mode !== null);
      },
      keywords: ['chromecast', 'present', 'tv', 'cast', 'watch party'],
      run: () => presentToExternalDisplayAction(uiRef.current.setStatusMessage),
    },
    {
      id: 'share-link',
      group: 'Share',
      // The link has carried a `#code=` hash of the live draft since remix
      // links shipped — `buildCanonicalUrl` rewrites path and query and
      // leaves the hash alone — but the row said only "Share link", so the
      // one property that makes it interesting was invisible. Naming it
      // costs a word and is the difference between a URL and a way to send
      // someone the preset you are in the middle of writing.
      // A preset of your own travels as code in the link even unedited,
      // because nobody else has it; say so as for an edit.
      get label() {
        if (editorDirty) return 'Share link (carries your edits)';
        const entry =
          engineBridgeRef.current.selectedPreset ??
          engineBridgeRef.current.featuredPreset;
        return entry && !entry.bundledFile
          ? 'Share link (carries this preset’s code)'
          : 'Share link';
      },
      keywords: ['copy', 'url', 'remix', 'draft'],
      run: () => void uiRef.current.handleShowCurrentLink(),
    },
    {
      id: 'watch-party',
      group: 'Share',
      label: hostingWatchParty
        ? 'Copy watch party link'
        : 'Start watch party (copies link)',
      keywords: ['sync', 'room', 'host', 'together'],
      run: () => startOrCopyWatchPartyAction(uiRef.current.setStatusMessage),
    },
    ...(hostingWatchParty
      ? [
          {
            id: 'end-watch-party',
            group: 'Share',
            label: 'End watch party',
            keywords: ['sync', 'room', 'leave', 'stop'],
            run: () => endWatchParty(uiRef.current.setStatusMessage),
          } satisfies CommandAction,
        ]
      : []),
    {
      id: 'perform-pin',
      group: 'Perform',
      label: 'Add a live slider to the stage',
      keywords: ['perform', 'fader', 'control', 'surface'],
      run: () => openPerformPicker(),
    },
    {
      // A tap is timed, so it has to come from a key or a pad; the palette
      // row is how automation and the shortcut layer reach it.
      id: 'tap-tempo',
      group: 'Perform',
      label: 'Tap tempo (tap on the downbeat)',
      keywords: ['bpm', 'beat', 'sync', 'downbeat'],
      run: () => void tapTempoAction(uiRef.current.setStatusMessage),
    },
    {
      id: 'tempo-follow-music',
      group: 'Perform',
      label: 'Tempo follows the music (clear tapped tempo)',
      keywords: ['bpm', 'tap', 'reset', 'clear', 'auto'],
      run: () => followMusicTempoAction(uiRef.current.setStatusMessage),
    },
    {
      id: 'tempo-nudge-earlier',
      group: 'Perform',
      label: 'Shift the beat timing earlier',
      keywords: ['bpm', 'phase', 'tap', 'sync'],
      run: () => nudgeTempoAction(-1, uiRef.current.setStatusMessage),
    },
    {
      id: 'tempo-nudge-later',
      group: 'Perform',
      label: 'Shift the beat timing later',
      keywords: ['bpm', 'phase', 'tap', 'sync'],
      run: () => nudgeTempoAction(1, uiRef.current.setStatusMessage),
    },
    // The D key's blackout, as a row: it was the one live cut with no
    // command, so a MIDI pad (which runs palette ids) could not reach it.
    ...(liveMode
      ? [
          {
            id: 'toggle-blackout',
            group: 'Perform',
            get label() {
              return stageUtilityMode() === 'blackout'
                ? 'End the blackout'
                : 'Black out the picture';
            },
            keywords: ['blackout', 'dark', 'cut', 'break', 'vj'],
            run: () => toggleBlackout(),
          } satisfies CommandAction,
        ]
      : []),
    {
      id: 'queue-add',
      group: 'Queue',
      label: 'Queue this preset to play next',
      keywords: ['cue', 'crate', 'next', 'setlist'],
      run: () => {
        const presetId = engineSnapshotRef.current?.activePresetId ?? null;
        if (!presetId) {
          uiRef.current.setStatusMessage('No preset to queue yet.');
          return;
        }
        uiRef.current.presetQueue.add(presetId);
        uiRef.current.setStatusMessage('Queued. It shows in the cue monitor.');
      },
    },
    {
      id: 'queue-take',
      group: 'Queue',
      label: 'Play the next queued preset now',
      keywords: ['cue', 'next', 'play'],
      run: () => {
        const presetId = uiRef.current.presetQueue.popNext();
        if (!presetId) {
          uiRef.current.setStatusMessage('Nothing is cued.');
          return;
        }
        if (presetId === engineSnapshotRef.current?.activePresetId) {
          uiRef.current.setStatusMessage(
            'That preset is already on the stage.',
          );
          return;
        }
        uiRef.current.setRouteState((current) => ({ ...current, presetId }));
      },
    },
    {
      id: 'queue-skip',
      group: 'Queue',
      label: 'Remove the next preset from the queue',
      keywords: ['cue', 'drop', 'pass'],
      run: () => {
        const next = uiRef.current.presetQueue.presetIds[0];
        if (!next) {
          uiRef.current.setStatusMessage('Nothing is cued.');
          return;
        }
        uiRef.current.presetQueue.remove(next);
      },
    },
    {
      id: 'queue-fade',
      group: 'Queue',
      label: 'Play the next queued preset with a crossfade slider',
      keywords: ['cue', 'fader', 'blend', 'mix'],
      run: () => {
        const next = uiRef.current.presetQueue.presetIds[0];
        if (!next) {
          uiRef.current.setStatusMessage('Nothing is cued.');
          return;
        }
        if (next === engineSnapshotRef.current?.activePresetId) {
          uiRef.current.setStatusMessage(
            'That preset is already on the stage.',
          );
          return;
        }
        uiRef.current.presetQueue.remove(next);
        engineBridgeRef.current.startManualCrossfade();
        uiRef.current.setRouteState((current) => ({
          ...current,
          presetId: next,
        }));
      },
    },
    {
      id: 'queue-clear',
      group: 'Queue',
      label: 'Clear the queue',
      keywords: ['cue', 'crate', 'empty'],
      run: () => {
        if (uiRef.current.presetQueue.presetIds.length === 0) {
          uiRef.current.setStatusMessage('The queue is already empty.');
          return;
        }
        clearQueue.press();
      },
    },
    {
      id: 'queue-save-set',
      group: 'Queue',
      label: 'Save the queue as a named set…',
      keywords: ['set', 'playlist', 'crate', 'save'],
      run: () => {
        const queueIds = uiRef.current.presetQueue.presetIds;
        if (queueIds.length === 0) {
          uiRef.current.setStatusMessage('Queue is empty. Add presets first.');
          return;
        }
        if (context.setShowManageSets) {
          context.setShowManageSets(true);
        } else {
          saveNamedSet(`Set (${queueIds.length} presets)`, queueIds);
          uiRef.current.setStatusMessage(
            `Saved queue as named set (${queueIds.length} presets).`,
          );
        }
      },
    },
    {
      id: 'queue-share-set',
      group: 'Queue',
      label: 'Copy a link to the queue',
      keywords: ['share', 'link', 'set', 'url'],
      run: () => {
        const queueIds = uiRef.current.presetQueue.presetIds;
        if (queueIds.length === 0) {
          uiRef.current.setStatusMessage('Queue is empty. Add presets first.');
          return;
        }
        const url = buildPresetSetShareUrl(
          window.location.href,
          `Set (${queueIds.length} presets)`,
          queueIds,
        );
        void navigator.clipboard.writeText(url).then(
          () =>
            uiRef.current.setStatusMessage(
              'Share link for queue copied to clipboard!',
            ),
          () => uiRef.current.setStatusMessage('Could not copy link.'),
        );
      },
    },
    {
      id: 'queue-manage-sets',
      group: 'Queue',
      label: 'Manage saved preset sets',
      keywords: ['set', 'playlist', 'crate', 'load', 'manage'],
      run: () => {
        if (context.setShowManageSets) {
          context.setShowManageSets(true);
        }
      },
    },
    {
      id: 'toggle-live-performance',
      group: 'Playback',
      get label() {
        return getLivePerformanceMode()
          ? 'Turn off live performance mode'
          : 'Turn on live performance mode';
      },
      keywords: ['vj', 'show', 'projector', 'gig', 'stage', 'perform'],
      run: () => {
        const live = toggleLivePerformanceMode();
        uiRef.current.setStatusMessage(
          live
            ? 'Live performance mode on — quality held steady, no battery frame cap, and drawing continues in an unfocused window.'
            : 'Live performance mode off — quality adapts again and background tabs pause.',
        );
      },
    },
    {
      id: 'auto-switch-scene',
      group: 'Playback',
      label: 'Pick the next scene with AI (Clef Omni)',
      keywords: ['vj', 'scene', 'switch', 'clef', 'omni', 'transition'],
      // Scenes are saved only through the live-coding console API
      // (__stims_live.saveScene), so for everyone else this row could only
      // ever answer "save at least two scenes".
      isAvailable: () => (window.__stims_live?.listScenes().length ?? 0) >= 2,
      run: () => {
        const live = window.__stims_live;
        if (!live) {
          uiRef.current.setStatusMessage(
            'Live performance runtime is not active.',
          );
          return;
        }
        void live
          .autoSwitchScene()
          .then((outcome) => {
            if (outcome.applied && outcome.chosenScene) {
              uiRef.current.setStatusMessage(
                `Switched to scene: ${outcome.chosenScene} (Clef Omni)`,
              );
            } else if (outcome.reason) {
              uiRef.current.setStatusMessage(outcome.reason);
            }
          })
          .catch((err) => {
            uiRef.current.setStatusMessage(
              `Scene switch failed: ${err instanceof Error ? err.message : 'try again later'}`,
            );
          });
      },
    },
    {
      // Also in the dock menu: the one safety setting that should be a tap
      // from the stage, not four tabs into Settings.
      id: 'toggle-reduce-flashing',
      group: 'View',
      get label() {
        return getActiveAccessibilityPreference().reduceFlashing
          ? 'Turn off Reduce flashing'
          : 'Turn on Reduce flashing';
      },
      keywords: ['flash', 'strobe', 'seizure', 'photosensitive', 'safety'],
      run: () => toggleReduceFlashingAction(uiRef.current.setStatusMessage),
    },
    {
      id: 'toggle-autoplay',
      group: 'Playback',
      get label() {
        return engineSnapshotRef.current?.autoplay
          ? 'Turn off autoplay'
          : 'Turn on autoplay';
      },
      keywords: ['shuffle', 'automatic', 'autoplay'],
      run: () =>
        toggleAutoplay(
          engineRef.current,
          uiRef.current.setStatusMessage,
          engineSnapshotRef.current?.autoplay ?? false,
        ),
    },
    {
      // The runtime's old H key. Blend keeps whatever duration is set;
      // this only flips which of the two the next switch uses.
      id: 'toggle-transition-mode',
      group: 'Playback',
      get label() {
        return (engineSnapshotRef.current?.transitionMode ?? 'blend') ===
          'blend'
          ? 'Switch transitions to instant cut'
          : 'Switch transitions to blend';
      },
      keywords: ['transition', 'blend', 'cut', 'mode'],
      run: () => {
        const next =
          (engineSnapshotRef.current?.transitionMode ?? 'blend') === 'blend'
            ? 'cut'
            : 'blend';
        setTransition(
          engineRef.current,
          uiRef.current.setStatusMessage,
          next,
          engineSnapshotRef.current?.blendDuration ??
            DEFAULT_BLEND_DURATION_SECONDS,
        );
      },
    },
    {
      id: 'transition-cut',
      group: 'Playback',
      label: 'Transition: instant cut',
      run: () =>
        setTransition(
          engineRef.current,
          uiRef.current.setStatusMessage,
          'cut',
          0,
        ),
    },
    {
      id: 'transition-1s',
      group: 'Playback',
      label: 'Transition: 1s blend',
      run: () =>
        setTransition(
          engineRef.current,
          uiRef.current.setStatusMessage,
          'blend',
          1,
        ),
    },
    {
      // The product default (DEFAULT_BLEND_DURATION_SECONDS); the dock
      // ladder carries the same four ids.
      id: 'transition-2.5s',
      group: 'Playback',
      label: 'Transition: 2.5s blend',
      run: () =>
        setTransition(
          engineRef.current,
          uiRef.current.setStatusMessage,
          'blend',
          DEFAULT_BLEND_DURATION_SECONDS,
        ),
    },
    {
      id: 'transition-5s',
      group: 'Playback',
      label: 'Transition: 5s blend',
      run: () =>
        setTransition(
          engineRef.current,
          uiRef.current.setStatusMessage,
          'blend',
          5,
        ),
    },
    {
      id: 'audio-demo',
      group: 'Audio',
      label: 'Play demo audio',
      keywords: ['source', 'sample'],
      run: () => startAudioSource(engineRef.current, 'demo'),
    },
    {
      id: 'audio-microphone',
      group: 'Audio',
      label: 'Use microphone audio (asks for microphone access)',
      keywords: ['source', 'mic'],
      run: () => startAudioSource(engineRef.current, 'microphone'),
    },
    {
      id: 'audio-tab',
      group: 'Audio',
      label: 'Use tab or system audio (asks what to share)',
      keywords: ['source', 'capture', 'spotify', 'system', 'screen'],
      run: () => startAudioSource(engineRef.current, 'tab'),
    },
    ...(liveMode
      ? [
          {
            id: 'toggle-playback',
            group: 'Audio',
            get label() {
              return playbackToggleLabel(
                engineSnapshotRef.current?.audioSource ?? null,
                playbackPaused,
              );
            },
            keywords: ['pause', 'resume', 'play', 'hold', 'freeze'],
            run: () => engineRef.current.handleTogglePlayback(),
          } satisfies CommandAction,
          {
            id: 'next-audio-track',
            group: 'Audio',
            label: 'Next audio track',
            keywords: ['next', 'song', 'track', 'playlist', 'skip'],
            run: () => {
              void nextFileTrack();
            },
          } satisfies CommandAction,
          {
            id: 'prev-audio-track',
            group: 'Audio',
            label: 'Previous audio track',
            keywords: ['prev', 'previous', 'song', 'track', 'playlist', 'back'],
            run: () => {
              void previousFileTrack();
            },
          } satisfies CommandAction,
          {
            id: 'stop-audio',
            group: 'Audio',
            // Named for what it does: the engine unmounts and the start
            // page comes back. "Stop audio" alone read as mute.
            label: 'Stop audio and go back to start',
            keywords: ['quit', 'exit', 'leave', 'home'],
            run: () => engineRef.current.handleAudioStop(),
          } satisfies CommandAction,
        ]
      : []),
    // Tuning the playing preset. Bound to the runtime's old nudge letters
    // (shortcut-registry.ts); each step edits the preset's source the way
    // an editor drag does and reports the value it landed on.
    {
      id: 'wave-mode-next',
      group: 'Tune',
      label: `Next waveform${TUNE_SUFFIX}`,
      keywords: ['wave', 'mode', 'shape'],
      run: () =>
        void cyclePresetWaveMode(
          engineBridgeRef.current,
          1,
          uiRef.current.setStatusMessage,
        ),
    },
    {
      id: 'wave-mode-previous',
      group: 'Tune',
      label: `Previous waveform${TUNE_SUFFIX}`,
      keywords: ['wave', 'mode', 'shape'],
      run: () =>
        void cyclePresetWaveMode(
          engineBridgeRef.current,
          -1,
          uiRef.current.setStatusMessage,
        ),
    },
    {
      id: 'nudge-zoom-in',
      group: 'Tune',
      label: `Zoom in${TUNE_SUFFIX}`,
      keywords: ['nudge', 'adjust', 'zoom'],
      run: () =>
        void nudgePresetField(
          engineBridgeRef.current,
          'zoom',
          1,
          uiRef.current.setStatusMessage,
        ),
    },
    {
      id: 'nudge-zoom-out',
      group: 'Tune',
      label: `Zoom out${TUNE_SUFFIX}`,
      keywords: ['nudge', 'adjust', 'zoom'],
      run: () =>
        void nudgePresetField(
          engineBridgeRef.current,
          'zoom',
          -1,
          uiRef.current.setStatusMessage,
        ),
    },
    {
      id: 'nudge-warp-up',
      group: 'Tune',
      label: `More warp${TUNE_SUFFIX}`,
      keywords: ['nudge', 'adjust', 'warp'],
      run: () =>
        void nudgePresetField(
          engineBridgeRef.current,
          'warp',
          1,
          uiRef.current.setStatusMessage,
        ),
    },
    {
      id: 'nudge-warp-down',
      group: 'Tune',
      label: `Less warp${TUNE_SUFFIX}`,
      keywords: ['nudge', 'adjust', 'warp'],
      run: () =>
        void nudgePresetField(
          engineBridgeRef.current,
          'warp',
          -1,
          uiRef.current.setStatusMessage,
        ),
    },
    {
      id: 'nudge-wave-scale-up',
      group: 'Tune',
      label: `Bigger waveform${TUNE_SUFFIX}`,
      keywords: ['nudge', 'adjust', 'waveScale'],
      run: () =>
        void nudgePresetField(
          engineBridgeRef.current,
          'waveScale',
          1,
          uiRef.current.setStatusMessage,
        ),
    },
    {
      id: 'nudge-wave-scale-down',
      group: 'Tune',
      label: `Smaller waveform${TUNE_SUFFIX}`,
      keywords: ['nudge', 'adjust', 'waveScale'],
      run: () =>
        void nudgePresetField(
          engineBridgeRef.current,
          'waveScale',
          -1,
          uiRef.current.setStatusMessage,
        ),
    },
    {
      id: 'nudge-rotate-right',
      group: 'Tune',
      label: `Rotate clockwise${TUNE_SUFFIX}`,
      keywords: ['nudge', 'adjust', 'rotation'],
      run: () =>
        void nudgePresetField(
          engineBridgeRef.current,
          'rotation',
          1,
          uiRef.current.setStatusMessage,
        ),
    },
    {
      id: 'nudge-rotate-left',
      group: 'Tune',
      label: `Rotate counterclockwise${TUNE_SUFFIX}`,
      keywords: ['nudge', 'adjust', 'rotation'],
      run: () =>
        void nudgePresetField(
          engineBridgeRef.current,
          'rotation',
          -1,
          uiRef.current.setStatusMessage,
        ),
    },
  ];
}
