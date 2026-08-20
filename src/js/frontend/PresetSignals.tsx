import {
  describeFlashRisk,
  warnsForPhotosensitivity,
} from '../core/sensory-profile.ts';
import type { PresetCatalogEntry } from './contracts.ts';

/**
 * The two facts about a preset that change whether you want to play it.
 *
 * Both were already measured and stored on catalog entries and shown
 * nowhere — a preset row said title, author, and a mood word, while the
 * catalog knew how hard it reacts to audio and (once audited) whether it
 * strobes past the WCAG threshold.
 *
 * Only these two are surfaced inline. Fidelity class, certification status,
 * backend support, and curated rank are also on every entry, but a row with
 * six badges stops being scannable, and two of those are uniform across the
 * whole catalog today so they would carry no information at all.
 */

/**
 * Reactivity, shown only when it is the exception.
 *
 * The first version banded all three levels and printed one on every row.
 * Measured in the live list that came out as ten "Strongly beat-reactive" and
 * one "Moderately reactive" out of eleven — a badge on every row, saying the
 * same thing, which is chrome rather than signal. Most presets react well;
 * that is the baseline and the baseline needs no label.
 *
 * What earns a row is the case that surprises someone: a preset that largely
 * ignores audio. That is a legitimate aesthetic — ambient drift — and it is
 * also the single most common reason a user concludes the visualizer is
 * broken, which is exactly when a word of explanation is worth its space.
 *
 * The threshold is the old low band's upper edge, unchanged; only the
 * decision to render the other two was removed.
 */
const AMBIENT_REACTIVITY_MAX = 0.45;

function describeReactivity(score: number): string | null {
  if (score >= AMBIENT_REACTIVITY_MAX) return null;
  return 'Ambient · low reactivity';
}

function readReactivity(entry: PresetCatalogEntry): number | null {
  // Typed, not cast. This was an `as unknown as` read of a field the catalog
  // projection did not actually carry, so it compiled, passed a test fed raw
  // catalog.json, and returned null for every real entry in the app.
  const measured = entry.quality?.components?.measuredReactivity;
  return typeof measured === 'number' ? measured : null;
}

export function PresetSignals({
  entry,
  /** Omit the reactivity chip where space is tightest (grid tiles). */
  showReactivity = true,
}: {
  entry: PresetCatalogEntry;
  showReactivity?: boolean;
}) {
  const profile = entry.sensoryProfile;
  const warns = warnsForPhotosensitivity(profile);
  const reactivity = showReactivity ? readReactivity(entry) : null;
  const reactivityLabel =
    reactivity === null ? null : describeReactivity(reactivity);

  if (!warns && !reactivityLabel) return null;

  return (
    <span className="stims-preset-signals">
      {warns ? (
        // Not aria-hidden and not icon-only: this is the one chip whose
        // absence could matter to someone, so it carries real text for
        // screen readers as well as sighted users.
        <span
          className="stims-preset-signals__chip stims-preset-signals__chip--flash"
          title={`${describeFlashRisk(profile?.flashRiskLevel ?? 'unknown')} — measured above the WCAG flash threshold`}
        >
          <span aria-hidden="true">⚡</span> Flashing
        </span>
      ) : null}
      {reactivityLabel ? (
        <span className="stims-preset-signals__chip">{reactivityLabel}</span>
      ) : null}
    </span>
  );
}
