import { attachCapabilityPreflight } from '../core/capability-preflight.ts';
import { setQualityPresetById } from '../core/settings-panel.ts';
import { initReadinessProbe } from '../readiness-probe.ts';
import { initSystemControls } from '../ui/system-controls.ts';

export const initSystemCheck = ({
  enablePreflightModal = true,
}: {
  enablePreflightModal?: boolean;
} = {}) => {
  const readinessPanel = document.querySelector('[data-readiness-panel]');
  if (readinessPanel) {
    initReadinessProbe();
  }

  const detailsToggles = Array.from(
    document.querySelectorAll('[data-details-toggle]'),
  ).filter((element): element is HTMLElement => element instanceof HTMLElement);
  const setDetailsOpen = (open: boolean) => {
    if (open) {
      document.body.setAttribute('data-details-open', 'true');
    } else {
      document.body.removeAttribute('data-details-open');
    }
    detailsToggles.forEach((toggle) => {
      toggle.setAttribute('aria-expanded', String(open));
    });
  };

  const syncDetailsFromHash = () => {
    setDetailsOpen(window.location.hash === '#system-check');
  };

  syncDetailsFromHash();
  window.addEventListener('hashchange', syncDetailsFromHash);

  detailsToggles.forEach((toggle) => {
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      const open = !document.body.hasAttribute('data-details-open');
      setDetailsOpen(open);
      if (open) {
        window.location.hash = 'system-check';
      } else if (window.location.hash === '#system-check') {
        window.history.replaceState(
          null,
          '',
          window.location.pathname + window.location.search,
        );
      }
    });
  });

  const controlsHost = document.querySelector('[data-system-controls]');
  if (controlsHost instanceof HTMLElement) {
    initSystemControls(controlsHost, {
      title: 'Performance settings',
      description: 'Quick adjustments for this device.',
      variant: 'inline',
      includeAdvancedControls: false,
      showDetailedQualitySummary: false,
    });
  }

  const scrollTriggers = Array.from(
    document.querySelectorAll('[data-scroll-to-system-check]'),
  ).filter((element): element is HTMLElement => element instanceof HTMLElement);

  scrollTriggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      setDetailsOpen(true);
      if (window.location.hash !== '#system-check') {
        window.location.hash = 'system-check';
      }
      const target = document.getElementById('system-check');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const lighterVisualTriggers = Array.from(
    document.querySelectorAll('[data-enable-lighter-visuals]'),
  ).filter((element): element is HTMLElement => element instanceof HTMLElement);

  lighterVisualTriggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      setQualityPresetById('performance');
      setDetailsOpen(true);
      if (window.location.hash !== '#system-check') {
        window.location.hash = 'system-check';
      }
      const target = document.getElementById('system-check');
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  if (!enablePreflightModal) return;

  const triggers = Array.from(
    document.querySelectorAll('[data-open-preflight]'),
  ).filter((element): element is HTMLElement => element instanceof HTMLElement);
  if (triggers.length === 0) return;

  const preflight = attachCapabilityPreflight({
    heading: 'Quick check',
    host: document.body,
    openOnAttach: false,
    allowCloseWhenBlocked: true,
    showCloseButton: true,
  });

  triggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      setDetailsOpen(true);
      if (window.location.hash !== '#system-check') {
        window.location.hash = 'system-check';
      }
      preflight.open(trigger);
    });
  });
};
