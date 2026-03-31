# Implementation status

This document is the consolidated source for implementation progress across roadmap priorities, refactor milestones, technical debt execution, and UX backlog planning.

## Completed foundations

- [x] Compatibility + onboarding improvements are in place.
- [x] Performance + quality controls are in place.
- [x] Audio permission clarity improvements are in place.
- [x] Touch + gesture consistency baseline is in place.
- [x] Library discovery improvements are in place.
- [x] Homepage first-view CTAs are reduced to one primary launch path plus browse.
- [x] Shared runtime helper foundations are in place.

## Active priorities

- [x] Toy onboarding quick wins (presets / first-time hints).
- [x] Toy-page touch polish (clearer gesture hints and affordances).

## Refactor milestone tracking

- [x] **Milestone A:** Baseline + lifecycle contract draft.
  - [x] Extracted MilkDrop runtime lifecycle seams into focused startup, failover, interaction, and lifecycle modules.
  - [x] Added targeted startup/fallback/lifecycle seam coverage for the refactored runtime modules.
  - [x] Split oversized MilkDrop compiler/runtime/catalog/renderer type groups into topic-specific modules behind the shared barrel.
  - [x] Documented manual smoke baselines and behavior snapshots for milestone sign-off.
- [x] **Milestone B:** Pilot migration complete and validated.
  - [x] Documented the runtime ownership map and shell contract in `docs/ARCHITECTURE.md`.
  - [x] Migrated the shipped MilkDrop starter/quality helpers from `utils/` into `core/` as the pilot boundary slice.
  - [x] Validated the pilot with focused tests, `bun run check:toys`, and `bun run check`.
- [x] **Milestone C:** Broad toy migration with hardened drift checks.
  - [x] Added `bun run check:architecture` and wired it into the full `bun run check` quality gate.
  - [x] Promoted additional runtime-critical helpers (`audio-handler`, `unified-input`, `webgl-check`, `webgl-renderer`, `party-mode`, `shared-initializer`, and library back-navigation) out of `utils/` and into `core/`.
  - [x] Turned `docs/TOY_SCRIPT_INDEX.md` and `docs/toys.md` into deterministic generated artifacts from `assets/data/toys.json`.
  - [x] Wired `bun run check:toys` and `bun run check:seo` into the main quality gate so metadata/docs and shipped SEO surfaces fail fast when they drift.
- [ ] **Milestone D:** Performance/reliability pass complete.
  - [x] Reduced per-frame signal override allocation churn in the MilkDrop input-response path.
  - [x] Expanded browser-backed smoke coverage to include homepage-to-launchpad navigation in addition to live-session launch coverage.
- [ ] **Milestone E:** Documentation closeout and cleanup.
  - [x] Rewrote current contributor docs around the single-visualizer workflow and removed stale references to retired toy-entry surfaces from active docs.

### Refactor workstream tracking

- [x] 1) Baseline and observability.
- [x] 2) Shared runtime boundary extraction.
  - [x] MilkDrop runtime orchestration now delegates startup selection, backend failover, interaction shaping, and frame lifecycle decisions to dedicated modules.
  - [x] Runtime ownership boundaries are now documented in `docs/ARCHITECTURE.md`.
  - [x] Runtime-critical boundary helpers now live under `assets/js/core/*` instead of `assets/js/utils/*`.
- [x] 3) Toy module normalization.
  - [x] MilkDrop pilot slice now uses `core/` starter/quality helpers instead of `utils/` runtime helpers.
- [x] 4) Data and metadata consistency hardening.
  - [x] Architecture boundary enforcement now runs in CI-local parity through `bun run check:architecture`.
  - [x] Toy manifest docs are generated from `assets/data/toys.json` and validated by `bun run check:toys`.
  - [x] SEO surface validation now runs alongside the main quality gate through `bun run check:seo`.
- [ ] 5) Incremental performance and reliability pass.
- [x] 6) Documentation and contributor UX completion.
  - [x] Contributor and agent docs now reflect the single-visualizer product model and generated manifest-doc workflow.

## Technical debt execution queue

- [x] Split oversized runtime modules by responsibility and backfill focused tests.
- [x] Add deterministic generated-artifact validation for metadata/taxonomy updates.
- [x] Raise toy-level smoke coverage, starting with the flagship shipped visualizer flow.
- [x] Harden metadata source-of-truth drift checks.
- [x] Maintain visible refactor execution checkpoints in this document.

## UX delivery queue

### Now (1 sprint)

- [x] Keep filter/refine state obvious on mobile and during scroll.
- [x] Reduce first-view library control density.
- [x] Simplify preflight/error states to one primary CTA.

### Next (1–2 sprints)

- [x] Move diagnostics/technical language behind progressive disclosure.
- [x] Reorder mobile layout to prioritize delight/launch before utility rails.
- [x] Normalize status taxonomy across home and toy shell.

### Later

- [ ] Personalize launch defaults from prior successful sessions.
- [x] Add lightweight dismissible onboarding hints.
- [ ] A/B test hero-only launch vs hero + quick-start variants.

## Maintenance notes

- This file is the authoritative, editable status checklist for roadmap/refactor/debt/UX execution.
- Update this file in the same PR when item status changes.
- Keep `docs/FULL_REFACTOR_PLAN.md` for detailed strategy and rationale (non-authoritative for checklist state).
