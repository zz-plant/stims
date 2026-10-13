# Changelog

## 0.1.1

Documentation only; no code changes.

- docs: README reflects the published package. It leads with the install command, moves the clone-and-build steps under Development, links the corpus browser, and uses absolute links that resolve on npm and on the mirror.
- docs: the corpus came from Stims' `spec/eel-conformance/`, not from `milkdrop-toolchain`, and Stims runs it against three CPU tiers, not against the toolchain's WGSL generator.

## 0.1.0

First release as a package, extracted from `spec/eel-conformance/` in
[zz-plant/stims](https://github.com/zz-plant/stims).

- 82 cases in 9 sections, 3 of them provisional, unchanged from the Stims
  corpus.
- `schema.json`, unchanged.
- TypeScript loader (`loadEelConformanceCases`, `loadEelCaseGroups`,
  `pinnedCases`, `provisionalCases`) and the specification constants.
- New: `runConformance(runner)` harness that seeds, executes and compares per
  the runner contract, with `formatReport` and `conforms`.
- New: `eel-conformance` CLI (`sections`, `cases`, `show`, `validate`, `where`).
