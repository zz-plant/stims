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

  const trigger = document.querySelector('[data-open-preflight]');
  if (!(trigger instanceof HTMLElement)) return;

  const preflight = attachCapabilityPreflight({
    heading: 'System check',
    host: document.body,
    openOnAttach: false,
    allowCloseWhenBlocked: true,
    showCloseButton: true,
  });

  trigger.addEventListener('click', () => {
    preflight.open(trigger);
  });
};
