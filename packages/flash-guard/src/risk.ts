/**
 * Turning a measurement into a risk band, in one place.
 *
 * WCAG 2.3.1 sets the general and red flash threshold at 3 flashes per
 * second. That is the line for "flag for review", not a medical
 * determination. The bands below the line are advisory: they let a viewer
 * avoid busy content, and they are not a safety claim.
 */
import { FLASHES_PER_SECOND_LIMIT } from './thresholds.ts';

export type FlashRiskLevel = 'unknown' | 'none' | 'low' | 'medium' | 'high';

/** The subset of a FlashAnalysis the classifier reads. */
export type FlashMeasurement = {
  peakFlashesPerSecond: number;
  peakRedFlashesPerSecond: number;
};

/**
 * Deliberately conservative in one direction only: content that exceeds the
 * WCAG limit on *either* the general or the red-flash channel is 'high',
 * because red flash is the more dangerous of the two and is not a subset of
 * the general count.
 *
 * 'none' means measured and essentially still. It is not "safe": no
 * automated measurement can promise that for an individual, which is why
 * 'unknown' and 'none' are distinct values and why a UI must never render
 * unmeasured content as if it were calm.
 */
export function classifyFlashRisk(
  measurement: FlashMeasurement,
): FlashRiskLevel {
  const { peakFlashesPerSecond, peakRedFlashesPerSecond } = measurement;
  if (
    peakFlashesPerSecond > FLASHES_PER_SECOND_LIMIT ||
    peakRedFlashesPerSecond > FLASHES_PER_SECOND_LIMIT
  ) {
    return 'high';
  }
  // Right at the threshold, or close under it: a 1 s window is a coarse
  // instrument and content at 2.5/s is not meaningfully calmer than content
  // at 3.1/s, so this band exists rather than rounding down to 'low'.
  if (peakFlashesPerSecond >= 2 || peakRedFlashesPerSecond >= 2) {
    return 'medium';
  }
  if (peakFlashesPerSecond > 0 || peakRedFlashesPerSecond > 0) {
    return 'low';
  }
  return 'none';
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
