# Stims vs Butterchurn vs projectM

Stims is an independent browser visualizer in the line of Ryan Geiss's MilkDrop, Butterchurn and projectM. It is not affiliated with any of them.

Butterchurn and projectM are the projects most people arrive from, and both are good at what they were built for. They occupy a different slot from Stims: they are renderers you embed or run, while Stims is the workflow around one.

## Side by side

| | Stims | Butterchurn | projectM |
| --- | --- | --- | --- |
| **Primary form** | A hosted browser app you use directly | An embeddable JS renderer | A native library and desktop/plugin player |
| **Preset input** | `.milk` source, imported as-is and exported in MilkDrop 2's own format | Presets converted to a Butterchurn JSON format ahead of time | `.milk` source |
| **Authoring** | In-session editor with completions, compiler diagnostics, and live `zoom`/`warp`/`rot`/`decay` controls | No built-in editor; authoring happens elsewhere | No built-in editor; authoring happens elsewhere |
| **Discovery** | Search, filters, collections, previews, favorites, queues, history, deep links | Preset list supplied by the embedding app | Playlist files |
| **Fidelity claims** | Per-preset labels that separate "compiles and runs" from "diffed against a projectM reference" | Broad practical compatibility, established over years of use | The reference implementation Stims diffs against |

## What Stims adds

Butterchurn ran MilkDrop presets in a browser first, and MilkDrop 2 already let you edit a preset while it played; the Stims editor brings that back. Three things underneath are new:

- **The warp runs on the GPU.** On WebGPU, a preset's per-pixel equations run for every point of the warp mesh at once, in all but 8 of the 1,102 catalog presets that have them. Butterchurn and projectM work through the points one at a time on the CPU.
- **Fidelity is measured.** Frames are compared with native projectM, and each preset's result is published, failures included.
- **The equations are read, not only run.** Without playing a preset, Stims can say which parts of the music reach which parts of the picture.

## Which should you use?

- **You want to embed a visualizer in your own web app:** Butterchurn is built for exactly that.
- **You want a native visualizer inside a desktop player or your own C++ application:** projectM is the reference implementation and the right choice.
- **You want to open a page, watch presets, and edit them:** that is what Stims is for.
- **You want to write presets and see the result immediately:** the Stims editor gives live feedback with no build step.

## FAQ

### Is Stims a Butterchurn alternative?

For watching and editing presets in a browser, yes. If you need an embeddable renderer inside your own site, Butterchurn is the purpose-built option, and Stims does not replace it for that.

### Does Stims use projectM?

Stims is its own browser implementation. It uses projectM as the reference it compares against, and labels presets by how closely they match it.

### Can I use the same presets in all three?

`.milk` presets are the common format. projectM reads them directly, Stims imports them as-is and exports them in the format MilkDrop 2 saves, and Butterchurn expects them converted to its JSON format first.
