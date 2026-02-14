# Full Refactor Plan

This plan outlines a staged, low-risk refactor of the Stim Webtoys codebase with clear checkpoints, owners, and rollback paths.

## Goals

- Improve maintainability, testability, and consistency across toys, shared runtime code, and docs.
- Reduce coupling between rendering, audio analysis, toy lifecycle, and UI controls.
- Standardize code patterns and metadata so adding new toys is safer and faster.
- Preserve current user behavior while introducing architecture improvements incrementally.

## Non-goals

- No complete rewrite in one release.
- No breaking changes to toy URLs, toy slugs, or public page contracts.
- No visual redesign during core refactor phases unless explicitly scoped.

## Success metrics

- `bun run check` remains green during each phase.
- All toy slugs continue to load and pass `bun run check:toys`.
- Reduced duplicate lifecycle/audio/render code in toy implementations.
- Faster onboarding: new toy implementation time reduced via reusable templates/utilities.

## Guiding principles

1. **Refactor in slices, not layers all at once.**
2. **Keep behavior stable first; optimize second.**
3. **Prefer extraction + consolidation over invention.**
4. **Ship behind branch milestones with frequent integration.**
5. **Update docs in the same change as architecture shifts.**

## Current pain points to address

- Repeated setup patterns across toy scripts.
- Inconsistent boundaries between toy-specific logic and shared runtime concerns.
- Harder-to-test code paths due to mixed responsibilities.
- Potential drift between implementation and toy documentation/index files.

## Workstreams

### 1) Baseline and observability

**Objective:** establish a safe baseline before structural change.

Tasks:

- Record current behavior for representative toys (visual + audio reactivity sanity checks).
- Expand test coverage for critical initialization and toy registration paths where missing.
- Capture baseline metrics (load timing, runtime errors, toy boot failures).

Exit criteria:

- Baseline test suite and smoke checks documented.
- Known behavior snapshots available for comparison during later phases.

### 2) Shared runtime boundary extraction

**Objective:** separate framework-level responsibilities from toy logic.

Tasks:

- Define and enforce a narrow toy lifecycle contract (init/update/dispose and optional hooks).
- Extract common bootstrapping concerns into shared helpers/modules.
- Centralize audio analysis interfaces and event wiring boundaries.

Exit criteria:

- New/updated shared interfaces documented.
- At least one pilot toy migrated fully to the extracted boundary.

### 3) Toy module normalization

**Objective:** make toy implementations structurally consistent.

Tasks:

- Standardize file-level organization patterns for toy scripts.
- Eliminate duplicated utility code by moving stable logic into shared modules.
- Apply migration recipe toy-by-toy with a checklist.

Exit criteria:

- Majority of active toys migrated to normalized structure.
- Duplicated boilerplate reduced and tracked.

### 4) Data and metadata consistency hardening

**Objective:** prevent drift between toy metadata, docs, and runtime entry points.

Tasks:

- Strengthen validation around toy slug/index/entry-point relationships.
- Add or tighten consistency checks and CI-friendly error messages.
- Ensure docs synchronization workflow remains explicit for toy additions/renames.

Exit criteria:

- Drift checks fail fast with actionable guidance.
- Toy add/rename workflow is reproducible from docs alone.

### 5) Incremental performance and reliability pass

**Objective:** improve efficiency after architecture stabilizes.

Tasks:

- Profile hot paths in render/update loops.
- Remove redundant allocations and repeated setup work.
- Improve failure isolation so one toy issue does not degrade global runtime behavior.

Exit criteria:

- Measurable perf and reliability improvements against baseline.
- No regressions in toy behavior or checks.

### 6) Documentation and contributor UX completion

**Objective:** ensure long-term sustainability after refactor.

Tasks:

- Update architecture and toy development docs with final patterns.
- Refresh contributor workflows and agent overlays where scripts/patterns changed.
- Publish migration notes and examples for future contributors.

Exit criteria:

- Docs fully aligned with implementation.
- New contributor can create/migrate a toy following docs without code archaeology.

## Suggested sequencing and milestones

- **Milestone A:** Baseline + lifecycle contract draft.
- **Milestone B:** Pilot migration complete and validated.
- **Milestone C:** Broad toy migration done with drift checks hardened.
- **Milestone D:** Perf/reliability pass complete.
- **Milestone E:** Documentation closeout and cleanup.

## Risk management

- Use small PRs grouped by workstream to reduce merge conflicts.
- Keep migration adapters where needed for temporary compatibility.
- If regressions appear, rollback by feature slice instead of reverting entire refactor branch.

## Validation checklist per milestone

- `bun run check`
- `bun run check:toys`
- Targeted manual smoke verification for migrated toys
- Docs updated for any workflow or structure change

## Ownership model (recommended)

- **Refactor lead:** owns cross-cutting architecture and acceptance criteria.
- **Toy migration owners:** migrate assigned toy groups with checklist compliance.
- **Docs owner:** ensures all contributor and agent docs stay aligned.
- **QA owner:** tracks parity against baseline behavior and test health.

## Definition of done

The refactor is complete when shared runtime boundaries are stable, toy implementations follow a consistent architecture, checks prevent metadata/docs drift, and contributor docs accurately describe the current system with no known migration gaps.
