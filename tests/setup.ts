import { Window } from 'happy-dom';

const windowInstance = new Window();

globalThis.window = windowInstance as unknown as Window &
  typeof globalThis.window;
globalThis.document = windowInstance.document;
globalThis.navigator = windowInstance.navigator;
globalThis.localStorage = windowInstance.localStorage;
globalThis.sessionStorage = windowInstance.sessionStorage;

// Align commonly used globals
globalThis.HTMLElement = windowInstance.HTMLElement as typeof HTMLElement;
globalThis.Event = windowInstance.Event as typeof Event;
globalThis.CustomEvent = windowInstance.CustomEvent as typeof CustomEvent;
globalThis.DOMParser = windowInstance.DOMParser as typeof DOMParser;
