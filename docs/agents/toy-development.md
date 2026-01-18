# Toy Development

## Project structure

- Toy modules: `assets/js/toys/` (TypeScript modules exporting `start()`)
- Toy registry: `assets/js/toys-data.js` (slugs, metadata, capabilities)
- Legacy HTML toys: `toys/` directory (standalone pages)
- Loader logic: `toy.html` + `assets/js/loader.ts`
- Audio handling: `assets/js/core/audio-handler.ts`

## Key patterns

- Every toy module exports `start({ container, canvas?, audioContext? })`.
- `start()` returns a cleanup function that removes all DOM nodes.
- Audio reactivity uses `registerToyGlobals` to expose `startAudio` and `startAudioFallback`.
- Toys support microphone input or demo audio fallback.
