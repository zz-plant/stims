# Toy and Visualizer Script Index

This index maps each toy slug to the module that powers it and how the experience loads inside `toy.html`. Use it to find the right entry point quickly when updating assets or debugging loading behavior.

## Query-driven toys (`toy.html`)

`toy.html` reads the `toy` query parameter, looks up the matching entry in `assets/data/toys.json`, and imports the corresponding module through `assets/js/app.ts` and `assets/js/loader.ts`. Many modules render directly; a few still use `startPageToy` to embed a legacy HTML implementation internally while keeping `toy.html` as the public entry surface.

| Slug                       | Entry module                                 | How it loads                                                      |
| -------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| `3dtoy`                    | `assets/js/toys/three-d-toy.ts`              | Direct module; load with `toy.html?toy=3dtoy`.                    |
| `aurora-painter`           | `assets/js/toys/aurora-painter.ts`           | Direct module; load with `toy.html?toy=aurora-painter`.           |
| `clay`                     | `assets/js/toys/clay.ts`                     | Direct module; load with `toy.html?toy=clay`.                     |
| `evol`                     | `assets/js/toys/evol.ts`                     | Shell entry is `toy.html?toy=evol`; internally embeds `toys/evol.html`.                    |
| `geom`                     | `assets/js/toys/geom.ts`                     | Shell entry is `toy.html?toy=geom`; internally embeds `toys/geom.html`.                    |
| `holy`                     | `assets/js/toys/holy.ts`                     | Shell entry is `toy.html?toy=holy`; internally embeds `toys/holy.html`.                    |
| `multi`                    | `assets/js/toys/multi.ts`                    | Shell entry is `toy.html?toy=multi`; internally embeds `toys/multi.html`; requires WebGPU.  |
| `seary`                    | `assets/js/toys/seary.ts`                    | Shell entry is `toy.html?toy=seary`; internally embeds `toys/seary.html`.                   |
| `legible`                  | `assets/js/toys/legible.ts`                  | Shell entry is `toy.html?toy=legible`; internally embeds `toys/legible.html`.                 |
| `symph`                    | `assets/js/toys/symph.ts`                    | Shell entry is `toy.html?toy=symph`; internally embeds `toys/symph.html`.                   |
| `cube-wave`                | `assets/js/toys/cube-wave.ts`                | Direct module; load with `toy.html?toy=cube-wave`.                |
| `bubble-harmonics`         | `assets/js/toys/bubble-harmonics.ts`         | Direct module; load with `toy.html?toy=bubble-harmonics`.         |
| `pocket-pulse`             | `assets/js/toys/pocket-pulse.ts`             | Direct module; load with `toy.html?toy=pocket-pulse`.             |
| `cosmic-particles`         | `assets/js/toys/cosmic-particles.ts`         | Direct module; load with `toy.html?toy=cosmic-particles`.         |
| `lights`                   | `assets/js/toys/lights.ts`                   | Direct module; load with `toy.html?toy=lights`.                   |
| `juke-grid`                | `assets/js/toys/juke-grid.ts`                | Direct module; load with `toy.html?toy=juke-grid`.                |
| `heel-toe-comets`          | `assets/js/toys/heel-toe-comets.ts`          | Direct module; load with `toy.html?toy=heel-toe-comets`.          |
| `battle-fan`               | `assets/js/toys/battle-fan.ts`               | Direct module; load with `toy.html?toy=battle-fan`.               |
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

Direct visits to `toys/*.html` now redirect into `toy.html?toy=<slug>`. Those HTML files remain only as legacy embed targets for the iframe bridge (`?embed=1`) and should not be treated as a separate user-facing shell.

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
