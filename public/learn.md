---
title: "Learn to Write MilkDrop Presets — Free Course"
description: "A free course in writing MilkDrop presets, from remixing with sliders to shaders. Every example runs live in your browser with nothing to install."
url: https://toil.fyi/learn/
source: https://github.com/zz-plant/stims/blob/main/docs/authoring/README.md
license: https://github.com/zz-plant/stims/blob/main/LICENSE
---

# Learn to write MilkDrop presets

A curriculum for going from "never seen a preset" to publishing your own — using Stims itself as the lab. Every example is a complete preset behind a **▶ Run** link: it opens [toil.fyi](https://toil.fyi) with the code loaded in the live editor, so the lessons need nothing installed. The exception is the measuring step in Track 3, Lesson 5, which runs from a clone of the repository.

If you want the reference instead of the course, see [the language reference](/learn/reference/) and the pattern language in [MILKDROP_CODING_GUIDE.md](https://github.com/zz-plant/stims/blob/main/docs/MILKDROP_CODING_GUIDE.md).

## The path

| Track                                                | What you learn                                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [0 · Play](/learn/play/)                               | Remix an existing preset and share it — no code                                                                   |
| [1 · How MilkDrop thinks](/learn/how-milkdrop-thinks/) | The feedback loop, the pipeline, `decay`, `time`                                                                  |
| [2 · Motion](/learn/motion/)                           | `zoom`, `rot`, `dx/dy`, `sx/sy`, `warp` — and a line-by-line dissection of a Geiss classic                        |
| [3 · Listening](/learn/listening/)                     | Audio bands, smoothing, beat detection, measured reactivity                                                       |
| [4 · Warp fields](/learn/warp-fields/)                 | Per-pixel equations: `rad`, `ang`, tunnels, and ripples                                                           |
| [5 · Waves and shapes](/learn/waves-and-shapes/)       | Custom waves, custom shapes, the q-var bridge                                                                     |
| [6 · Shaders](/learn/shaders/)                         | Warp and composite shaders, the pair most catalog presets carry                                                   |
| [7 · Taste](/learn/taste/)                             | Five masterwork dissections: reaction-diffusion, tempo tracking, hand-rolled HSL, and more                        |
| [8 · Shipping](/learn/shipping/)                       | Implemented paths, compatibility limits, performance, publishing                                                  |
| [9 · Technique glossary](/learn/technique-glossary/)   | The named-technique vocabulary — Jelly, Relief, Painterly, Krash's beat code — counted across the shipped catalog |

All ten tracks are live. Follow-on work is in the roadmap's [Learn by editing](https://github.com/zz-plant/stims/blob/main/docs/ROADMAP.md#learn-by-editing) section; the plan that scoped the tracks is [archived](https://github.com/zz-plant/stims/blob/main/docs/archive/PRESET_AUTHORING_DOCS_PLAN.md).

## How the examples work

Example sources live in [examples/](https://github.com/zz-plant/stims/tree/main/docs/authoring/examples) as ordinary `.milk` files you can also import directly. Each **▶ Run** link encodes the full file into a `#code=` payload. Use Share or Copy link for your own experiments, and export a `.milk` file when source exceeds the URL size limit.

`bun run check:authoring-examples` compiles every example and verifies that every run link matches its source file (`--write` on the underlying script regenerates them). CI treats a broken example like a broken build.

## Conventions

- Lessons show the one or two lines that changed; the linked file is always the complete preset.
- Anything Stims-specific (rather than MilkDrop-standard) is flagged as such where it appears.
- Techniques are credited to the authors who invented them. MilkDrop's culture is remix culture; the docs follow it.
