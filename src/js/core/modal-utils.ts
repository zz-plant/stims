const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

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
  ).filter((element) => {
    if (
      element.getAttribute('aria-hidden') === 'true' ||
      element.closest('[aria-hidden="true"]') ||
      element.getAttribute('tabindex') === '-1'
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Escape handlers for open overlays, outermost first.
 *
 * Escape used to be handled wherever each overlay felt like it. `SidePanel`
 * listened on `document`; the help dialogs used a React `onKeyDown` on their
 * backdrop, which React dispatches from the root container — *below*
 * `document` in the tree, so it runs first only when the event originates
 * inside that backdrop. Open the shortcuts dialog from inside Settings and
 * press Escape and the sheet underneath took the keypress: the sheet closed,
 * the dialog stayed open, and a second press did nothing because the sheet
 * was already gone. The dialog could only be escaped with a mouse.
 *
 * One document-level listener, dispatching to the innermost overlay, makes
 * Escape mean "close the thing in front of me" everywhere. It listens in the
 * bubble phase deliberately: a React handler that calls `stopPropagation`
 * still wins, which is what lets the Browse search field clear itself on
 * Escape without also closing the panel around it.
 */
const escapeHandlers: Array<() => void> = [];
let escapeListenerAttached = false;

function handleDocumentEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  const innermost = escapeHandlers[escapeHandlers.length - 1];
  if (!innermost) return;
  event.preventDefault();
  // Nothing further should act on a press that has closed something.
  event.stopPropagation();
  innermost();
}

/**
 * True while an overlay has claimed Escape.
 *
 * The global shortcut handler asks before acting: it registers on `document`
 * when the shell mounts, i.e. before any overlay exists, so it runs first and
 * neither `preventDefault` nor `stopPropagation` from here can reach back and
 * cancel it. A user who rebinds Escape to an action would otherwise fire that
 * action *and* dismiss the overlay with one press.
 */
export function escapeIsClaimed(): boolean {
  return escapeHandlers.length > 0;
}

/**
 * Registers `handler` as the Escape action for an overlay, and returns the
 * function that unregisters it. The most recently registered handler is the
 * innermost overlay and the only one that runs.
 */
export function registerEscapeHandler(handler: () => void): () => void {
  escapeHandlers.push(handler);
  if (!escapeListenerAttached && typeof document !== 'undefined') {
    document.addEventListener('keydown', handleDocumentEscape);
    escapeListenerAttached = true;
  }
  return () => {
    const index = escapeHandlers.lastIndexOf(handler);
    if (index !== -1) {
      escapeHandlers.splice(index, 1);
    }
    if (
      escapeHandlers.length === 0 &&
      escapeListenerAttached &&
      typeof document !== 'undefined'
    ) {
      document.removeEventListener('keydown', handleDocumentEscape);
      escapeListenerAttached = false;
    }
  };
}

/**
 * Duck-typed rather than `instanceof Node`.
 *
 * `instanceof` compares against one realm's constructor, so it answers false
 * for a node that came from another document — an iframe, or a test DOM whose
 * globals are not the ones this module closed over — and the focus trap then
 * silently stops enforcing instead of failing loudly. `nodeType` is the part
 * `Node.prototype.contains` actually needs.
 */
function isNode(value: unknown): value is Node {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Node).nodeType === 'number'
  );
}

/**
 * Every trap currently installed, outermost first.
 *
 * Only the innermost one may act. `handleFocusIn` below is a document-level
 * listener that pulls focus back into its own panel whenever focus lands
 * outside it, and nothing stopped two of those existing at once: opening the
 * shortcuts dialog (or the command palette) over an already-trapped Settings
 * panel left the panel mounted, so the dialog pulled focus in, the panel's
 * handler saw a target outside itself and pulled it back, and that dispatched
 * another focusin — synchronously, with no settling state. The tab locks up.
 *
 * A stack rather than a single "current" reference, because traps do not
 * always unwind in order: closing the outer panel first must leave the dialog
 * still enforcing.
 */
const activeFocusTraps: HTMLElement[] = [];

function isInnermostTrap(panel: HTMLElement) {
  return activeFocusTraps[activeFocusTraps.length - 1] === panel;
}

export function trapFocusWithin(panel: HTMLElement) {
  const focusable = () => getFocusableElements(panel);

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    // A nested trap's panel may sit inside this one, in which case its Tab
    // events bubble up here too. The innermost trap owns them.
    if (!isInnermostTrap(panel)) return;

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
    if (!isInnermostTrap(panel)) return;
    if (!isNode(event.target) || panel.contains(event.target)) {
      return;
    }

    const items = focusable();
    if (items.length > 0) {
      items[0].focus();
    } else {
      panel.focus();
    }
  };

  activeFocusTraps.push(panel);
  panel.addEventListener('keydown', handleKeydown);
  panel.ownerDocument.addEventListener('focusin', handleFocusIn);

  return () => {
    const index = activeFocusTraps.lastIndexOf(panel);
    if (index !== -1) {
      activeFocusTraps.splice(index, 1);
    }
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
