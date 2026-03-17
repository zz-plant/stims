# Toy notes and presets

Stims now leads with **MilkDrop Visualizer** as the flagship browser-native visualizer in the lineage of Ryan Geiss's MilkDrop, and the rest of the toy catalog now launches through the same runtime as curated preset aliases.

## Shared preset-alias model

- Every non-`milkdrop` toy slug now starts the shared MilkDrop runtime with a bundled preset stored at `public/milkdrop-presets/<slug>.milk`.
- The shared preset browser, blend controls, autoplay/random flow, source editor, and import/export tools are available from every toy alias.
- The quickstart "starter preset" action on the audio panel now requests the toy slug's curated MilkDrop preset instead of trying to apply a quality preset.
- Active toy loading now lives entirely in module entrypoints under `assets/js/toys/`.

## Bundled preset packs

- The flagship curated presets still live in `public/milkdrop-presets/` and remain available from the main `milkdrop` entry.
- The alias pack adds one bundled preset per non-MilkDrop toy slug so pages like `toy.html?toy=aurora-painter` or `toy.html?toy=tactile-sand-table` open directly into that look.
- Catalog metadata for both the flagship presets and alias pack lives in `public/milkdrop-presets/catalog.json`.

## MilkDrop Visualizer

- **Summary:** Preset-driven feedback visualizer with blend transitions, live source editing, and import/export support.
- **Controls:**
  - _Preset browser_ includes bundled presets, favorites, and recent-first ordering.
  - _Blend duration_ controls transition timing between preset swaps.
  - _Autoplay/random_ cycles through compatible presets while skipping blocked combinations.
  - _Source editor_ allows live preset edits with diagnostics and rollback to last-good compile.
  - _Import/export_ supports round-tripping preset files.
- **Workflow:** start from a bundled preset, tune values in the editor, then export when the look is stable.
