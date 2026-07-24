const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function resolveHistoryPathname(win: Window) {
  if (win.location?.pathname) {
    return win.location.pathname;
  }

  if (win.location?.href) {
    try {
      return new URL(win.location.href).pathname;
    } catch (_error) {
      return '/';
    }
  }

  return '/';
}

export function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element) => !element.hasAttribute('aria-hidden'));
}

export function trapFocusWithin(panel: HTMLElement) {
  const focusable = () => getFocusableElements(panel);

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;

    const items = focusable();
    if (items.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    const active = panel.ownerDocument.activeElement;

    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleFocusIn = (event: FocusEvent) => {
    if (!(event.target instanceof Node) || panel.contains(event.target)) {
      return;
    }

    const items = focusable();
    if (items.length > 0) {
      items[0].focus();
    } else {
      panel.focus();
    }
  };

  panel.addEventListener('keydown', handleKeydown);
  panel.ownerDocument.addEventListener('focusin', handleFocusIn);

  return () => {
    panel.removeEventListener('keydown', handleKeydown);
    panel.ownerDocument.removeEventListener('focusin', handleFocusIn);
  };
}

export function restoreFocusIfPresent(
  target: HTMLElement | null | undefined,
  ownerDocument?: Document,
) {
  const activeDocument =
    ownerDocument ??
    target?.ownerDocument ??
    (typeof document !== 'undefined' ? document : null);

  if (!target || !activeDocument?.contains(target)) {
    return;
  }

  target.focus();
}

export function updateModalQueryParam({
  modalParam = 'modal',
  nextValue,
  usePush = true,
  win = window,
}: {
  modalParam?: string;
  nextValue: string | null;
  usePush?: boolean;
  win?: Window;
}) {
  const params = new URLSearchParams(win.location.search);
  if (nextValue) {
    params.set(modalParam, nextValue);
  } else {
    params.delete(modalParam);
  }

  const nextUrl = `${resolveHistoryPathname(win)}${
    params.toString() ? `?${params.toString()}` : ''
  }`;

  const nextState = {
    ...(typeof win.history.state === 'object' && win.history.state !== null
      ? win.history.state
      : {}),
  } as Record<string, unknown>;

  if (nextValue) {
    nextState[modalParam] = nextValue;
  } else {
    delete nextState[modalParam];
  }

  try {
    if (usePush) {
      win.history.pushState(nextState, '', nextUrl);
    } else {
      win.history.replaceState(nextState, '', nextUrl);
    }
  } catch (_error) {
    // Ignore history errors in non-browser environments.
  }
}
