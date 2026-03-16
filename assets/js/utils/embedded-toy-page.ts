export function isEmbeddedToyPage(win: Window & typeof globalThis = window) {
  return new URL(win.location.href).searchParams.get('embed') === '1';
}

export function hideEmbeddedToyHud(
  selectors: string[],
  doc: Document = document,
) {
  selectors.forEach((selector) => {
    doc.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      element.hidden = true;
      element.setAttribute('aria-hidden', 'true');
    });
  });
}
