# Changelog

## 0.2.0 (2026-10-28)

0.1.1 was prepared as a documentation release but never published; its
README changes ship here, with the code below, none of which was in 0.1.0.
Minor bump: a new compiler error, a new IR field, a new option on the WGSL
generator and changed WGSL output. Symbols named with a path are reachable
through the `milkdrop-toolchain/src/*` subpath, not the root export.

Compiler and IR
- A provable 2-component write to `ret` in a warp or composite shader is the
  error `preset_shader_ret_vec2`, placed on its source line, with the
  `texture2D(sampler_main, …)` read offered as the fix. `ret` is the colour
  the pixel carries into the next frame; `ret = uv` compiled to `vec3(uv)`,
  which WebGL refuses and WebGPU painted as a red-green gradient. Presets
  that do this now carry an error diagnostic they did not before.
- `MilkdropPresetIR.shaderText.stageControls` (optional): the text-derived
  stand-in controls (zoom, offsets, colour scale, texture overlay) computed
  from each stage's text alone, so a host that runs one stage's program as
  written applies only the other stage's stand-in. The merged `controls` and
  `controlExpressions` are unchanged. A scalar a shader body declares under
  a control's name (`float r = 2;`) stays a local in the direct program
  instead of reading the control.
- A program whose `ret` is built from an aux-texture sample no longer sets
  `requiresControlFallback`, and `sampler_fc_main` counts as the main
  texture rather than an aux sample. Such programs draw the sample
  themselves; the overlay used to replace their output.
- `progress` is the preset's position in its display slot, 0 when it starts
  and 1 when the next preset is due, as in MilkDrop 2 and projectM; it was
  documented as the frame count. Shader bodies read it from a
  `signalProgress` uniform instead of an alias of `signalFrame`, and a
  per-pixel or per-point program the GPU field path cannot feed stays on
  the CPU instead of lowering `progress` to a zero temporary.
  `MILKDROP2_SIGNAL_NAMES` (`src/builtin-docs.ts`) lists the signals
  MilkDrop 2 reloads into every custom wave and shape each frame.
- `med`, `att` and `med_att` are Stims shorthand for `mid`, `treb` and
  `mid_att`; MilkDrop has no such signals. A preset that assigns one of them
  now owns it as an ordinary variable starting at 0. `presetOwnedSignalAliases`
  (`src/program-references.ts`) finds those names, `compileProgramToWgsl`
  takes them as `ownedSignalAliases` and compiles them as state fields, and
  `MILKDROP_LEGACY_SIGNAL_ALIASES` (`src/wgsl-signal-layout.ts`) is the
  alias table. `writesLegacyMotionVectorControls`
  (`src/compiler/program-assembly.ts`) reports scripted `mv_dx`, `mv_dy` or
  `mv_l` writes, the check the compiler already applied.
- The harmonic and percussive separation signals (`harmonic`, `percussive`,
  `percussive_low`, `percussive_mid`, `percussive_high`, `percussive_ratio`
  and their unscored spellings) count as known signal names.
- The compile cache keys a preset without an `id` by its `title`, so two
  untitled sources with the same text still share an entry and two titled
  ones do not.

WGSL
- `rand(x)` on the compute VM returns `rand() * max(0, x)`; it returned the
  unit draw whatever the argument. On the per-vertex field path
  `milkdropRand(scale, time)` scales the same way, and `randint(x)` lowers
  to the new `milkdropRandInt` instead of staying unimplemented.

HLSL to GLSL (WebGL)
- Raw bodies get a WebGL finishing pass, `finishRawGlslForWebGl`
  (`src/compiler/shader-analysis.ts`): `saturate`, `frac`, `lerp` and
  `atan2` are rewritten, `dot` goes through mixed-width `milkdropDot`
  overloads that truncate as HLSL does, and plain and compound assignments
  are wrapped in the target's declared type, which is HLSL's scalar
  broadcast and vector truncation. The WebGPU statement parser still reads
  the unrewritten body.
- Declarations above `shader_body` carry over: comma lists
  (`float3 color, mus;`) and `static` / `static const` globals, minus names
  the body declares again. Split declarations (`float3 dx, dy;` then
  `dx = …`) keep their locals and widths instead of losing one to a motion
  control; `float2 fraction;` keeps its width. `hue_shader`,
  `hue_secondary` and `hue_tertiary` are float3s; swizzles of declared
  float locals splat; a spaced call (`mbox (uv2)`) is no longer hoisted as
  a variable.
- Warp-stage `r`, `g`, `b` and `hue_shader` lower to the `colorScale` and
  `tint` uniforms, which only the composite template declared.
- Preamble: `milkdropScalar(bool)`, `milkdropScalar(int)`, `lum(vec2)`.
- On the offline corpus scan, failing WebGL stages fell from 162 to 82 (64
  to 28 distinct bodies) with no new failures.

Robustness and performance
- Deeply nested expressions no longer exhaust the call stack. The EEL
  parser stops at depth 100 with the diagnostic `expr_max_depth_exceeded`
  and yields a 0 literal for the rest; constant folding, GPU field
  planning, GLSL and WGSL emission, the JIT and the shader AST bound
  recursion at 200, and statement flattening, AST walks and identifier
  collection run iteratively. Binary-operator parsing is one loop shared by
  the EEL and shader parsers.
- JIT identifier-read lowering is memoized; the formatter, dataflow and
  math analyzers and the GLSL analysis allocate less on their hot paths.
  `readMilkdropFields` (`src/formatter.ts`) reads several fields in one
  pass over the source.
- docs: README reflects the published package. It leads with the install command, moves the clone-and-build steps under Development, links the compile playground, and uses absolute links that resolve on npm and on the mirror.
- docs: Butterchurn reads exported presets only after conversion to its JSON format, and the `eel-conformance` corpus runs in Stims against the CPU tiers, not against this package's WGSL generator.

## 0.1.0

First release, extracted from zz-plant/stims `src/js/milkdrop/`.
- `.milk` parsing: lossless line syntax tree, field parser with diagnostics.
- Compiler: fields to `MilkdropPresetIR`, default state, compile cache, per-backend compatibility and parity classification.
- EEL2: parser, tree-walking interpreter, JavaScript JIT with interpreter fallback, shared function and operator table, WGSL compute-shader generator and signal layout.
- Shader text: HLSL statement parser, control extraction and evaluation, HLSL to GLSL translation, optional branch desugaring, sampler and texture tables, per-backend execution mode.
- Formatting and export: editor-dialect formatter, field read/upsert helpers, MilkDrop 2 exporter, remix lineage fields.
- Analysis: audio dataflow and preset math summaries.
- 24 unit test files (510 tests) carried over from Stims.
