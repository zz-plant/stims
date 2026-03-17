# Toy and Visualizer Script Index

This index maps each toy slug to the module that powers it and how the experience loads inside `toy.html`. Stims is MilkDrop-led, and the broader lab now runs on the same runtime: non-`milkdrop` slugs are thin preset-alias modules that boot the shared MilkDrop runtime with a bundled starter preset.

## Query-driven toys (`toy.html`)

`toy.html` reads the `toy` query parameter, looks up the matching entry in `assets/data/toys.json`, and imports the corresponding module through `assets/js/app.ts` and `assets/js/loader.ts`. The flagship `milkdrop` slug uses the full MilkDrop module directly; every other registered slug now resolves to a thin preset-alias module that selects a bundled preset and reuses the same runtime/editor shell.

| Slug                       | Entry module                                 | How it loads                                                      |
| -------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| `3dtoy`                    | `assets/js/toys/3dtoy.ts`                    | MilkDrop preset alias; launches the shared runtime with the bundled `3dtoy` preset. |
| `aurora-painter`           | `assets/js/toys/aurora-painter.ts`           | MilkDrop preset alias; launches the shared runtime with the bundled `aurora-painter` preset. |
| `clay`                     | `assets/js/toys/clay.ts`                     | MilkDrop preset alias; launches the shared runtime with the bundled `clay` preset. |
| `evol`                     | `assets/js/toys/evol.ts`                     | MilkDrop preset alias; launches the shared runtime with the bundled `evol` preset. |
| `geom`                     | `assets/js/toys/geom.ts`                     | MilkDrop preset alias; launches the shared runtime with the bundled `geom` preset. |
| `holy`                     | `assets/js/toys/holy.ts`                     | MilkDrop preset alias; launches the shared runtime with the bundled `holy` preset. |
| `multi`                    | `assets/js/toys/multi.ts`                    | MilkDrop preset alias; launches the shared runtime with the bundled `multi` preset. |
| `seary`                    | `assets/js/toys/seary.ts`                    | MilkDrop preset alias; launches the shared runtime with the bundled `seary` preset. |
| `legible`                  | `assets/js/toys/legible.ts`                  | MilkDrop preset alias; launches the shared runtime with the bundled `legible` preset. |
| `symph`                    | `assets/js/toys/symph.ts`                    | MilkDrop preset alias; launches the shared runtime with the bundled `symph` preset. |
| `cube-wave`                | `assets/js/toys/cube-wave.ts`                | MilkDrop preset alias; launches the shared runtime with the bundled `cube-wave` preset. |
| `bubble-harmonics`         | `assets/js/toys/bubble-harmonics.ts`         | MilkDrop preset alias; launches the shared runtime with the bundled `bubble-harmonics` preset. |
| `pocket-pulse`             | `assets/js/toys/pocket-pulse.ts`             | MilkDrop preset alias; launches the shared runtime with the bundled `pocket-pulse` preset. |
| `mobile-ripples`           | `assets/js/toys/mobile-ripples.ts`           | MilkDrop preset alias; launches the shared runtime with the bundled `mobile-ripples` preset. |
| `juke-grid`                | `assets/js/toys/juke-grid.ts`                | MilkDrop preset alias; launches the shared runtime with the bundled `juke-grid` preset. |
| `heel-toe-comets`          | `assets/js/toys/heel-toe-comets.ts`          | MilkDrop preset alias; launches the shared runtime with the bundled `heel-toe-comets` preset. |
| `battle-fan`               | `assets/js/toys/battle-fan.ts`               | MilkDrop preset alias; launches the shared runtime with the bundled `battle-fan` preset. |
| `cosmic-particles`         | `assets/js/toys/cosmic-particles.ts`         | MilkDrop preset alias; launches the shared runtime with the bundled `cosmic-particles` preset. |
| `lights`                   | `assets/js/toys/lights.ts`                   | MilkDrop preset alias; launches the shared runtime with the bundled `lights` preset. |
| `spiral-burst`             | `assets/js/toys/spiral-burst.ts`             | MilkDrop preset alias; launches the shared runtime with the bundled `spiral-burst` preset. |
| `rainbow-tunnel`           | `assets/js/toys/rainbow-tunnel.ts`           | MilkDrop preset alias; launches the shared runtime with the bundled `rainbow-tunnel` preset. |
| `star-field`               | `assets/js/toys/star-field.ts`               | MilkDrop preset alias; launches the shared runtime with the bundled `star-field` preset. |
| `fractal-kite-garden`      | `assets/js/toys/fractal-kite-garden.ts`      | MilkDrop preset alias; launches the shared runtime with the bundled `fractal-kite-garden` preset. |
| `tactile-sand-table`       | `assets/js/toys/tactile-sand-table.ts`       | MilkDrop preset alias; launches the shared runtime with the bundled `tactile-sand-table` preset. |
| `bioluminescent-tidepools` | `assets/js/toys/bioluminescent-tidepools.ts` | MilkDrop preset alias; launches the shared runtime with the bundled `bioluminescent-tidepools` preset. |
| `neon-wave`                | `assets/js/toys/neon-wave.ts`                | MilkDrop preset alias; launches the shared runtime with the bundled `neon-wave` preset. |
| `milkdrop`                 | `assets/js/toys/milkdrop-toy.ts`             | Flagship MilkDrop module; loads the full curated catalog and editor shell. |

## Generated public toy pages

Static public toy detail pages are generated into `public/toys/<slug>/index.html` for SEO and sharing, but they are not source entrypoints. The authoritative runtime entrypoint for interactive toy loading remains `toy.html?toy=<slug>`.
