# Technical debt register (2026-02)

This register captures the highest-impact technical debt observed in the current repository layout and tooling.

## How this was identified

- Reviewed architecture and refactor docs for already-known pain points.
- Measured large files and generated-page footprint to identify maintenance hotspots.
- Compared toy implementation inventory to toy-specific tests to find coverage gaps.

## Prioritized debt items

### 1) Oversized runtime modules increase change risk

**Why this is debt**

Several core runtime/UI files are very large (`assets/js/library-view.js` at 2676 lines, `assets/js/core/capability-preflight.ts` at 935 lines, and `assets/js/loader.ts` at 651 lines). Large multipurpose modules are harder to reason about, harder to test in isolation, and increase merge-conflict probability.

**Impact**

- Slower contributor onboarding for runtime changes.
- Higher regression risk when touching navigation, capability gating, or library rendering.
- More difficult test targeting because responsibilities are mixed.

**Recommended next step**

Split by responsibility first (state model, DOM rendering, and side-effects), then backfill focused unit tests per extracted module.

---

### 2) SEO/static artifact sprawl in `public/` creates sync overhead

**Why this is debt**

`public/` currently contains 111 checked-in `index.html` pages (including 60 tag pages and 21 mood pages). This improves deploy simplicity but raises maintenance burden and increases the risk of stale generated artifacts if source metadata changes without regeneration.

**Impact**

- Large review diffs for taxonomy/content updates.
- Potential drift between source metadata and generated output.
- Longer CI and local verification loops when broad regeneration is needed.

**Recommended next step**

Introduce deterministic generation checks in CI as a required gate for PRs touching toy metadata/taxonomy, and consider reducing committed generated surface where hosting requirements allow.

---

### 3) Toy-level test coverage is uneven versus toy inventory size

**Why this is debt**

There are 26 TypeScript toy modules in `assets/js/toys`, but only a small subset have direct toy-specific test files by slug naming convention. Core/runtime tests are present, but individual toy behavior can regress without focused coverage.

**Impact**

- Higher risk of visual/audio regressions slipping through when editing toy modules.
- More manual playtesting burden per release.

**Recommended next step**

Set a minimum policy for toy-specific smoke tests (for example: module loads, starts, and disposes cleanly) and apply it incrementally to high-traffic toys first.

---

### 4) Source-of-truth duplication still requires strict discipline

**Why this is debt**

Toy metadata exists in `assets/data/toys.json` while deploy output also includes `public/toys.json`. Even with generation tooling, maintaining dual representations always carries drift risk if process adherence slips.

**Impact**

- Confusing edit surface for new contributors.
- Risk of stale metadata in deploy artifacts when generation steps are skipped.

**Recommended next step**

Strengthen contributor docs and pre-commit/CI checks to make drift impossible to merge.

---

### 5) Refactor roadmap exists, but execution checkpoints are not yet visible as tracked milestones

**Why this is debt**

A strong staged plan exists in `docs/FULL_REFACTOR_PLAN.md`, including workstreams and exit criteria, but without a linked status tracker contributors cannot quickly see what has been completed versus pending.

**Impact**

- Refactor intent may not consistently translate into day-to-day PR sequencing.
- Teams can duplicate effort or skip prerequisite work.

**Recommended next step**

Add a lightweight status board (for example, checklist section in the refactor doc or linked issue milestones) and update it with each refactor PR.

## Suggested order of execution

1. Break up oversized runtime modules (highest leverage for maintainability).
2. Add toy smoke-test baseline for the most-used toys.
3. Tighten generated-artifact drift checks for metadata/SEO pages.
4. Establish visible milestone tracking for the existing refactor plan.
5. Re-assess debt quarterly and refresh this register.
