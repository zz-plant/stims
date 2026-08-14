# Learn to write MilkDrop presets

A curriculum for going from "never seen a preset" to publishing your own — using Stims itself as the lab. Every example is a complete, working preset behind a **▶ Run** link: it opens [toil.fyi](https://toil.fyi) with the code loaded in the live editor. Nothing to install.

If you want the reference instead of the course, see [the language reference](reference.md) and the pattern language in [MILKDROP_CODING_GUIDE.md](../MILKDROP_CODING_GUIDE.md).

## The path

| Track | What you learn |
|---|---|
| [0 · Play](00-play.md) | Remix an existing preset and share it — no code |
| [1 · How MilkDrop thinks](01-how-milkdrop-thinks.md) | The feedback loop, the pipeline, `decay`, `time` |
| [2 · Motion](02-motion.md) | `zoom`, `rot`, `dx/dy`, `sx/sy`, `warp` — and a line-by-line dissection of a Geiss classic |
| [3 · Listening](03-listening.md) | Audio bands, smoothing, beat detection, measured reactivity |
| [4 · Warp fields](04-warp-fields.md) | Per-pixel equations: `rad`, `ang`, tunnels and ripples |
| [5 · Waves and shapes](05-waves-and-shapes.md) | Custom waves, custom shapes, the q-var bridge |
| [6 · Shaders](06-shaders.md) | Warp and composite GLSL — the pair 64% of the catalog uses |
| [7 · Taste](07-taste.md) | Five masterwork dissections: reaction-diffusion, tempo tracking, hand-rolled HSL, and more |
| [8 · Shipping](08-shipping.md) | The first cross-engine compatibility matrix, performance, publishing |
| [9 · Technique glossary](09-technique-glossary.md) | The named-technique vocabulary — Jelly, Relief, Painterly, Krash's beat code — counted across the shipped catalog |

All nine tracks are live. The plan that scoped them, plus ideas for what comes next (a technique cookbook, an in-editor reactivity meter, archive rescue), is in [PRESET_AUTHORING_DOCS_PLAN.md](../PRESET_AUTHORING_DOCS_PLAN.md).

## How the examples work

Example sources live in [examples/](examples/) as ordinary `.milk` files you can also import directly. Each **▶ Run** link encodes the full file into the URL (`#code=<base64>`), so the link *is* the preset — share your own experiments the same way with the editor's Export or by copying the URL after an edit.

`bun run check:authoring-examples` compiles every example and verifies every run link matches its source file (`--write` on the underlying script regenerates them). CI treats a broken example like a broken build.

## Conventions

- Lessons show the one or two lines that changed; the linked file is always the complete preset.
- Anything Stims-specific (rather than MilkDrop-standard) is flagged as such where it appears.
- Techniques are credited to the authors who invented them. MilkDrop's culture is remix culture; the docs follow it.
