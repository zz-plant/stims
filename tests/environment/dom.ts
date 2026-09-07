import { Window } from 'happy-dom';

const savedDescriptors = new Map<string, PropertyDescriptor | undefined>();

let windowInstance: Window | null = null;

function defineGlobal(name: string, value: unknown) {
  if (!savedDescriptors.has(name)) {
    savedDescriptors.set(
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    );
  }

  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

function restoreGlobals() {
  for (const [name, descriptor] of savedDescriptors.entries()) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
      continue;
    }

    Reflect.deleteProperty(globalThis, name);
  }

  savedDescriptors.clear();
}

export function installDomEnvironment() {
  restoreGlobals();

  windowInstance = new Window();

  defineGlobal('window', windowInstance);
  defineGlobal('Window', Window);
  defineGlobal('document', windowInstance.document);
  defineGlobal('navigator', windowInstance.navigator);
  defineGlobal('localStorage', windowInstance.localStorage);
  defineGlobal('sessionStorage', windowInstance.sessionStorage);
  defineGlobal('HTMLElement', windowInstance.HTMLElement);
  defineGlobal('HTMLAnchorElement', windowInstance.HTMLAnchorElement);
  defineGlobal('HTMLButtonElement', windowInstance.HTMLButtonElement);
  defineGlobal('HTMLDetailsElement', windowInstance.HTMLDetailsElement);
  defineGlobal('HTMLInputElement', windowInstance.HTMLInputElement);
  defineGlobal('HTMLSelectElement', windowInstance.HTMLSelectElement);
  // The other three text-input constructors were here but this one was not,
  // and `isTextInput()` in unified-input.ts names all four: every keydown that
  // reached the canvas threw ReferenceError, which the DOM swallows as a
  // listener error, so keyboard input looked simply inert under test.
  defineGlobal('HTMLTextAreaElement', windowInstance.HTMLTextAreaElement);
  defineGlobal('Event', windowInstance.Event);
  defineGlobal('CustomEvent', windowInstance.CustomEvent);
  defineGlobal('DOMParser', windowInstance.DOMParser);
  // Components construct these bare (`new ResizeObserver(...)`) rather than
  // behind a `typeof` guard, because in a browser they always exist. happy-dom
  // implements both but only hangs them off the window, so without hoisting
  // them here any component that measures itself — the virtualized browse
  // sheet, the preview-batching preset grid — throws ReferenceError on mount.
  defineGlobal('ResizeObserver', windowInstance.ResizeObserver);
  defineGlobal('IntersectionObserver', windowInstance.IntersectionObserver);

  (
    windowInstance as unknown as { SyntaxError: typeof SyntaxError }
  ).SyntaxError = globalThis.SyntaxError;
  (windowInstance as unknown as { TypeError: typeof TypeError }).TypeError =
    globalThis.TypeError;

  return windowInstance;
}

export function getDomWindow() {
  return windowInstance;
}

/**
 * Replaces the DOM globals with a fresh window.
 *
 * Deliberately reinstalls rather than tearing down. `tests/setup.ts` installs
 * this environment once as the ambient baseline for the whole suite, and most
 * test files never install it themselves — they just use `document`. Bun runs
 * many files in one process, so a file that ended by *deleting* the globals
 * left every file scheduled after it with no `document` at all: the suite
 * failed on whichever file happened to come next (`ReferenceError: document is
 * not defined`) while each file passed when run alone.
 *
 * A test that wants a clean DOM wants exactly this. If real teardown is ever
 * needed, `uninstallDomEnvironment()` is the explicit way to ask for it — and
 * whatever asks must restore the baseline before the next file runs.
 */
export function resetDomEnvironment() {
  return installDomEnvironment();
}

/**
 * Removes the DOM globals entirely, leaving the process without a `document`.
 *
 * Only safe when nothing else will run afterwards in this process. Prefer
 * `resetDomEnvironment()`.
 */
export function uninstallDomEnvironment() {
  windowInstance = null;
  restoreGlobals();
}
