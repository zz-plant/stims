import { renderIconSvg, type UiIconName } from './icon-library.ts';

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (match) => {
    switch (match) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return match;
    }
  });
}

export function renderIconSlot(
  name: UiIconName,
  className: string,
  title?: string,
) {
  return `<span class="${className}" aria-hidden="true">${renderIconSvg(name, { title })}</span>`;
}

export function renderIconLabel(
  name: UiIconName,
  label: string,
  className = 'toy-nav__button-icon stims-icon-slot stims-icon-slot--sm',
) {
  return `${renderIconSlot(name, className, label)}<span class="toy-nav__button-label">${escapeHtml(label)}</span>`;
}
