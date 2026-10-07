# Changelog

## 0.1.0

First release, extracted from zz-plant/stims `src/js/milkdrop/`.

- `.milk` parsing: lossless line syntax tree, field parser with diagnostics.
- Compiler: fields to `MilkdropPresetIR`, default state, compile cache, per-backend compatibility and parity classification.
- EEL2: parser, tree-walking interpreter, JavaScript JIT with interpreter fallback, shared function and operator table, WGSL compute-shader generator and signal layout.
- Shader text: HLSL statement parser, control extraction and evaluation, HLSL to GLSL translation, optional branch desugaring, sampler and texture tables, per-backend execution mode.
- Formatting and export: editor-dialect formatter, field read/upsert helpers, MilkDrop 2 exporter, remix lineage fields.
- Analysis: audio dataflow and preset math summaries.
- 24 unit test files (510 tests) carried over from Stims.
