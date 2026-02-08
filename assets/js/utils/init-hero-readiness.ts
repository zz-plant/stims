import {
  isCompatibilityModeEnabled,
  subscribeToRenderPreferences,
} from '../core/render-preferences.ts';
import { getRenderCompatibilitySummary } from '../readiness-probe.ts';
import {
  getPerformanceSummaryLabel,
  subscribeToPerformanceSummary,
} from '../ui/system-controls.ts';

const buildCompatibilityLabel = () => {
  if (isCompatibilityModeEnabled()) {
    return 'WebGL forced';
  }

  return getRenderCompatibilitySummary().label;
};

export const initHeroReadinessSummary = () => {
  const summary = document.querySelector('[data-hero-readiness-summary]');
  if (!(summary instanceof HTMLElement)) return;

  const text = summary.querySelector('[data-hero-readiness-text]');
  if (!(text instanceof HTMLElement)) return;

  const updateSummary = (performanceLabel: string) => {
    const compatibilityLabel = buildCompatibilityLabel();
    text.textContent = `Ready • ${performanceLabel} • ${compatibilityLabel}`;
  };

  updateSummary(getPerformanceSummaryLabel());

  subscribeToPerformanceSummary((label) => {
    updateSummary(label);
  });

  subscribeToRenderPreferences(() => {
    updateSummary(getPerformanceSummaryLabel());
  });
};
