# Learn to write MilkDrop presets

A curriculum for going from "never seen a preset" to publishing your own — using Stims itself as the lab. Every example is a complete, working preset behind a **▶ Run** link: it opens [toil.fyi](https://toil.fyi) with the code loaded in the live editor. Nothing to install.

If you want the reference instead of the course, see [the language reference](reference.md) and the pattern language in [MILKDROP_CODING_GUIDE.md](../MILKDROP_CODING_GUIDE.md).

## The path

| Track | Status | What you learn |
|---|---|---|
| 0 · Play | planned | Remix an existing preset and share it — no code |
| [1 · How MilkDrop thinks](01-how-milkdrop-thinks.md) | **available** | The feedback loop, the pipeline, `decay`, `time` |
| [2 · Motion](02-motion.md) | **available** | `zoom`, `rot`, `dx/dy`, `sx/sy`, `warp` — and a line-by-line dissection of a Geiss classic |
| 3 · Listening | planned | Audio bands, smoothing, beats, measured reactivity |
| 4 · Warp fields | planned | Per-pixel equations: `rad`, `ang`, tunnels and ripples |
| 5 · Waves and shapes | planned | Custom waves, custom shapes, q-vars |
| 6 · Shaders | planned | Warp and composite GLSL |
| 7 · Taste | planned | Palette, pacing, restraint — dissections of masterworks |
| 8 · Shipping | planned | Compatibility across engines, performance, publishing |

The full roadmap for the remaining tracks is in [PRESET_AUTHORING_DOCS_PLAN.md](../PRESET_AUTHORING_DOCS_PLAN.md).

## How the examples work

Example sources live in [examples/](examples/) as ordinary `.milk` files you can also import directly. Each **▶ Run** link encodes the full file into the URL (`#code=<base64>`), so the link *is* the preset — share your own experiments the same way with the editor's Export or by copying the URL after an edit.

`bun run check:authoring-examples` compiles every example and verifies every run link matches its source file (`--write` on the underlying script regenerates them). CI treats a broken example like a broken build.

## Conventions

- Lessons show the one or two lines that changed; the linked file is always the complete preset.
- Anything Stims-specific (rather than MilkDrop-standard) is flagged as such where it appears.
- Techniques are credited to the authors who invented them. MilkDrop's culture is remix culture; the docs follow it.
