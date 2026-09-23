/**
 * Preset title card — the playing preset's name, set large on the stage for a
 * moment each time the renderer switches to a new one.
 *
 * The one place the name was ever shown during playback was the dock's title
 * button: 14px text in an auto-hiding pill, so most switches (autoplay, the
 * arrow keys, a MIDI pad) happened with no word about what had just started.
 * VJ software answers that with a title card: big, brief, then gone. This is
 * that card.
 *
 * It keys on `activePresetId` — the preset the engine is actually rendering —
 * not the requested one, so the name lands with the picture instead of seconds
 * before it. It stays out of the way of anything the viewer is doing: it never
 * takes the pointer, is hidden from assistive tech (the dock's title button is
 * the accessible name for the playing preset), is skipped while a panel is
 * open, and is a Settings switch for performers who want a text-free stage.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  getStageOverlayPreference,
  subscribeToStageOverlayPreference,
} from '../core/stage-overlay-preferences.ts';
import { splitPresetDisplay } from '../milkdrop/preset-credit.ts';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

/** How long the card holds before it starts leaving. */
export const TITLE_CARD_HOLD_MS = 2600;
/** Matches the exit transition in app-shell.css. */
const TITLE_CARD_EXIT_MS = 450;

type TitleCard = {
  nonce: number;
  title: string;
  byline: string | null;
};

export function PresetTitleCard() {
  const { ui, engine } = useWorkspace();
  const { engineSnapshot } = useEngineSnapshot();
  const enabled = useSyncExternalStore(
    subscribeToStageOverlayPreference,
    () => getStageOverlayPreference().presetTitleCard,
    () => false,
  );
  const activeId = engineSnapshot?.activePresetId ?? null;
  const panelOpen = ui.routeState.panel !== null;
  const selectedPreset = engine.selectedPreset;

  const [card, setCard] = useState<TitleCard | null>(null);
  const [leaving, setLeaving] = useState(false);
  const previousIdRef = useRef<string | null>(null);
  const nonceRef = useRef(0);

  useEffect(() => {
    const previous = previousIdRef.current;
    previousIdRef.current = activeId;
    if (!activeId || previous === activeId || !enabled || panelOpen) {
      return;
    }
    // The requested preset is set before the engine flips, so by the time
    // activePresetId changes the selection normally names it. If it does not
    // (the selection already moved on), there is no trustworthy title to
    // show, and a wrong name is worse than none.
    if (!selectedPreset || selectedPreset.id !== activeId) {
      return;
    }
    const { title, byline } = splitPresetDisplay(
      selectedPreset.title || selectedPreset.id,
      selectedPreset.author,
    );
    nonceRef.current += 1;
    setLeaving(false);
    setCard({ nonce: nonceRef.current, title, byline });
  }, [activeId, enabled, panelOpen, selectedPreset]);

  // Hold, then leave, then unmount. Keyed on the nonce so a switch arriving
  // mid-card restarts the hold for the new name.
  const nonce = card?.nonce ?? 0;
  useEffect(() => {
    if (nonce === 0) return;
    const leaveTimer = window.setTimeout(
      () => setLeaving(true),
      TITLE_CARD_HOLD_MS,
    );
    const clearTimer = window.setTimeout(
      () => setCard((current) => (current?.nonce === nonce ? null : current)),
      TITLE_CARD_HOLD_MS + TITLE_CARD_EXIT_MS,
    );
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(clearTimer);
    };
  }, [nonce]);

  // Opening a panel or switching the card off dismisses one already showing.
  useEffect(() => {
    if (!enabled || panelOpen) setCard(null);
  }, [enabled, panelOpen]);

  if (!card) return null;

  return (
    <div
      key={card.nonce}
      className="stims-shell__title-card"
      data-leaving={leaving ? 'true' : undefined}
      aria-hidden="true"
    >
      <span className="stims-shell__title-card-title">{card.title}</span>
      {card.byline ? (
        <span className="stims-shell__title-card-byline">{card.byline}</span>
      ) : null}
    </div>
  );
}
