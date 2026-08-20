# projectM Cream of the Crop picks

This folder vendors a larger, user-facing subset of presets from the
`projectM-visualizer/presets-cream-of-the-crop` GitHub repository so they can
ship directly in Stims without exposing the entire upstream pack.

Curator: **Jason Fletcher / ISOSCELES**, who reduced roughly 52,000 presets to
9,795 across 11 categories and 183 subcategories, with preview images. It became
the default projectM preset pack in 2022 — which makes it the point at which one
curator's taste became the default visual experience for most users of the
format. Credit the curation as curation, distinctly from the preset authors; see
[`docs/LINEAGE_AND_CREDITS.md`](../../../../docs/LINEAGE_AND_CREDITS.md).

- Source repository: `https://github.com/projectM-visualizer/presets-cream-of-the-crop`
- Source commit: `0180df21f5e0bd39b9060cc5de420ed2f1f9e509`
- Retrieved for Stims: `2026-04-11`
- Selection basis: user-facing showcase picks from the upstream pack, screened
  against Stims' compiler and backend support before promotion so broken or
  truncated upstream files can be replaced with cleaner exact-support imports;
  the current 40-preset vendored subset expands that mix across liquid,
  geometry, orbit, waveform, supernova, feedback, and close-up reaction
  families while keeping the library curated instead of mirroring the full
  upstream pack
- Upstream pack note: the upstream repository describes this as the default
  preset pack in modern projectM releases

License note from the upstream repository:

> Milkdrop presets were, in almost all cases, not released under any specific
> license. Theoretically, each preset author holds the full copyright on any
> released presets.

> Since the presets were freely released and have been used in so many packages
> and applications in the past two decades, it is safe to assume them to be in
> the public domain.

Counting note: quote the number of files vendored here, not a pack size. The
52k/73k/97k figures in circulation for MilkDrop corpora are **file** counts — a
checksum pass over the 52k corpus yields roughly 44k unique presets, with many
near-duplicates beyond that. If you dedupe a pack before importing, normalize
`fRating=` across the files first, or rating differences will defeat checksum
matching.

If the upstream repository changes or a preset needs to be replaced, update
`catalog.json` and keep the copied `.milk` files aligned with the selected
subset. The showcase now reads this library directly, so every added preset
should still be comfortable as a user-facing browse option, not just a
compatibility fixture.
