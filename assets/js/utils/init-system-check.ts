import { attachCapabilityPreflight } from '../core/capability-preflight.ts';
import { initReadinessProbe } from '../readiness-probe.ts';
import { initSystemControls } from '../ui/system-controls.ts';

export const initSystemCheck = () => {
  const readinessPanel = document.querySelector('[data-readiness-panel]');
  if (readinessPanel) {
    initReadinessProbe();
  }

  const controlsHost = document.querySelector('[data-system-controls]');
  if (controlsHost instanceof HTMLElement) {
    initSystemControls(controlsHost, {
      title: 'Performance & compatibility',
      description:
        'Tune render quality, cap DPI, and force WebGL for older GPUs. Settings persist on this device.',
      variant: 'inline',
    });
  }

  const triggers = Array.from(
    document.querySelectorAll('[data-open-preflight]'),
  ).filter((element): element is HTMLElement => element instanceof HTMLElement);
  if (triggers.length === 0) return;

  const preflight = attachCapabilityPreflight({
    heading: 'System check',
    host: document.body,
    openOnAttach: false,
    allowCloseWhenBlocked: true,
    showCloseButton: true,
  });

  triggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      preflight.open(trigger);
    });
  });
};
