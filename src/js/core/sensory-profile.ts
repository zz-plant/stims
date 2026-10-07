/**
 * Photosensitivity profile for a preset, and the one place a measurement is
 * turned into a risk level.
 *
 * This type existed in frontend/contracts.ts with no producer and no
 * consumer — nothing wrote it, nothing read it, and zero of the 1787
 * catalog entries carried one, even though the WCAG 2.3.1 instrument
 * (scripts/analyze-preset-flash.ts) has been shipping the whole time. It
 * lives in core now because both the merge script and the UI need it, and
 * because there must be a single definition of where the bands fall (the
 * classifier is `flash-guard`'s): a warning in the UI and a filter in Browse
 * are worthless if they disagree about what "high" means.
 *
 * WCAG 2.3.1 sets the general and red flash threshold at 3 flashes per
 * second. That is the line for "flags for review", not a medical
 * determination — see the caveats on classifyFlashRisk.
 */

import type {
  FlashRiskLevel,
  FlashMeasurement as RiskMeasurement,
} from 'flash-guard';
import { classifyFlashRisk } from 'flash-guard';

/**
 * The risk bands, their classifier and their labels come from `flash-guard`,
 * so the catalog, the Browse filter and the live governor share one
 * definition of where "high" starts. The WCAG limit is re-exported under
 * its old name for the merge script and the UI.
 */
export {
  classifyFlashRisk,
  describeFlashRisk,
  FLASHES_PER_SECOND_LIMIT as WCAG_FLASHES_PER_SECOND_LIMIT,
  type FlashRiskLevel,
} from 'flash-guard';

export type PresetSensoryProfile = {
  flashRiskLevel: FlashRiskLevel;
  maxTransitionsPerSecondEstimate: number;
  meanLuminance: number;
  maxLuminanceDelta: number;
  /** ISO timestamp of the lab run that produced this entry. */
  measuredAt: string;
};

/**
 * The measurement a profile is built from: what the classifier reads, plus
 * the two figures the stored profile keeps. Structurally a subset of the
 * lab's FlashAnalysis.
 */
export type FlashMeasurement = RiskMeasurement & {
  meanLuminance: number;
  /** Std-dev of frame-to-frame luminance change. */
  luminanceVolatility: number;
};

/** Build the stored profile from a measurement plus the run's timestamp. */
export function toSensoryProfile(
  measurement: FlashMeasurement,
  measuredAt: string,
): PresetSensoryProfile {
  return {
    flashRiskLevel: classifyFlashRisk(measurement),
    maxTransitionsPerSecondEstimate: Math.max(
      measurement.peakFlashesPerSecond,
      measurement.peakRedFlashesPerSecond,
    ),
    meanLuminance: measurement.meanLuminance,
    maxLuminanceDelta: measurement.luminanceVolatility,
    measuredAt,
  };
}

/** True when this preset should carry a visible photosensitivity warning. */
export function warnsForPhotosensitivity(
  profile: PresetSensoryProfile | undefined,
): boolean {
  return profile?.flashRiskLevel === 'high';
}

/**
 * Whether a "reduce flashing" preference should hide this preset.
 *
 * Unmeasured presets are *kept*, not hidden. Hiding them would silently
 * shrink the catalog to whatever the lab happens to have covered and would
 * imply the remainder had been cleared, which is the opposite of true.
 * The UI's job is to say the risk is unknown, not to pretend it is high.
 */
export function hiddenByFlashPreference(
  profile: PresetSensoryProfile | undefined,
): boolean {
  return profile?.flashRiskLevel === 'high';
}
