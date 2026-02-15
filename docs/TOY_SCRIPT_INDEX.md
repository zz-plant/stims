# Toy and Visualizer Script Index

This index maps each toy slug to the module that powers it and how the experience loads inside `toy.html`. Use it to find the right entry point quickly when updating assets or debugging loading behavior.

## Query-driven toys (`toy.html`)

`toy.html` reads the `toy` query parameter, looks up the matching entry in `assets/data/toys.json`, and imports the corresponding module through `assets/js/app.ts` and `assets/js/loader.ts`. Many modules render directly; others use the `startPageToy` helper to launch a standalone HTML page from the library shell.

| Slug                       | Entry module                                 | How it loads                                                      |
| -------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| `3dtoy`                    | `assets/js/toys/three-d-toy.ts`              | Direct module; load with `toy.html?toy=3dtoy`.                    |
| `aurora-painter`           | `assets/js/toys/aurora-painter.ts`           | Direct module; load with `toy.html?toy=aurora-painter`.           |
| `clay`                     | `assets/js/toys/clay.ts`                     | Direct module; load with `toy.html?toy=clay`.                     |
| `evol`                     | `assets/js/toys/evol.ts`                     | Standalone page launcher for `toys/evol.html`.                    |
| `geom`                     | `assets/js/toys/geom.ts`                     | Standalone page launcher for `toys/geom.html`.                    |
| `holy`                     | `assets/js/toys/holy.ts`                     | Standalone page launcher for `toys/holy.html`.                    |
| `multi`                    | `assets/js/toys/multi.ts`                    | Standalone page launcher for `toys/multi.html`; requires WebGPU.  |
| `seary`                    | `assets/js/toys/seary.ts`                    | Standalone page launcher for `toys/seary.html`.                   |
| `legible`                  | `assets/js/toys/legible.ts`                  | Standalone page launcher for `toys/legible.html`.                 |
| `symph`                    | `assets/js/toys/symph.ts`                    | Standalone page launcher for `toys/symph.html`.                   |
| `cube-wave`                | `assets/js/toys/cube-wave.ts`                | Direct module; load with `toy.html?toy=cube-wave`.                |
| `bubble-harmonics`         | `assets/js/toys/bubble-harmonics.ts`         | Direct module; load with `toy.html?toy=bubble-harmonics`.         |
| `pocket-pulse`             | `assets/js/toys/pocket-pulse.ts`             | Direct module; load with `toy.html?toy=pocket-pulse`.             |
| `cosmic-particles`         | `assets/js/toys/cosmic-particles.ts`         | Direct module; load with `toy.html?toy=cosmic-particles`.         |
| `lights`                   | `assets/js/toys/lights.ts`                   | Direct module; load with `toy.html?toy=lights`.                   |
| `spiral-burst`             | `assets/js/toys/spiral-burst.ts`             | Direct module; load with `toy.html?toy=spiral-burst`.             |
| `rainbow-tunnel`           | `assets/js/toys/rainbow-tunnel.ts`           | Direct module; load with `toy.html?toy=rainbow-tunnel`.           |
| `star-field`               | `assets/js/toys/star-field.ts`               | Direct module; load with `toy.html?toy=star-field`.               |
| `fractal-kite-garden`      | `assets/js/toys/fractal-kite-garden.ts`      | Direct module; load with `toy.html?toy=fractal-kite-garden`.      |
| `tactile-sand-table`       | `assets/js/toys/tactile-sand-table.ts`       | Direct module; load with `toy.html?toy=tactile-sand-table`.       |
| `bioluminescent-tidepools` | `assets/js/toys/bioluminescent-tidepools.ts` | Direct module; load with `toy.html?toy=bioluminescent-tidepools`. |
| `mobile-ripples`          | `assets/js/toys/mobile-ripples.ts`          | Direct module; load with `toy.html?toy=mobile-ripples`.          |
| `neon-wave`               | `assets/js/toys/neon-wave.ts`               | Direct module; load with `toy.html?toy=neon-wave`.               |
| `milkdrop`                | `assets/js/toys/milkdrop-toy.ts`            | Direct module; load with `toy.html?toy=milkdrop`.                |

## Standalone HTML entry points

Standalone toys can still be visited directly via their HTML pages under `toys/` (for example, `toys/holy.html` or `toys/lights.html`).

## Page-backed toy migration status

The following toy slugs still rely on `startPageToy` and open `toys/<slug>.html` through an embedded iframe bridge:

- `evol`
- `geom`
- `holy`
- `legible`
- `multi`
- `seary`
- `symph`

This removes the manual “Open standalone page” launcher, but these toys are still page-backed internally. To fully complete migration, convert each toy to direct module rendering in `assets/js/toys/<slug>.ts` and retire the iframe bridge.
