import { useEffect, useRef } from 'react';
import { escapeIsClaimed } from '../../core/modal-utils.ts';
import { noteActionUse } from '../../core/services/action-telemetry.ts';
import {
  handleBlackoutKeyDown,
  handleBlackoutKeyUp,
  handleFlashKeyDown,
  handleFlashKeyUp,
  releaseStageUtilities,
} from '../../core/services/stage-utilities.ts';
import {
  NO_RESERVED_KEYS,
  setReservedShellKeys,
} from '../../core/unified-input.ts';
import type { PanelState } from '../contracts';
import { getQuickSelectEntries } from '../quick-select.ts';
import {
  eventMatchesShortcut,
  getShortcutKeys,
  parseShortcut,
  readShortcutOverrides,
  SHORTCUT_REGISTRY,
  type ShortcutOverrides,
  shortcutHintFor,
} from '../shortcut-registry.ts';

/**
 * Notes a keydown this hook acted on, under the palette id of the binding it
 * matched where there is one, so a key and a palette row for the same action
 * read as one action from two surfaces.
 */
function noteShortcutUse(event: KeyboardEvent, overrides: ShortcutOverrides) {
  const entry = SHORTCUT_REGISTRY.find((definition) =>
    eventMatchesShortcut(event, definition.id, overrides),
  );
  if (entry) {
    noteActionUse(entry.paletteActionId ?? entry.id, 'key');
  } else if (/^[1-9]$/.test(event.key)) {
    noteActionUse('quick-select', 'key');
  }
}

export function useKeyboardShortcuts({
  liveMode,
  engineReady,
  panel,
  updatePanel,
  handlePresetSelection,
  handleShufflePreset,
  handlePreviousPreset,
  handleTogglePlayback,
  handleVisualSearch,
  handleToggleFullscreen,
  toggleFavoritePreset,
  setStatusMessage,
  setShowShortcuts,
  runPaletteAction,
}: {
  liveMode: boolean;
  engineReady: boolean;
  panel: string | null;
  updatePanel: (panel: PanelState) => void;
  handlePresetSelection: (presetId: string) => void;
  handleShufflePreset: () => void;
  handlePreviousPreset: () => void;
  /** Space while live: hold or release the stage without ending the session. */
  handleTogglePlayback: () => void;
  handleVisualSearch: () => Promise<void>;
  handleToggleFullscreen: () => void;
  toggleFavoritePreset?: () => void;
  setStatusMessage?: (message: string | null) => void;
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>;
  /** Runs a command-palette action by id — see ShortcutDefinition.paletteActionId. */
  runPaletteAction?: (actionId: string) => void;
}) {
  const updatePanelRef = useRef(updatePanel);
  updatePanelRef.current = updatePanel;
  const handlePresetSelectionRef = useRef(handlePresetSelection);
  handlePresetSelectionRef.current = handlePresetSelection;
  const handleShufflePresetRef = useRef(handleShufflePreset);
  handleShufflePresetRef.current = handleShufflePreset;
  const handlePreviousPresetRef = useRef(handlePreviousPreset);
  handlePreviousPresetRef.current = handlePreviousPreset;
  const handleTogglePlaybackRef = useRef(handleTogglePlayback);
  handleTogglePlaybackRef.current = handleTogglePlayback;
  const handleToggleFullscreenRef = useRef(handleToggleFullscreen);
  handleToggleFullscreenRef.current = handleToggleFullscreen;
  const handleVisualSearchRef = useRef(handleVisualSearch);
  handleVisualSearchRef.current = handleVisualSearch;
  const toggleFavoritePresetRef = useRef(toggleFavoritePreset);
  toggleFavoritePresetRef.current = toggleFavoritePreset;
  const setStatusMessageRef = useRef(setStatusMessage);
  setStatusMessageRef.current = setStatusMessage;
  const runPaletteActionRef = useRef(runPaletteAction);
  runPaletteActionRef.current = runPaletteAction;

  // Tell the focused-canvas input surface which keys belong to the shell, so
  // it stops swallowing them. Resolved on each lookup rather than captured, so
  // a rebind in the shortcuts dialog takes effect without a reload.
  useEffect(() => {
    setReservedShellKeys(() => {
      const overrides = readShortcutOverrides();
      const reserved = new Set<string>();
      for (const entry of SHORTCUT_REGISTRY) {
        for (const spec of getShortcutKeys(entry.id, overrides)) {
          const parsed = parseShortcut(spec);
          // Chords carrying Cmd/Ctrl/Alt never collide with the canvas's bare
          // keys, so leave those with the canvas.
          if (parsed.mod || parsed.alt || !parsed.key) continue;
          reserved.add(parsed.key === 'space' ? ' ' : parsed.key);
        }
      }
      return reserved;
    });
    return () => setReservedShellKeys(() => NO_RESERVED_KEYS);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // A widget that already handled this key (the editor seam's arrow
      // resize, the warp gizmo's nudge) prevents default; firing the global
      // preset shortcuts on top of it double-acts the keystroke.
      if (event.defaultPrevented) return;
      // An open overlay owns Escape. This listener is attached when the shell
      // mounts, before any overlay exists, so it runs first; without this a
      // rebound Escape would run its action and dismiss the overlay at once.
      if (event.key === 'Escape' && escapeIsClaimed()) return;
      const shortcutOverrides = readShortcutOverrides();
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        // A focused <select> has its own arrow-key (change value) and
        // letter-key (typeahead-jump to an option) behavior. Without this,
        // e.g. typing "b" to jump to an author starting with B also toggles
        // the browse panel (its shortcut is "B"), and every other
        // single-letter/arrow shortcut collides the same way.
        event.target instanceof HTMLSelectElement ||
        (event.target instanceof HTMLElement &&
          event.target.isContentEditable) ||
        (event.target instanceof HTMLElement &&
          event.target.closest('.cm-editor'))
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (eventMatchesShortcut(event, 'audio', shortcutOverrides)) {
        event.preventDefault();
        if (liveMode) {
          handleTogglePlaybackRef.current();
        } else if (engineReady) {
          updatePanelRef.current('settings');
        }
      } else if (eventMatchesShortcut(event, 'fullscreen', shortcutOverrides)) {
        event.preventDefault();
        handleToggleFullscreenRef.current();
      } else if (eventMatchesShortcut(event, 'browse', shortcutOverrides)) {
        event.preventDefault();
        updatePanelRef.current(panel === 'browse' ? null : 'browse');
      } else if (eventMatchesShortcut(event, 'settings', shortcutOverrides)) {
        event.preventDefault();
        updatePanelRef.current(panel === 'settings' ? null : 'settings');
      } else if (eventMatchesShortcut(event, 'editor', shortcutOverrides)) {
        event.preventDefault();
        updatePanelRef.current(panel === 'editor' ? null : 'editor');
      } else if (eventMatchesShortcut(event, 'refine', shortcutOverrides)) {
        event.preventDefault();
        updatePanelRef.current(panel === 'refine' ? null : 'refine');
      } else if (
        eventMatchesShortcut(event, 'visualsearch', shortcutOverrides)
      ) {
        event.preventDefault();
        void handleVisualSearchRef.current();
      } else if (
        eventMatchesShortcut(event, 'shuffle', shortcutOverrides) &&
        liveMode
      ) {
        event.preventDefault();
        void handleShufflePresetRef.current();
      } else if (
        eventMatchesShortcut(event, 'previous', shortcutOverrides) &&
        liveMode
      ) {
        // goBackPreset() calls the engine session directly (unlike preset
        // selection, which routes through routeState and the load effect's
        // own rejection handling) — it throws if the engine isn't mounted
        // yet, so this must stay gated on liveMode the same way quick-select
        // below is, or a press before playback starts becomes an unhandled
        // promise rejection.
        event.preventDefault();
        void handlePreviousPresetRef.current();
      } else if (eventMatchesShortcut(event, 'favorite', shortcutOverrides)) {
        event.preventDefault();
        toggleFavoritePresetRef.current?.();
      } else if (
        eventMatchesShortcut(event, 'blackout', shortcutOverrides) &&
        liveMode
      ) {
        // Live stage utilities (docs/ROADMAP.md): presentation-only cuts.
        // Keyup and window blur are handled in the effect below, so the
        // hold ends even if focus moved on.
        event.preventDefault();
        handleBlackoutKeyDown(event.repeat);
      } else if (
        eventMatchesShortcut(event, 'flash', shortcutOverrides) &&
        liveMode
      ) {
        event.preventDefault();
        handleFlashKeyDown(event.repeat);
      } else if (
        /^[1-9]$/.test(key) &&
        liveMode &&
        // Quick-select is matched as a raw digit rather than through the
        // registry, so it needs its own modifier guard: without this, Cmd+1
        // jumps to a preset *and* preventDefault()s the browser's own
        // switch-to-tab-1.
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault();
        const index = Number.parseInt(key, 10) - 1;
        // The list Browse is showing, in the order it shows it — the cards
        // wear these digits. Empty while Browse is closed.
        const numbered = getQuickSelectEntries();
        const presetId = numbered[index];
        if (presetId) {
          handlePresetSelectionRef.current(presetId);
        } else {
          // Silent no-op otherwise reads as a dead keyboard, not "there's no
          // 7th preset right now" — the two are indistinguishable without this.
          const browseKey = shortcutHintFor('open-browse');
          setStatusMessageRef.current?.(
            numbered.length === 0
              ? `Open Browse${browseKey ? ` (${browseKey})` : ''} to pick presets by number.`
              : `No preset ${key} — only ${numbered.length} in view.`,
          );
        }
      } else if (eventMatchesShortcut(event, 'help', shortcutOverrides)) {
        event.preventDefault();
        setShowShortcuts((s) => !s);
      } else {
        // Bindings that just run an existing palette action carry no bespoke
        // handler — see ShortcutDefinition.paletteActionId.
        for (const entry of SHORTCUT_REGISTRY) {
          if (!entry.dispatchViaPalette || !entry.paletteActionId) continue;
          if (!eventMatchesShortcut(event, entry.id, shortcutOverrides)) {
            continue;
          }
          event.preventDefault();
          runPaletteActionRef.current?.(entry.paletteActionId);
          break;
        }
      }
      if (event.defaultPrevented) noteShortcutUse(event, shortcutOverrides);
    };

    document.addEventListener(
      'keydown',
      handleKeyDown as unknown as EventListener,
    );

    return () => {
      document.removeEventListener(
        'keydown',
        handleKeyDown as unknown as EventListener,
      );
    };
  }, [liveMode, engineReady, panel, setShowShortcuts]);

  useEffect(() => {
    // The utilities are holds, so they need the other half of the key pair.
    // The release is matched without the typing-target guard the keydown
    // path applies: focus often moves while a key is held (a click into an
    // input mid-hold), and a swallowed keyup would leave the stage dark
    // until the next press. The service ignores releases for utilities
    // that are not engaged.
    const handleKeyUp = (event: KeyboardEvent) => {
      const shortcutOverrides = readShortcutOverrides();
      if (eventMatchesShortcut(event, 'blackout', shortcutOverrides)) {
        handleBlackoutKeyUp();
      } else if (eventMatchesShortcut(event, 'flash', shortcutOverrides)) {
        handleFlashKeyUp();
      }
    };
    // A held key whose keyup never arrives — a focus change to another
    // window, a lost tab — would otherwise hold the stage black or white
    // forever. Treat leaving the window as letting go of every key.
    const handleWindowBlur = () => releaseStageUtilities();

    document.addEventListener('keyup', handleKeyUp as unknown as EventListener);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      document.removeEventListener(
        'keyup',
        handleKeyUp as unknown as EventListener,
      );
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, []);
}
