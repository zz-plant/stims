/**
 * Photosensitivity profile for a preset, and the one place a measurement is
 * turned into a risk level.
 *
 * This type existed in frontend/contracts.ts with no producer and no
 * consumer — nothing wrote it, nothing read it, and zero of the 1787
 * catalog entries carried one, even though the WCAG 2.3.1 instrument
 * (scripts/analyze-preset-flash.ts) has been shipping the whole time. It
 * lives in core now because both the merge script and the UI need it, and
 * because the classifier below must be the single definition of where the
 * bands fall: a warning in the UI and a filter in Browse are worthless if
 * they disagree about what "high" means.
 *
 * WCAG 2.3.1 sets the general and red flash threshold at 3 flashes per
 * second. That is the line for "flags for review", not a medical
 * determination — see the caveats on classifyFlashRisk.
 */

export type FlashRiskLevel = 'unknown' | 'none' | 'low' | 'medium' | 'high';

export type PresetSensoryProfile = {
  flashRiskLevel: FlashRiskLevel;
  maxTransitionsPerSecondEstimate: number;
  meanLuminance: number;
  maxLuminanceDelta: number;
  /** ISO timestamp of the lab run that produced this entry. */
  measuredAt: string;
};

/** The WCAG general/red flash threshold, in flashes per second. */
export const WCAG_FLASHES_PER_SECOND_LIMIT = 3;

/**
 * The measurement this classifier consumes. Structurally a subset of the
 * lab's FlashAnalysis, declared here so `core` does not depend on `scripts`.
 */
export type FlashMeasurement = {
  peakFlashesPerSecond: number;
  peakRedFlashesPerSecond: number;
  meanLuminance: number;
  /** Std-dev of frame-to-frame luminance change. */
  luminanceVolatility: number;
};

/**
 * Turn a measured timeline into a risk band.
 *
 * Deliberately conservative in one direction only: a preset that exceeds the
 * WCAG limit on *either* the general or the red-flash channel is 'high',
 * because red flash is the more dangerous of the two and is not a subset of
 * the general count. Below the limit the bands are advisory — they let a
 * user avoid busy presets, and they are not a safety claim.
 *
 * 'none' means measured and essentially still. It is not "safe": no
 * automated measurement can promise that for an individual, which is why
 * `unknown` and `none` are distinct values and why the UI must never render
 * an unmeasured preset as if it were calm.
 */
export function classifyFlashRisk(
  measurement: FlashMeasurement,
): FlashRiskLevel {
  const { peakFlashesPerSecond, peakRedFlashesPerSecond } = measurement;

  if (
    peakFlashesPerSecond > WCAG_FLASHES_PER_SECOND_LIMIT ||
    peakRedFlashesPerSecond > WCAG_FLASHES_PER_SECOND_LIMIT
  ) {
    return 'high';
  }
  // Right at the threshold, or close under it: a 1s window is a coarse
  // instrument and a preset at 2.5/s is not meaningfully calmer than one at
  // 3.1/s, so this band exists rather than rounding it down to 'low'.
  if (peakFlashesPerSecond >= 2 || peakRedFlashesPerSecond >= 2) {
    return 'medium';
  }
  if (peakFlashesPerSecond > 0 || peakRedFlashesPerSecond > 0) {
    return 'low';
  }
  return 'none';
}

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

/** Short, non-clinical label for a risk band. */
export function describeFlashRisk(level: FlashRiskLevel): string {
  switch (level) {
    case 'high':
      return 'Frequent flashing';
    case 'medium':
      return 'Some flashing';
    case 'low':
      return 'Occasional flashing';
    case 'none':
      return 'No flashing measured';
    default:
      return 'Flashing not measured';
  }
}
