# Implementation status

This document is the consolidated source for implementation progress across roadmap priorities, refactor milestones, technical debt execution, and UX backlog planning.

## Completed foundations

- [x] Compatibility + onboarding improvements are in place.
- [x] Performance + quality controls are in place.
- [x] Audio permission clarity improvements are in place.
- [x] Touch + gesture consistency baseline is in place.
- [x] Library discovery improvements are in place.
- [x] Shared runtime helper foundations are in place.

## Active priorities

- [ ] Toy onboarding quick wins (presets / first-time hints).
- [ ] Toy-page touch polish (clearer gesture hints and affordances).

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
- [x] Add visible refactor execution checkpoints (status board).

## UX delivery queue

### Now (1 sprint)

- [ ] De-duplicate first-step prompts (hero vs quick-start).
- [ ] Reduce first-view control density and keep active filters visible.
- [ ] Simplify preflight/error states to one primary CTA.

### Next (1–2 sprints)

- [ ] Move diagnostics/technical language behind progressive disclosure.
- [ ] Reorder mobile layout to prioritize delight/launch before utility rails.
- [ ] Normalize status taxonomy across home and toy shell.

### Later

- [ ] Personalize launch defaults from prior successful sessions.
- [ ] Add lightweight dismissible onboarding hints.
- [ ] A/B test hero-only launch vs hero + quick-start variants.

## Maintenance notes

- Update this file in the same PR when item status changes.
- Keep `docs/FULL_REFACTOR_PLAN.md` for detailed strategy and rationale.
