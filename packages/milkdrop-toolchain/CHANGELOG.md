# Changelog

## 0.1.1

Documentation only; no code changes.

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
