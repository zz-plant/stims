import { isAgentMode } from '../../core/url-params.ts';
import type { MilkdropDiagnostic } from '../common-types.ts';

const IS_DEV =
  typeof window !== 'undefined'
    ? isAgentMode() || window.location.hostname === 'localhost'
    : false;

export function createPresetLoadTrace(presetId: string) {
  const startTime = performance.now();
  let lastStepTime = startTime;
  let currentStep = 'start';
  let success = true;
  const steps: Array<{ name: string; duration: number }> = [];
  const diagnostics: MilkdropDiagnostic[] = [];

  const recordDiagnostics = (items: MilkdropDiagnostic[]) => {
    if (items && Array.isArray(items)) {
      diagnostics.push(...items);
    }
  };

  const getCategoryBreakdown = () => {
    const counts: Record<
      string,
      { errors: number; warnings: number; info: number }
    > = {};
    for (const d of diagnostics) {
      const cat = d.category ?? 'uncategorized';
      if (!counts[cat]) {
        counts[cat] = { errors: 0, warnings: 0, info: 0 };
      }
      if (d.severity === 'error') counts[cat].errors += 1;
      else if (d.severity === 'warning') counts[cat].warnings += 1;
      else counts[cat].info += 1;
    }
    return counts;
  };

  if (!IS_DEV) {
    return {
      step: () => {},
      warn: () => {},
      error: () => {
        success = false;
      },
      adapter: () => {},
      recordDiagnostics,
      done: () => ({
        presetId,
        totalDuration: 0,
        steps,
        success,
        diagnostics,
        categoryBreakdown: getCategoryBreakdown(),
      }),
      getSuccess: () => success,
    };
  }

  console.groupCollapsed(`[PresetLoad] ${presetId}`);

  const step = (name: string) => {
    const now = performance.now();
    const duration = now - lastStepTime;
    if (currentStep !== 'start') {
      steps.push({ name: currentStep, duration });
    }
    console.info(`  → ${name} (${duration.toFixed(1)}ms)`);
    currentStep = name;
    lastStepTime = now;
  };

  const warn = (message: string) => {
    console.warn(`  ⚠ ${message}`);
  };

  const error = (message: string) => {
    success = false;
    console.error(`  ✗ ${message}`);
  };

  const adapter = (name: string, detail?: string) => {
    console.info(`  🔌 ${name}${detail ? `: ${detail}` : ''}`);
  };

  const done = (result?: string) => {
    const now = performance.now();
    const duration = now - lastStepTime;
    steps.push({ name: currentStep, duration });
    const total = now - startTime;
    const breakdown = getCategoryBreakdown();
    const breakdownParts = Object.entries(breakdown).map(
      ([cat, counts]) =>
        `${cat}: ${counts.errors} error(s), ${counts.warnings} warning(s)`,
    );
    const breakdownStr =
      breakdownParts.length > 0 ? ` (${breakdownParts.join(' | ')})` : '';
    const msg = result ?? (success ? 'loaded' : 'failed');
    if (success) {
      console.info(`✓ ${msg} (${total.toFixed(1)}ms)${breakdownStr}`);
    } else {
      console.error(`✗ ${msg} (${total.toFixed(1)}ms)${breakdownStr}`);
    }
    console.groupEnd();
    return {
      presetId,
      totalDuration: total,
      steps,
      success,
      diagnostics,
      categoryBreakdown: breakdown,
    };
  };

  return {
    step,
    warn,
    error,
    adapter,
    recordDiagnostics,
    done,
    getSuccess: () => success,
  };
}
