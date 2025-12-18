# Toy and Visualizer Script Index

This index lists which JavaScript or TypeScript entry points power each toy/visualizer. It is organized by how the experiences are loaded so contributors can quickly find the right source files.

## Query-driven toys (`toy.html`)
`toy.html` pulls the toy slug from the `toy` query parameter and uses `assets/js/toyMain.js` and `assets/js/loader.js` to load the matching module from `assets/js/toys-data.js`.

| Slug | Entry module (TypeScript) | How to load |
| --- | --- | --- |
| `3dtoy` | `assets/js/toys/three-d-toy.ts` | `toy.html?toy=3dtoy` |
| `cube-wave` | `assets/js/toys/cube-wave.ts` | `toy.html?toy=cube-wave` |
| `cosmic-particles` | `assets/js/toys/cosmic-particles.ts` | `toy.html?toy=cosmic-particles` |
| `spiral-burst` | `assets/js/toys/spiral-burst.ts` | `toy.html?toy=spiral-burst` |
| `rainbow-tunnel` | `assets/js/toys/rainbow-tunnel.ts` | `toy.html?toy=rainbow-tunnel` |
| `star-field` | `assets/js/toys/star-field.ts` | `toy.html?toy=star-field` |

## Standalone HTML visualizers
These pages embed their own module scripts. Use the imports below to find the main logic.

- **brand.html** → imports `assets/js/core/web-toy.ts`, `assets/js/core/animation-loop.ts`, `assets/js/utils/error-display.ts`, `assets/js/utils/start-audio.ts`, `assets/ui/hints.ts`, `assets/ui/fun-controls.ts`, and `assets/brand/fun-adapter.ts`.
- **clay.html** → imports `assets/js/utils/webgl-check.ts`.
- **defrag.html** → imports `assets/js/utils/audio-handler.ts` and `assets/js/utils/error-display.ts`.
- **evol.html** → imports `assets/js/utils/audio-handler.ts` and `assets/js/utils/canvas-resize.ts`.
- **geom.html** → uses inline canvas and Web Audio logic only (no repo modules).
- **holy.html** → imports `assets/js/utils/webgl-check.ts` alongside Three.js helpers.
- **index.html** → uses `assets/js/main.js` to render the toy library.
- **legible.html** → contains only inline logic plus `particles.js` from a CDN.
- **lights.html** → loads `assets/js/app.js` as the entry module.
- **multi.html** → imports `assets/js/core/web-toy.ts`, `assets/js/core/animation-loop.ts`, `assets/js/utils/peak-detector.ts`, `assets/js/utils/audio-handler.ts`, `assets/js/utils/error-display.ts`, `assets/js/utils/start-audio.ts`, `assets/ui/hints.ts`, `assets/ui/fun-controls.ts`, and `assets/multi/fun-adapter.ts`.
- **seary.html** → imports `assets/js/utils/audio-handler.ts`, `assets/js/utils/peak-detector.ts`, `assets/js/utils/error-display.ts`, `assets/ui/hints.ts`, `assets/ui/fun-controls.ts`, `assets/seary/fun-adapter.ts`, and `assets/js/utils/canvas-resize.ts`.
- **sgpat.html** → executes `assets/js/toys/sgpat.ts` directly.
- **svgtest.html** → imports `assets/js/utils/webgl-check.ts` and `assets/js/utils/audio-handler.ts` alongside Three.js.
- **symph.html** → imports `assets/js/utils/audio-handler.ts`, `assets/js/utils/canvas-resize.ts`, `assets/js/utils/error-display.ts`, `assets/ui/hints.ts`, `assets/ui/fun-controls.ts`, and `assets/symph/fun-adapter.ts`.
- **toy.html** → uses `assets/js/toyMain.js`, which delegates to the loader to import modules listed above.
- **words.html** → imports `assets/js/utils/audio-handler.ts` and `assets/js/utils/error-display.ts` (alongside `wordcloud2` from CDN).
