# Changelog

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
