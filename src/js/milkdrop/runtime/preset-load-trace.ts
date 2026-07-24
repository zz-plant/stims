const IS_DEV =
  typeof window !== 'undefined'
    ? window.location.search.includes('agent=true') ||
      window.location.hostname === 'localhost'
    : false;

export function createPresetLoadTrace(presetId: string) {
  const startTime = performance.now();
  let lastStepTime = startTime;
  let currentStep = 'start';
  let success = true;
  const steps: Array<{ name: string; duration: number }> = [];

  if (!IS_DEV) {
    return {
      step: () => {},
      warn: () => {},
      error: () => {
        success = false;
      },
      adapter: () => {},
      done: () => ({ presetId, totalDuration: 0, steps, success }),
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
    const msg = result ?? (success ? 'loaded' : 'failed');
    if (success) {
      console.info(`✓ ${msg} (${total.toFixed(1)}ms)`);
    } else {
      console.error(`✗ ${msg} (${total.toFixed(1)}ms)`);
    }
    console.groupEnd();
    return { presetId, totalDuration: total, steps, success };
  };

  return { step, warn, error, adapter, done, getSuccess: () => success };
}
