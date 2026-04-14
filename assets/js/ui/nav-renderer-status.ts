import type { NavOptions } from './nav.ts';
import { escapeHtml, renderIconSlot } from './nav-shared.ts';

export function renderRendererStatus(
  container: HTMLElement,
  status: NonNullable<NavOptions['rendererStatus']>,
) {
  const fallback = status.backend !== 'webgpu';
  const fallbackReason = status.fallbackReason
    ? escapeHtml(status.fallbackReason)
    : null;
  if (!fallback && !fallbackReason && !status.actionLabel) {
    container.innerHTML = '';
    container.hidden = true;
    return;
  }
  container.hidden = false;
  const pillClass = fallback
    ? 'renderer-pill--fallback'
    : 'renderer-pill--success';
  const titleText = escapeHtml(
    status.fallbackReason ??
      (fallback
        ? 'Using a simpler renderer on this device.'
        : 'Using the highest-quality renderer available on this device.'),
  );

  container.innerHTML = `
    <div class="renderer-status">
      <span class="renderer-pill ${pillClass}" title="${titleText}">
        ${renderIconSlot(
          fallback ? 'gauge' : 'sparkles',
          'renderer-pill__icon stims-icon-slot stims-icon-slot--sm',
          fallback ? 'Fallback renderer' : 'Best quality renderer',
        )}
        <span class="renderer-pill__label">${fallback ? 'Using a simpler renderer' : 'Best quality'}</span>
      </span>
      ${status.actionLabel ? `<button type="button" class="renderer-pill__retry">${escapeHtml(status.actionLabel)}</button>` : ''}
    </div>
  `;

  const retryBtn = container.querySelector('.renderer-pill__retry');
  retryBtn?.addEventListener('click', () => status.onAction?.());
}
