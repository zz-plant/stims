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
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  getStageOverlayPreference,
  subscribeToStageOverlayPreference,
} from '../core/stage-overlay-preferences.ts';
import { splitPresetDisplay } from '../milkdrop/preset-credit.ts';
import { useEngineSnapshot, useWorkspace } from './workspace-context.tsx';

/** How long the card holds before it starts leaving. */
export const TITLE_CARD_HOLD_MS = 2600;
/** Matches the exit transition in app-shell.css. */
export const TITLE_CARD_EXIT_MS = 450;

/** Archivo's narrowest width, and the widest the card will open a short name
 * to: past ~112% a short title stops reading as a name and starts reading as
 * a logo. */
export const TITLE_STRETCH_MIN = 62;
export const TITLE_STRETCH_MAX = 112;
/** A name too long for one line even fully condensed wraps to two lines at
 * this width instead of being crushed further. */
export const TITLE_STRETCH_WRAPPED = 78;

export type TitleFit = { stretch: number; wrap: boolean };

/**
 * The width-axis value (percent) that sets a preset name on one line of
 * `available` pixels. Preset names run from one word to a full sentence, so a
 * fixed width either wastes the line on short names or wraps long ones into a
 * ragged paragraph; the width axis absorbs the difference instead.
 *
 * `measureAt(stretch)` returns the name's one-line width at that stretch.
 * Width is close to linear in the axis but not exactly, so the first guess is
 * corrected once against a real measurement.
 */
export function fitTitleStretch(
  measureAt: (stretch: number) => number,
  available: number,
): TitleFit {
  const natural = measureAt(100);
  if (!(natural > 0) || !(available > 0)) {
    return { stretch: 100, wrap: false };
  }
  const clamp = (value: number) =>
    Math.min(TITLE_STRETCH_MAX, Math.max(TITLE_STRETCH_MIN, value));
  let stretch = clamp((100 * available) / natural);
  const measured = measureAt(stretch);
  if (measured > available) {
    stretch = clamp((stretch * available) / measured);
  }
  // Settle on a half-percent step that actually fits: the corrected guess can
  // still land a pixel or two over, which the ellipsis would turn into a
  // clipped last letter.
  stretch = Math.floor(stretch * 2) / 2;
  while (stretch > TITLE_STRETCH_MIN && measureAt(stretch) > available) {
    stretch = Math.max(TITLE_STRETCH_MIN, stretch - 0.5);
  }
  if (measureAt(stretch) > available) {
    return { stretch: TITLE_STRETCH_WRAPPED, wrap: true };
  }
  return { stretch, wrap: false };
}

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

  // Fit the name before the card paints, once per card. The measure probe is
  // as wide as the line the CSS allows, so the width rule lives in one place.
  const titleRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (nonce === 0) return;
    const fit = () => {
      const title = titleRef.current;
      const measure = measureRef.current;
      if (!title || !measure) return;
      // Fractional widths throughout: scrollWidth rounds to whole pixels, and
      // a name 0.4px wider than its box passes an integer check yet still
      // trips the ellipsis. The half-pixel keeps clear of that edge.
      const available = measure.getBoundingClientRect().width - 0.5;
      // No layout yet (the stage can be unsized for the commit that flips the
      // shell to live on a phone): keep the unfitted two-line wrap rather
      // than forcing one line nobody has measured.
      if (available <= 0) return;
      title.dataset.fit = 'line';
      const text = document.createRange();
      text.selectNodeContents(title);
      const result = fitTitleStretch((stretch) => {
        title.style.fontStretch = `${stretch}%`;
        return text.getBoundingClientRect().width;
      }, available);
      title.style.fontStretch = `${result.stretch}%`;
      title.dataset.fit = result.wrap ? 'wrap' : 'line';
    };
    fit();
    // Refit when the line changes size — including from zero, once the stage
    // is laid out — and once Archivo has loaded, since a card that lands
    // before the font would otherwise stay fitted to the fallback face.
    let cancelled = false;
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    if (measureRef.current) observer?.observe(measureRef.current);
    void document.fonts?.ready.then(() => {
      if (!cancelled) fit();
    });
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [nonce]);

  if (!card) return null;

  return (
    <div
      key={card.nonce}
      className="stims-shell__title-card"
      data-leaving={leaving ? 'true' : undefined}
      aria-hidden="true"
    >
      <span className="stims-shell__title-card-measure" ref={measureRef} />
      <span className="stims-shell__title-card-title" ref={titleRef}>
        {card.title}
      </span>
      {card.byline ? (
        <span className="stims-shell__title-card-byline">{card.byline}</span>
      ) : null}
    </div>
  );
}
