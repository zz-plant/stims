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

- [ ] **Milestone A:** Baseline + lifecycle contract draft.
- [ ] **Milestone B:** Pilot migration complete and validated.
- [ ] **Milestone C:** Broad toy migration with hardened drift checks.
- [ ] **Milestone D:** Performance/reliability pass complete.
- [ ] **Milestone E:** Documentation closeout and cleanup.

### Refactor workstream tracking

- [ ] 1) Baseline and observability.
- [ ] 2) Shared runtime boundary extraction.
- [ ] 3) Toy module normalization.
- [ ] 4) Data and metadata consistency hardening.
- [ ] 5) Incremental performance and reliability pass.
- [ ] 6) Documentation and contributor UX completion.

## Technical debt execution queue

- [ ] Split oversized runtime modules by responsibility and backfill focused tests.
- [ ] Add deterministic generated-artifact validation for metadata/taxonomy updates.
- [ ] Raise toy-level smoke coverage, starting with high-traffic toys.
- [ ] Harden metadata source-of-truth drift checks.
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
