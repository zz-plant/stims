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
 * Reactivity bands. The underlying score is a continuous 0..1, but a number
 * on a browse row invites comparisons it cannot support — it is a measured
 * estimate under a synthetic stimulus, not a rating. Three bands say the
 * thing a user actually decides on: will this move with my music.
 */
function describeReactivity(score: number): string | null {
  if (score >= 0.8) return 'Strongly beat-reactive';
  if (score >= 0.45) return 'Moderately reactive';
  // Below this the preset largely ignores audio. That is a legitimate
  // aesthetic — ambient drift — but it is the single most common reason
  // someone thinks the visualizer is broken, so it is worth saying.
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
