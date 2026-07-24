export function normalizeLibraryPath(pathname: string) {
  return pathname.replace(/(?:index\.html)?$/, '');
}

export function shouldUseHistoryBackToLibrary({
  doc,
  win,
  backHref,
}: {
  doc: Document;
  win: Window & typeof globalThis;
  backHref: string;
}) {
  if (typeof win.history?.back !== 'function' || !doc.referrer) {
    return false;
  }

  try {
    const currentUrl = new URL(win.location.href);
    const libraryUrl = new URL(backHref, currentUrl.href);
    const referrerUrl = new URL(doc.referrer, currentUrl.href);

    return (
      referrerUrl.origin === currentUrl.origin &&
      normalizeLibraryPath(referrerUrl.pathname) ===
        normalizeLibraryPath(libraryUrl.pathname)
    );
  } catch (_error) {
    return false;
  }
}

export function navigateBackToLibrary({
  doc,
  win,
  backHref,
}: {
  doc: Document;
  win: Window & typeof globalThis;
  backHref: string;
}) {
  if (shouldUseHistoryBackToLibrary({ doc, win, backHref })) {
    win.history.back();
    return;
  }

  win.location.href = backHref;
}

export function bindLibraryBackLink(
  link: HTMLAnchorElement,
  {
    doc = link.ownerDocument,
    win = (link.ownerDocument.defaultView ?? window) as Window &
      typeof globalThis,
    backHref = link.href,
  }: {
    doc?: Document;
    win?: Window & typeof globalThis;
    backHref?: string;
  } = {},
) {
  const handleClick = (event: MouseEvent) => {
    if (!shouldUseHistoryBackToLibrary({ doc, win, backHref })) {
      return;
    }

    event.preventDefault();
    navigateBackToLibrary({ doc, win, backHref });
  };

  link.addEventListener('click', handleClick);

  return () => {
    link.removeEventListener('click', handleClick);
  };
}
