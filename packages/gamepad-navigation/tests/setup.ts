/**
 * A happy-dom window as the test globals. The library reads `document`,
 * `window`, `navigator.getGamepads`, `sessionStorage` and the element
 * constructors it narrows on (`HTMLInputElement` and friends), and dispatches
 * `KeyboardEvent`s; all of them come from one window so `instanceof` agrees
 * with the elements the tests create.
 */
import { Window } from 'happy-dom';

const window = new Window();
const globals = [
  'window',
  'document',
  'navigator',
  'sessionStorage',
  'localStorage',
  'HTMLElement',
  'HTMLAnchorElement',
  'HTMLButtonElement',
  'HTMLDetailsElement',
  'HTMLInputElement',
  'HTMLSelectElement',
  'HTMLTextAreaElement',
  'Node',
  'Event',
  'KeyboardEvent',
  'FocusEvent',
] as const;

for (const name of globals) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: (window as unknown as Record<string, unknown>)[name],
  });
}
