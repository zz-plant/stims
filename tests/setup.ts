import { Window } from 'happy-dom';

const windowInstance = new Window();

globalThis.window = windowInstance as unknown as Window &
  typeof globalThis.window;
globalThis.document = windowInstance.document as unknown as Document;
globalThis.navigator = windowInstance.navigator as unknown as Navigator;
globalThis.localStorage = windowInstance.localStorage;
globalThis.sessionStorage = windowInstance.sessionStorage;

// Align commonly used globals
globalThis.HTMLElement = windowInstance.HTMLElement as unknown as typeof HTMLElement;
globalThis.Event = windowInstance.Event as unknown as typeof Event;
globalThis.CustomEvent = windowInstance.CustomEvent as unknown as typeof CustomEvent;
globalThis.DOMParser = windowInstance.DOMParser as unknown as typeof DOMParser;
