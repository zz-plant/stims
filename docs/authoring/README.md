# Learn to write MilkDrop presets

A curriculum for going from "never seen a preset" to publishing your own — using Stims itself as the lab. Every example is a complete preset behind a **▶ Run** link: it opens [toil.fyi](https://toil.fyi) with the code loaded in the live editor, so the lessons need nothing installed. The exception is the measuring step in Track 3, Lesson 5, which runs from a clone of the repository.

If you want the reference instead of the course, see [the language reference](reference.md) and the pattern language in [MILKDROP_CODING_GUIDE.md](../MILKDROP_CODING_GUIDE.md).

## The path

| Track | What you learn |
|---|---|
| [0 · Play](00-play.md) | Remix an existing preset and share it — no code |
| [1 · How MilkDrop thinks](01-how-milkdrop-thinks.md) | The feedback loop, the pipeline, `decay`, `time` |
| [2 · Motion](02-motion.md) | `zoom`, `rot`, `dx/dy`, `sx/sy`, `warp` — and a line-by-line dissection of a Geiss classic |
| [3 · Listening](03-listening.md) | Audio bands, smoothing, beat detection, measured reactivity |
| [4 · Warp fields](04-warp-fields.md) | Per-pixel equations: `rad`, `ang`, tunnels, and ripples |
| [5 · Waves and shapes](05-waves-and-shapes.md) | Custom waves, custom shapes, the q-var bridge |
| [6 · Shaders](06-shaders.md) | Warp and composite shaders, the pair most catalog presets carry |
| [7 · Taste](07-taste.md) | Five masterwork dissections: reaction-diffusion, tempo tracking, hand-rolled HSL, and more |
| [8 · Shipping](08-shipping.md) | Implemented paths, compatibility limits, performance, publishing |
| [9 · Technique glossary](09-technique-glossary.md) | The named-technique vocabulary — Jelly, Relief, Painterly, Krash's beat code — counted across the shipped catalog |

All ten tracks are live. The plan that scoped them, and the follow-on work it lists, is in [PRESET_AUTHORING_DOCS_PLAN.md](../PRESET_AUTHORING_DOCS_PLAN.md).

## How the examples work

Example sources live in [examples/](examples/) as ordinary `.milk` files you can also import directly. Each **▶ Run** link encodes the full file into a `#code=` payload. Use Share or Copy link for your own experiments, and export a `.milk` file when source exceeds the URL size limit.

`bun run check:authoring-examples` compiles every example and verifies that every run link matches its source file (`--write` on the underlying script regenerates them). CI treats a broken example like a broken build.

## Conventions

- Lessons show the one or two lines that changed; the linked file is always the complete preset.
- Anything Stims-specific (rather than MilkDrop-standard) is flagged as such where it appears.
- Techniques are credited to the authors who invented them. MilkDrop's culture is remix culture; the docs follow it.
