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
import { toggleLivePerformanceMode } from '../core/live-performance-mode.ts';
import { togglePresetLock } from '../core/preset-lock.ts';
import { setCompatibilityMode } from '../core/state/render-preference-store.ts';
import {
  setThemePreference,
  type ThemeChoice,
} from '../core/theme-preferences.ts';
import { DEFAULT_BLEND_DURATION_SECONDS } from '../milkdrop/runtime/first-run-preset.ts';
import type { CommandAction } from './command-palette-registry.ts';
import type { EngineSnapshot } from './engine/engine-snapshot.ts';
import type { EngineContextValue } from './engine-context.tsx';
import { openPerformPicker } from './perform-pins.ts';
import { cyclePresetWaveMode, nudgePresetField } from './preset-nudges.ts';
import {
  endWatchParty,
  nearbyPresetRequest,
  openRecordPanel,
  playNearbyPreset,
  presentToExternalDisplayAction,
  setTransition,
  startAudioSource,
  startOrCopyWatchPartyAction,
  toggleAutoplay,
  toggleCameraAction,
  togglePanel,
} from './workspace-actions.ts';
import type { WorkspaceContextValue } from './workspace-context.tsx';

export type PaletteActionContext = {
  engineRef: { readonly current: EngineContextValue };
  engineBridgeRef: { readonly current: EngineContextValue };
  engineSnapshotRef: { readonly current: EngineSnapshot | null };
  uiRef: { readonly current: WorkspaceContextValue };
  paletteSurface: Parameters<typeof togglePanel>[0];
  handleToggleFullscreen: () => void;
  setShowShortcuts: (show: boolean) => void;
  toggleFavoriteCurrentPreset: () => void;
  // Row labels and the row set depend on these.
  liveMode: boolean;
  isFullscreen: boolean;
  hostingWatchParty: boolean;
  themeChoice: ThemeChoice;
  editorDirty: boolean;
  playbackPaused: boolean;
};

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
  return [
    {
      id: 'open-browse',
      group: 'Presets',
      label: 'Browse presets',
      run: () => togglePanel(paletteSurface, 'browse'),
    },
    {
      id: 'next-preset',
      group: 'Presets',
      label: 'Next preset (random)',
      keywords: ['shuffle', 'surprise'],
      run: () => void engineRef.current.handleShufflePreset(),
    },
    {
      id: 'previous-preset',
      group: 'Presets',
      label: 'Previous preset',
      keywords: ['back'],
      run: () => void engineRef.current.handlePreviousPreset(),
    },
    {
      id: 'save-preset',
      group: 'Presets',
      label: 'Save preset',
      keywords: ['favorite', 'star'],
      run: toggleFavoriteCurrentPreset,
    },
    {
      id: 'find-similar',
      group: 'Presets',
      label: 'Find a preset',
      keywords: ['similar', 'match', 'sound', 'look'],
      run: () => void engineRef.current.handleVisualSearch(),
    },
    {
      // The small step next to next-preset's big one. Shares its body with
      // the dock's Nearby button (workspace-actions.ts) so both mean the
      // same thing.
      id: 'nearby-preset',
      group: 'Presets',
      label: 'Nearby preset (looks like this one)',
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
      label: 'Stay on this preset',
      keywords: ['lock', 'hold', 'stay', 'pin'],
      run: () =>
        uiRef.current.setStatusMessage(
          togglePresetLock()
            ? 'Staying on this preset. Auto-advance is paused.'
            : 'Auto-advance on.',
        ),
    },
    {
      id: 'open-editor',
      group: 'Create',
      label: 'Edit preset code',
      run: () => togglePanel(paletteSurface, 'editor'),
    },
    {
      id: 'open-refine',
      group: 'Create',
      label: 'Refine with AI',
      run: () => togglePanel(paletteSurface, 'refine'),
    },
    {
      id: 'open-generate',
      group: 'Create',
      label: 'Generate with AI',
      keywords: ['synthesize', 'create', 'make'],
      run: () => togglePanel(paletteSurface, 'synthesize'),
    },
    {
      id: 'open-record',
      group: 'Share',
      label: 'Record video',
      keywords: ['capture', 'export'],
      run: () => openRecordPanel(paletteSurface),
    },
    {
      id: 'open-settings',
      group: 'View',
      label: 'Settings',
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
      label: `Theme: ${themeChoice === 'system' ? 'match system' : themeChoice}`,
      keywords: ['dark', 'light', 'appearance', 'contrast'],
      run: () => {
        const order: ThemeChoice[] = ['dark', 'light', 'system'];
        const next = order[(order.indexOf(themeChoice) + 1) % order.length];
        setThemePreference({ theme: next });
        uiRef.current.setStatusMessage(
          `Theme: ${next === 'system' ? 'match system' : next}`,
        );
      },
    },
    {
      // The reason this is worth a palette slot when the other graphics
      // settings are not: it is the one people reach for mid-playback, when
      // a preset is chugging and Settings is three interactions away.
      id: 'use-webgl',
      group: 'View',
      label: 'Switch renderer to WebGL (reloads)',
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
      label: 'Camera as video input',
      keywords: ['webcam', 'video', 'input', 'source'],
      run: () => toggleCameraAction(uiRef.current.setStatusMessage),
    },
    {
      id: 'external-display',
      group: 'Share',
      label: 'Show on second screen or cast',
      keywords: ['projector', 'monitor', 'chromecast', 'present', 'tv'],
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
      label: editorDirty ? 'Share link (carries your edits)' : 'Share link',
      keywords: ['copy', 'url', 'remix', 'draft'],
      run: () => void uiRef.current.handleShowCurrentLink(),
    },
    {
      id: 'watch-party',
      group: 'Share',
      label: hostingWatchParty
        ? 'Copy watch party link'
        : 'Start watch party (copy link)',
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
      label: 'Pin a parameter to the stage',
      keywords: ['perform', 'fader', 'control', 'surface'],
      run: () => openPerformPicker(),
    },
    {
      id: 'queue-add',
      group: 'Queue',
      label: 'Add this preset to the queue',
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
      label: 'Take the cued preset',
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
      label: 'Skip the cued preset',
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
      label: 'Crossfade to the cued preset by hand',
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
        uiRef.current.presetQueue.clear();
        uiRef.current.setStatusMessage('Queue cleared.');
      },
    },
    {
      id: 'toggle-live-performance',
      group: 'Playback',
      label: 'Toggle live performance mode',
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
      id: 'toggle-autoplay',
      group: 'Playback',
      label: 'Toggle autoplay',
      keywords: ['shuffle', 'automatic'],
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
      label: 'Switch between blend and cut',
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
      label: 'Use microphone audio',
      keywords: ['source', 'mic'],
      run: () => startAudioSource(engineRef.current, 'microphone'),
    },
    {
      id: 'audio-tab',
      group: 'Audio',
      label: 'Use tab or system audio',
      keywords: ['source', 'capture', 'spotify', 'system', 'screen'],
      run: () => startAudioSource(engineRef.current, 'tab'),
    },
    ...(liveMode
      ? [
          {
            id: 'toggle-playback',
            group: 'Audio',
            label: playbackPaused ? 'Resume' : 'Pause',
            keywords: ['pause', 'resume', 'play', 'hold', 'freeze'],
            run: () => engineRef.current.handleTogglePlayback(),
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
      label: 'Next waveform',
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
      label: 'Previous waveform',
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
      label: 'Zoom in',
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
      label: 'Zoom out',
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
      label: 'More warp',
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
      label: 'Less warp',
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
      label: 'Bigger waveform',
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
      label: 'Smaller waveform',
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
      label: 'Rotate clockwise',
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
      label: 'Rotate counterclockwise',
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
