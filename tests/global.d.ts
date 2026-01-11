import type { Window } from 'happy-dom';

declare global {
  var window: Window & typeof globalThis.window;
  var document: Window['document'];
  var navigator: Window['navigator'];
  var localStorage: Window['localStorage'];
  var sessionStorage: Window['sessionStorage'];

  var HTMLElement: typeof globalThis.HTMLElement;
  var Event: typeof globalThis.Event;
  var CustomEvent: typeof globalThis.CustomEvent;
  var DOMParser: typeof globalThis.DOMParser;
}

export {};
