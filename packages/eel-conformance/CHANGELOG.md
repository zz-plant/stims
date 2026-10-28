# Changelog

## Unreleased

The three provisional cases are resolved against the ns-eel2 source that MilkDrop 2 ships (`WACUP/vis_milk2`, `ns-eel2/`) and against modern EEL2 (`justinfrankel/WDL`); `docs/ns-eel2-source-audit.md` holds the citations. Every case is now `pinned` and the README's "Open questions" section is empty. Ids are unchanged; two expected values are not, so an implementation that passed 0.1.x may fail two cases:
- `control-flow/while-condition-is-exact-zero`: a `while()` condition uses the close factor like every other boolean context (`nseel_asm_repeatwhile` compares `|cond|` against `g_closefact`). `n = 1e-6; while(n, n = 0; x = 1)` leaves `x` at 0 and `n` at 1e-6. Previously pinned the exact-zero reading (`x = 1`, `n = 0`).
- `operators-arithmetic/precedence-unary-minus-over-pow`: `-2 ^ 2` is `-(2^2) = -4`, the ns-eel2 reading (its preprocessor rewrites it to `-pow(2,2)`). Modern EEL2 gives +4; the note says so. Previously pinned +4. The case also asserts `(-2) ^ 2 = 4`.
- `operators-arithmetic/pow-left-associative`: promoted to `pinned` with the citations; 64 stays.
- The `control-flow` section description now says the two-argument `while(cond, body)` form is a dialect extension shared with projectM and Butterchurn, not ns-eel2 syntax.
- Tests: the corpus test asserts there is no provisional case left; the harness test exercises the provisional rule on a synthetic case.

## 0.1.1 (2026-10-28)

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
