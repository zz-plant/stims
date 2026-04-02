# projectM Cream of the Crop picks

This folder vendors a small, user-facing subset of presets from the
`projectM-visualizer/presets-cream-of-the-crop` GitHub repository so they can
ship directly in Stims without exposing the entire upstream pack.

- Source repository: `https://github.com/projectM-visualizer/presets-cream-of-the-crop`
- Source commit: `0180df21f5e0bd39b9060cc5de420ed2f1f9e509`
- Retrieved for Stims: `2026-04-01`
- Selection basis: presets that compile as `supported` on both WebGL and WebGPU
  in Stims and read as user-facing showcase picks rather than regression-only
  fixtures
- Upstream pack note: the upstream repository describes this as the default
  preset pack in modern projectM releases

License note from the upstream repository:

> Milkdrop presets were, in almost all cases, not released under any specific
> license. Theoretically, each preset author holds the full copyright on any
> released presets.

> Since the presets were freely released and have been used in so many packages
> and applications in the past two decades, it is safe to assume them to be in
> the public domain.

If the upstream repository changes or a preset needs to be replaced, update
`catalog.json` and keep the copied `.milk` files aligned with the selected
subset.
