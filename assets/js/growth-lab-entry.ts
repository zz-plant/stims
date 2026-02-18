import { initOpportunitySignals } from './utils/init-opportunity-signals.ts';

if (typeof window !== 'undefined') {
  try {
    window.localStorage.setItem('stims:growth-lab-enabled', '1');
  } catch (_error) {
    // Ignore storage access issues.
  }
}

initOpportunitySignals();
