# Track 8 — Shipping

## Compatibility matrix

A preset can compile, run, and still differ visibly across players. The table below describes implemented Stims paths and their limits. It is not a native Winamp, projectM, or Butterchurn test matrix. Verify your source in each intended player before claiming cross-engine compatibility.

| Feature | Implemented path | Limits to check |
| --- | --- | --- |
| EEL equations, registers, and buffers | Toolchain interpreter and JIT; eligible per-pixel and wave-point programs also lower to WGSL | GPU lowering has a support gate; stateful or unsupported programs can stay on the CPU |
| `loop()` / `while()` | Bounded execution in the toolchain | The iteration guard prevents an unbounded block from hanging the app |
| HLSL-style and GLSL-style shader source | Supported syntax is parsed and normalized; WebGL emits GLSL and WebGPU uses supported direct statements | This is a subset, not a general HLSL/GLSL compiler; inspect shader diagnostics |
| Matrix locals | Supported matrix declarations, operations, and literal-index writes | Runtime-index writes can leave the direct WebGPU path; local matrices are not arbitrary injected uniforms |
| LOD, bias, and gradient sampling | Selected HLSL sampling calls have backend implementations | Support varies by sampler and backend; check the actual compiled shader |
| Warp and composite stages | Separate runtime targets and stage-specific sampler bindings | Blend, coordinate, and rasterization differences still require measured comparison |
| Built-in and custom sampler names | Frame buffers, blur, noise, and bundled texture resolution | Unknown or legacy aliases can use approximations; the Textures pane shows resolved bindings |
| Arbitrary external texture files | No general URL/file loader from preset source | Custom names resolve within the bundled texture set; the pane previews those files |
| 3D volume sampling | WebGL uses an atlas path; WebGPU uses native 3D textures on supported samplers | Different sampling paths do not establish which output matches a native reference |

Use **Compat**, **Shader**, and **Textures** in the studio to inspect the loaded preset. The implementation owners are `packages/milkdrop-toolchain/src/compiler/`, `src/js/milkdrop/feedback-manager-shared.ts`, and the WebGPU feedback modules. The [coding guide](../MILKDROP_CODING_GUIDE.md#engine-limitations) explains sampler and dialect limits.

MilkDrop3 extensions such as `.milk2` double presets and `q33`–`q64` are outside this course's MilkDrop2-era target. Do not infer support for them from the ability to import a `.milk` file.

For a fidelity claim, capture a native reference with controlled inputs, compare rendered output, and retain provenance. Certification target membership or a green compile is not a measured pass. See the [parity plan](../MILKDROP_PROJECTM_PARITY_PLAN.md).

## Performance and quality

1. **Frame-rate correction is not optional.** Any accumulator advanced by a fixed amount per frame (`mtime`, custom clocks) needs an `fps`-relative term — `x*(75/fps)` for anything calibrated against 75fps, or derive your own factor as Track 3's RC filter does (`k/fps`). Skip it and the same preset runs at different speeds on different machines.
2. **Neighbor sampling in a shader costs more than a single sample.** Track 6's edge-detection example reads six texture samples per pixel (four neighbors, the pixel itself, and one blurred copy); that's a real, measurable cost multiplier over a one-sample shader, paid by every pixel on screen every frame. Reach for it when the effect needs it — not by default.
3. **Fewer `per_pixel` lines beat more.** Every line runs once per mesh point; a preset with a dozen `per_pixel` equations is doing that work at every vertex, every frame. The [coding guide's checklist](../MILKDROP_CODING_GUIDE.md#professional-vs-amateur-checklist) treats "at least 3 meaningful per_pixel lines" as a floor for depth, not a target to maximize.
4. **`warp=1` with high `decay`** is the single most common performance-adjacent mistake — not because it's slow, but because it saturates into a smear that makes every other effect illegible. [Track 2](02-motion.md#lesson-5--warp--the-wobble) covers why.
5. **Measure instead of guessing.** [Track 3, Lesson 5](03-listening.md#lesson-5--measuring-it) covers `bun run lab:reactivity`, which runs from a local clone of the repository. Its sibling `bun run lab:visual` (catalog presets only, currently) adds pixel-level checks (luminance, contrast, colorfulness, and whether the render is blank or static) — the same instrument the Stims project uses on its own bundled catalog.

## Publishing

1. Export your preset (or use Share to create its `#code=` URL — see [Track 0](00-play.md#6--share-it)).
2. From a local clone ([setup](../../CONTRIBUTING.md#quick-start)), run it through `bun run lab:reactivity -- --file your.milk` and aim for a `reactive` verdict on the variables meant to respond to audio.
3. Open a PR adding the `.milk` file to `public/milkdrop-presets/`, or share the link directly — both paths are covered in the [contributing guide](../../CONTRIBUTING.md#contributing-presets). A link can go in the [remix thread](https://github.com/zz-plant/stims/discussions/1341) on GitHub Discussions.
4. If you remixed someone else's work anywhere along the way, keep the credit chain — **Remix** in the editor's **⋯** menu does this automatically, and the multi-author filename convention (`"Author A + Author B — Title"`) is how the whole community has tracked lineage for over twenty years. It's not paperwork; it's the reason this hobby has a history at all.

## What you can now do

Write a preset from the mental model up, wire it to the music, give it depth and shape, reach for a shader when equations aren't enough, know honestly where it will and won't run the same elsewhere, and ship it back into the same catalog you started by browsing in Track 0.

If you want to go further, the essays on palette, pacing, and restraint that turn a technically correct preset into a good one are in [Track 7 — Taste](07-taste.md).
