# Toy Development

## Project structure

- Toy modules: `assets/js/toys/` (TypeScript modules exporting `start()`).
- Toy registry: `assets/data/toys.json` (slugs, metadata, capabilities).
- Standalone HTML toys: `toys/` directory (standalone pages launched from the library UI).
- Loader logic: `toy.html` + `assets/js/loader.ts`.
- Audio/runtime helpers: `assets/js/core/toy-runtime.ts` and `assets/js/utils/start-audio.ts`.

## Key patterns

- Every toy module exports `start({ container?, preferDemoAudio? })` for library cards or
  `start({ container? })` when embedding a Three.js scene directly.
- Page-based toys should call `startPageToy({ container, path, title, description, preferDemoAudio })`
  to render the launch panel that opens the standalone HTML file.
- Canvas-based toys should use `createToyRuntime(...)` to wire up WebGL, audio, input, and performance
  settings in one place.
- `start()` returns a disposable object (from `createToyRuntime` or `startPageToy`) that handles cleanup.
- Audio reactivity uses `registerToyGlobals` to expose `startAudio` to the standalone toy pages.
- Toys support microphone input or demo audio fallback by passing `preferDemoAudio` or `audio=demo`.
