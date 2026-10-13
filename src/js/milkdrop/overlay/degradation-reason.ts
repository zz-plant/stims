/**
 * Degradation reason ranking — picks the compiled preset's most serious
 * parity degradation and names its category for the editor's notices.
 */

import type {
  MilkdropCompatibilityIssueCategory,
  MilkdropCompiledPreset,
} from '../types';

export function compatibilityCategoryLabel(
  category: MilkdropCompatibilityIssueCategory,
) {
  switch (category) {
    case 'unsupported-syntax':
      return 'Unsupported syntax';
    case 'unsupported-shader':
      return 'Unsupported shader';
    case 'runtime-divergence':
      return 'Runtime divergence';
    case 'backend-degradation':
      return 'Backend degradation';
    default:
      return 'Approximation';
  }
}

function compatibilityCategoryPriority(
  category: MilkdropCompatibilityIssueCategory,
) {
  switch (category) {
    case 'unsupported-syntax':
      return 0;
    case 'unsupported-shader':
      return 1;
    case 'backend-degradation':
      return 2;
    case 'runtime-divergence':
      return 3;
    default:
      return 4;
  }
}

export function getPrimaryDegradationReason(
  compiled: MilkdropCompiledPreset | null,
) {
  if (!compiled) {
    return null;
  }
  return [...compiled.ir.compatibility.parity.degradationReasons].sort(
    (left, right) => {
      if (left.blocking !== right.blocking) {
        return left.blocking ? -1 : 1;
      }
      return (
        compatibilityCategoryPriority(left.category) -
        compatibilityCategoryPriority(right.category)
      );
    },
  )[0];
}
