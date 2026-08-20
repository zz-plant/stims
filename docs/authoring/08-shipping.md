# Track 8 — Shipping

You can now write a preset from nothing. This track covers what happens after: knowing where it will and won't run correctly, keeping it fast, and publishing it.

## Compatibility matrix

MilkDrop presets travel between five active engines — the original Winamp MilkDrop 2, projectM, Butterchurn, and Stims on both its WebGL and WebGPU backends — and until now, no single place documented where a given feature actually works across all of them. This is that matrix, built directly from the Stims compiler's own compatibility/parity code and shader-support inventory.

**Read the labels carefully.** Cells for Stims are sourced from code (`compatibility.ts`, `parity.ts`, `shader-execution-classification.ts`, the [shader support inventory](../architecture/shader-support-inventory.md)) and are exact. Cells for Winamp MilkDrop 2, projectM, and Butterchurn are marked **[inferred]** — reasoned from the format spec and public documentation, not verified by running those engines. Treat an inferred cell as "should work, unconfirmed," not as tested fact.

### Registers, buffers, control flow

| Feature | Winamp MD2 | projectM | Butterchurn | Stims WebGL | Stims WebGPU |
|---|---|---|---|---|---|
| `q1`–`q32`, `t1`–`t32` | Full [inferred] | Full [inferred] | Full [inferred] | Full | Full |
| `megabuf(i)` / `gmegabuf(i)` | Full [inferred] | Full [inferred] | Full [inferred] | Full in EEL; **partial** when referenced directly inside shader text | Same partial caveat |
| `loop()` / `while()` | Full [inferred] | Full [inferred] | Full [inferred] | Full — bounded to ~2M iterations per block as a hang guard | Full |

### Shaders

| Feature | Winamp MD2 | projectM | Butterchurn | Stims WebGL | Stims WebGPU |
|---|---|---|---|---|---|
| `warp_shader`/`comp_shader` as **separate GPU passes** | Full [inferred] | Full [inferred] | Full [inferred] | **Diverges: single-pass fusion.** `sampler_pw_main`/`sampler_pc_main` both resolve to the same `previousTex`, an approximation of the original two-pass output | Same fusion |
| Direct shader-text execution (scalar controls, sample-blend patterns) | Full [inferred] | Full [inferred] | Full [inferred] | Full for the enumerated pattern set (see [Track 6](06-shaders.md)) | Full via WGSL/TSL emission |
| `^`, `|`, `&` operators | Full [inferred] | Full [inferred] | Unverified | Full — lowered to `pow()`/int-cast bitwise ops | Full — equivalent WGSL lowering |
| `&&`/`||`/`!` precision | Reference semantics [inferred] | Matches reference [inferred] | Unverified | **Minor divergence** — clamps per-operation, not just at final output (e.g. `0.7 \|\| 0.7` → `1.4` on reference vs `0.91` here) | Different formula, same class of divergence |

### Shader-language dialect

| Feature | Stims WebGL / WebGPU |
|---|---|
| Source language | **GLSL 1.20**, not HLSL — see [Track 6, Lesson 0](06-shaders.md#lesson-0--a-language-note-stated-plainly) |
| `texture2D()` with explicit LOD | Unsupported |
| Matrix uniforms (`mat2`/`mat3`/`mat4`) | Unsupported |
| `gl_FragCoord` | Unsupported |

### Textures

| Feature | Winamp MD2 | Stims (both backends) |
|---|---|---|
| External/custom textures (`textures.ini`, arbitrary PNGs) | Full [inferred] | **Unsupported by design** — every texture is pre-authored and shipped with the app |
| Standard samplers (`main`, `noise`, `perlin`, `voronoi`, `pattern`, …) | Full [inferred] | Full — 16 total |
| Non-standard/legacy sampler names (~7.5% of the bundled catalog) | Full, resolve to real distinct textures [inferred] | **Aliased to the nearest of the 16 standard samplers** — visually similar, not identical (e.g. `seaweed`/`lichen`/`moss1` → `organic`) |
| 3D noise volume sampling | Full, native volume textures [inferred] | WebGL: 2D-atlas approximation. **WebGPU: native `Data3DTexture`** — the one row where WebGPU is measurably more faithful than WebGL, not less |

### MilkDrop3 extensions

MilkDrop3 (a separate, actively developed fork) extends the format with `.milk2` double presets, `q33`–`q64`, and shader-side FFT data. **None of this is supported anywhere in Stims** — confirmed by source search, not just omission. If you're targeting MilkDrop3 specifically, this curriculum and the Stims engine are not the right tool; everything here targets the MilkDrop2-era format MilkDrop3 itself still ships alongside its extensions.

### The five things worth remembering

1. **Single-pass fusion** is Stims's biggest structural divergence — anything depending on a genuinely separate warp-pass buffer gets an approximation.
2. **GLSL 1.20, not HLSL** — stated plainly, not glossed over, in [Track 6](06-shaders.md#lesson-0--a-language-note-stated-plainly).
3. **No external textures, period.**
4. **Sampler aliasing** covers roughly 1 in 13 bundled presets — check the [coding guide's alias table](../MILKDROP_CODING_GUIDE.md#engine-limitations) if a preset references an unfamiliar sampler name.
5. **"Supported" here means compiles and renders through Stims's own pipeline — not "measured pixel-identical to a native MilkDrop render."** Stims's own compatibility system deliberately keeps those two claims separate; so should you when describing your own preset's portability.

## Performance and quality

- **Frame-rate correction is not optional.** Any accumulator advanced by a fixed amount per frame (`mtime`, custom clocks) needs an `fps`-relative term — `x*(75/fps)` for anything calibrated against 75fps, or derive your own factor as Track 3's RC filter does (`1/fps*k`). Skip it and the same preset runs at different speeds on different machines.
2. **Neighbor sampling in a shader costs more than a single sample.** Track 6's edge-detection example reads five texture samples per pixel (four neighbors plus itself); that's a real, measurable cost multiplier over a one-sample shader, paid by every pixel on screen every frame. Reach for it when the effect needs it — not by default.
3. **Fewer `per_pixel` lines beats more.** Every line runs once per mesh point; a preset with a dozen `per_pixel` equations is doing that work at every vertex, every frame. The [coding guide's checklist](../MILKDROP_CODING_GUIDE.md#professional-vs-amateur-checklist) treats "at least 3 meaningful per_pixel lines" as a floor for depth, not a target to maximize.
4. **`warp=1` with high `decay`** is the single most common performance-adjacent mistake — not because it's slow, but because it saturates into a smear that makes every other effect illegible. [Track 2](02-motion.md#lesson-5--warp--the-wobble) covers why.
5. **Measure instead of guessing.** [Track 3, Lesson 5](03-listening.md#lesson-5--measuring-it) covers `bun run lab:reactivity`. Its sibling `bun run lab:visual` (catalog presets only, currently) adds pixel-level checks — luminance, contrast, colorfulness, and whether the render is blank or static — the same instrument the Stims project uses on its own bundled catalog.

## Publishing

1. Export your preset (or copy its `#code=` URL — see [Track 0](00-play.md#6--share-it)).
2. Run it through `bun run lab:reactivity -- --file your.milk` and aim for a `reactive` verdict on the variables meant to respond to audio.
3. Open a PR adding the `.milk` file to `public/milkdrop-presets/`, or share the link directly — both paths are covered in the [contributing guide](../../CONTRIBUTING.md#contributing-presets).
4. If you remixed someone else's work anywhere along the way, keep the credit chain — the editor's Remix button does this automatically, and the multi-author filename convention (`"Author A + Author B — Title"`) is how the whole community has tracked lineage for over twenty years. It's not paperwork; it's the reason this hobby has a history at all.

## What you can now do

Write a preset from the mental model up, wire it to the music, give it depth and shape, reach for a shader when equations aren't enough, know honestly where it will and won't run the same elsewhere, and ship it back into the same catalog you started by browsing in Track 0.

If you want to go further — the essays on palette, pacing, and restraint that turn a technically correct preset into a good one — that's [Track 7 — Taste](07-taste.md).
