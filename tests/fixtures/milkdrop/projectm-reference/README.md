# projectM visual reference fixtures

This directory stores checked-in reference renders captured from `projectM` for certified visual-parity checks.

The source of truth for this fixture set is:

- [`assets/data/milkdrop-parity/visual-reference-manifest.json`](../../../assets/data/milkdrop-parity/visual-reference-manifest.json)

Each promoted preset should include:

- a reference image,
- an optional metadata sidecar,
- a manifest entry with:
  - preset id,
  - title,
  - strata,
  - tolerance profile,
  - capture resolution,
  - provenance for the imported artifact.

Promotion flow:

1. Import a `projectM` artifact into a local parity output directory with `scripts/import-projectm-reference.ts`.
2. Promote that imported artifact into this checked-in fixture directory with `scripts/promote-projectm-reference.ts`.
3. Commit both the copied reference files and the updated visual-reference manifest in the same change.
