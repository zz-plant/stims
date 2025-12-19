# Toy and Visualizer Script Index

This index maps each toy slug to the module that powers it and how the experience loads inside `toy.html`. Use it to find the right entry point quickly when updating assets or debugging loading behavior.

## Query-driven toys (`toy.html`)
`toy.html` reads the `toy` query parameter, looks up the matching entry in `assets/js/toys-data.js`, and imports the corresponding module through `assets/js/toyMain.js` and `assets/js/loader.ts`. Many modules render directly; others use the `startIframeToy` helper to embed an existing HTML page inside the library shell.

| Slug | Entry module | How it loads |
| --- | --- | --- |
| `3dtoy` | `assets/js/toys/three-d-toy.ts` | Direct module; load with `toy.html?toy=3dtoy`. |
| `aurora-painter` | `assets/js/toys/aurora-painter.ts` | Direct module; load with `toy.html?toy=aurora-painter`. |
| `brand` | `assets/js/toys/brand.ts` | Iframe wrapper around `brand.html`. |
| `clay` | `assets/js/toys/clay.ts` | Iframe wrapper around `clay.html`. |
| `defrag` | `assets/js/toys/defrag.ts` | Iframe wrapper around `defrag.html`. |
| `evol` | `assets/js/toys/evol.ts` | Iframe wrapper around `evol.html`. |
| `geom` | `assets/js/toys/geom.ts` | Iframe wrapper around `geom.html`. |
| `holy` | `assets/js/toys/holy.ts` | Iframe wrapper around `holy.html`. |
| `multi` | `assets/js/toys/multi.ts` | Iframe wrapper around `multi.html`; requires WebGPU support. |
| `seary` | `assets/js/toys/seary.ts` | Iframe wrapper around `seary.html`. |
| `sgpat` | `assets/js/toys/sgpat.ts` | Direct module; load with `toy.html?toy=sgpat`. |
| `legible` | `assets/js/toys/legible.ts` | Direct module; load with `toy.html?toy=legible`. |
| `svgtest` | `assets/js/toys/svgtest.ts` | Iframe wrapper around `svgtest.html`. |
| `symph` | `assets/js/toys/symph.ts` | Iframe wrapper around `symph.html`. |
| `words` | `assets/js/toys/words.ts` | Iframe wrapper around `words.html`. |
| `cube-wave` | `assets/js/toys/cube-wave.ts` | Direct module; load with `toy.html?toy=cube-wave`. |
| `bubble-harmonics` | `assets/js/toys/bubble-harmonics.ts` | Direct module; load with `toy.html?toy=bubble-harmonics`. |
| `cosmic-particles` | `assets/js/toys/cosmic-particles.ts` | Direct module; load with `toy.html?toy=cosmic-particles`. |
| `lights` | `assets/js/toys/lights.ts` | Iframe wrapper around `lights.html`. |
| `spiral-burst` | `assets/js/toys/spiral-burst.ts` | Direct module; load with `toy.html?toy=spiral-burst`. |
| `rainbow-tunnel` | `assets/js/toys/rainbow-tunnel.ts` | Direct module; load with `toy.html?toy=rainbow-tunnel`. |
| `star-field` | `assets/js/toys/star-field.ts` | Direct module; load with `toy.html?toy=star-field`. |
| `fractal-kite-garden` | `assets/js/toys/fractal-kite-garden.ts` | Direct module; load with `toy.html?toy=fractal-kite-garden`. |

## Standalone HTML entry points
All iframe-backed toys can still be visited directly via their HTML pages (for example, `brand.html` or `holy.html`). The library view now embeds those same pages for consistency with query-loaded modules.

## Touch-enabled and gesture-aware toys
- `sgpat`: multi-touch pan/zoom/rotate gestures drive the spectrograph focus and ripple direction via `assets/js/utils/pointer-input.ts`.
