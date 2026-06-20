# Recurring Fix Patterns Audit — May 2026

Generated: 2026-05-16 | Sample: 400 commits (300 fix-captioned, 125 non-merge fix, 0 revert)

## 1. Fix counts by category

Classification of 125 non-merge commits whose subject or files match fix/regression patterns (last 400 commits).

| Category | Count | Pct | Trend vs last audit |
|---|---|---|---|
| Parity drift | 28 | 22.4% | Primary category |
| UI/state races | 23 | 18.4% | Higher than expected |
| Deploy/tooling | 20 | 16.0% | Stable |
| Test harness drift | 19 | 15.2% | Stable |
| **Module loading & bootstrap** | 14 | 11.2% | **New** |
| **Toy runtime drift** | 11 | 8.8% | **New** |
| Fallback fragility | 10 | 8.0% | Lower than expected |

**Note:** The review skill claims ("~35% parity", "~25% fallback", "~20% test", "~10% UI") overstate parity and fallback while undercounting UI and missing the two new categories entirely.

## 2. Hottest 20 files by fix density

Files appearing most often in the 300 fix-captioned commits:

| # | File | Fix commits | All commits | Fix rate |
|---|---|---|---|---|
| 1 | `tests/milkdrop-renderer-adapter.test.ts` | 10 | 58 | 17.2% |
| 2 | `assets/css/base.css` | 9 | 22 | 40.9% |
| 3 | `assets/js/milkdrop/feedback-manager-shared.ts` | 8 | 21 | 38.1% |
| 4 | `assets/js/milkdrop/feedback-manager-webgpu.ts` | 7 | 20 | 35.0% |
| 5 | `assets/js/frontend/workspace-hooks.ts` | 7 | 19 | 36.8% |
| 6 | `assets/js/frontend/App.tsx` | 7 | 39 | 17.9% |
| 7 | `assets/js/core/renderer-setup.ts` | 7 | 9 | 77.8% |
| 8 | `assets/css/index.css` | 7 | 31 | 22.6% |
| 9 | `tests/milkdrop-compiler.test.ts` | 6 | 30 | 20.0% |
| 10 | `tests/loader.test.js` | 6 | 20 | 30.0% |
| 11 | `index.html` | 6 | 32 | 18.8% |
| 12 | `assets/js/ui/audio-controls.ts` | 6 | 16 | 37.5% |
| 13 | `assets/js/milkdrop/renderer-adapter.ts` | 6 | 33 | 18.2% |
| 14 | `tests/setup.ts` | 5 | 15 | 33.3% |
| 15 | `assets/js/ui/nav.ts` | 5 | 19 | 26.3% |
| 16 | `assets/js/toy-view.ts` | 5 | 12 | 41.7% |
| 17 | `assets/js/milkdrop/compiler.ts` | 5 | 25 | 20.0% |
| 18 | `assets/js/library-view.js` | 5 | 16 | 31.3% |
| 19 | `assets/js/core/capability-preflight.ts` | 5 | 15 | 33.3% |
| 20 | `toys/symph.html` | 4 | 10 | 40.0% |

\* File removed in Jun 2026 refactor — capability probe logic folded into `engine-context.tsx`.

## 3. Instability clusters

Files that are both high-churn (top 20 in all-commit frequency) AND high-fix-density (≥25% fix rate):

### Feedback manager (parity core)
- **`assets/js/milkdrop/feedback-manager-shared.ts`** — 8/21 = 38.1% fix rate
- **`assets/js/milkdrop/feedback-manager-webgpu.ts`** — 7/20 = 35.0% fix rate
- Root cause: Shared logic drifts when WebGPU path diverges; parity changes don't always get cross-backend regression tests.

### UI state surface
- **`assets/js/frontend/workspace-hooks.ts`** — 7/19 = 36.8% fix rate
- **`assets/js/ui/audio-controls.ts`** — 6/16 = 37.5% fix rate
- **`assets/js/ui/nav.ts`** — 5/19 = 26.3% fix rate
- Root cause: Stale closures in React hooks, async engine-state races, toggle double-fire.

### CSS regressions
- **`assets/css/base.css`** — 9/22 = 40.9% fix rate (mostly mobile overflow/clipping)
- **`assets/css/index.css`** — 7/31 = 22.6% fix rate
- Root cause: Shared CSS base has cascading effects; layout fixes aren't verified at responsive breakpoints.

### Toy/module boundary
- **`assets/js/toy-view.ts`** — 5/12 = 41.7% fix rate
- **`assets/js/library-view.js`** — 5/16 = 31.3% fix rate
- **`toys/symph.html`** — 4/10 = 40.0% fix rate
- Root cause: Standalone toy HTML pages and their loader bridge share no contract or test; each toy breaks independently.

### Renderer setup (fallback)
- **`assets/js/core/renderer-setup.ts`** — 7/9 = 77.8% fix rate
- Root cause: Nearly every change to this file is a fix. The fallback/initialization state machine is fragile despite low overall churn.

## 4. New patterns

### Module loading & bootstrap (11.2% of fixes)
This category covers: toy module loading failures, manifest resolution, library boot regressions, gamepad polling, iframe loading, demo autostart, and route loader resolution. These are distinct from deploy/tooling (build pipeline, wrangler config) and distinct from fallback fragility (renderer backends).

**Typical files:** `assets/js/bootstrap/*`, `assets/js/loader.ts`, `assets/js/library-view.js`, `assets/js/toy-view.ts`, `assets/js/milkdrop/catalog-store*.ts`

**Why it's new:** These commits did not exist when the five-theme taxonomy was created. The repo has grown a complex module-loading layer (bundled toys, catalog, manifest) that lacks a dedicated review skill.

### Toy runtime drift (8.8% of fixes)
This category covers: standalone toy HTML files (`toys/*.html`, `multi.html`, `defrag.html`, `sgpat.html`, `lights.html`) that each embed their own runtime. Fixes include TDZ errors, canvas element checks, microphone layout, module script usage, and stray character cleanup.

**Typical files:** `toys/symph.html`, `toys/geom.html`, `toys/seary.html`, `multi.html`, `defrag.html`, `sgpat.html`, `lights.html`

**Why it's new:** These files are self-contained and test-less. They break silently and are discovered only through QA or production reports. No existing skill gates changes to toy HTML pages.

## 5. Prevention recommendations

### review-webgpu-parity
- **Update:** The "~35%" claim needs correction to 22.4%.
- **Add checklist item:** CSS changes that touch `base.css` or `index.css` must be verified at mobile breakpoints (320px, 768px, 1024px) since parity-regression CSS leaks into global layout.
- **Add checklist item:** If touching `feedback-manager-shared.ts`, confirm the change is ported to `feedback-manager-webgpu.ts` (and `*-webgpu-tsl.ts`, `*-webgpu-composite.ts`) in the same commit — 38.1% fix rate means every shared change is a potential drift.

### review-renderer-fallback
- **Update:** The "~25%" claim needs correction to 8.0%.
- **Add checklist item:** Before any change to `renderer-setup.ts`, run the full capability matrix: `webgpu+webgl × preferred × timeout × queryOverride`. This file has a 77.8% fix rate.
- ~~**Add checklist item:** Changes to `capability-preflight.ts` must update `tests/setup.ts` or `tests/renderer-capabilities.test.js` to cover the new probe path.~~ (File removed Jun 2026)

### review-test-harness
- **Update:** The "~20%" claim is close (15.2%).
- **Add checklist item:** `tests/milkdrop-renderer-adapter.test.ts` appears in 10 fix commits (most of any file). Any test expectation change in this file must reference a specific parity regression commit SHA.
- **Add checklist item:** `tests/loader.test.js` (30% fix rate) — loader test stubs must mock consistently with `assets/js/loader.ts` module resolution semantics.

### review-workspace-ui-state
- **Update:** The "~10%" claim needs correction to 18.4%.
- **Add checklist item:** `workspace-hooks.ts` has a 36.8% fix rate from stale closures. Add "every useEffect that triggers engine lifecycle must have an explicit AbortController cleanup" — verify by grep.
- **Add checklist item:** `audio-controls.ts` (37.5% fix rate) — any change must pass `tests/audio-handler.test.js` and the integration harness.
- **Add checklist item:** `nav.ts` (26.3% fix rate) — verify that back-button, search-launch, and route-change paths have regression tests covering rapid sequential invocations.

### New skill: review-module-loading (recommended)
- **Files to gate:** `assets/js/bootstrap/*`, `assets/js/loader.ts`, `assets/js/library-view.js`, `assets/js/toy-view.ts`, `assets/js/milkdrop/catalog-store*.ts`, `index.html`
- **Why:** 11.2% of fixes cluster in module loading, manifest resolution, and library boot. No skill exists.
- **Checklist items:**
  - Toy module paths must be validated against the bundled manifest
  - Loader resolution must handle both dev (`/assets/js/...`) and prod (hashed) paths
  - Library boot must guard against null DOM cache reads
  - Gamepad polling must survive startup before `navigator.getGamepads` is available
  - `index.html` changes must be verified across all route entry points (`/`, `/?tool=`, `/?preset=`)

### New skill: review-toy-runtime (recommended)
- **Files to gate:** `toys/*.html`, `multi.html`, `defrag.html`, `sgpat.html`, `lights.html`
- **Why:** 8.8% of fixes are toy-specific HTML fixes. No skill exists. Each toy is self-contained and test-less.
- **Checklist items:**
  - Every toy HTML page must pass a load+render check in a browser
  - Toy TDZ errors must be caught before deploy (these indicate module ordering bugs)
  - Canvas element checks must not assume a single canvas on the page
  - Microphone/audio element selectors must use scoped queries (not `document.querySelector` unfiltered)
  - All toy pages must load and render without error at `/?toy=<name>` on both desktop and mobile viewports

### Cross-cutting recommendation
- The ratio of fix commits to total commits is very high (300/400 = 75%). This suggests the repo's review gating is insufficient. Consider tightening the quality gate so `bun run check` blocks PR merge when any test fails.
- CSS files (`base.css`, `index.css`) account for more fix commits than almost any JS file. Add a CI step that screenshots at mobile/desktop breakpoints and diffs against baseline.

## 6. Skills created from this audit

### review-deploy-tooling (2026-05-16)

Created to cover the deploy/tooling category (16.0%, #3). Gating files: `.github/workflows/ci.yml`, `wrangler.toml`, `scripts/build.mjs`, `scripts/deploy-cloudflare.mjs`, `package.json` scripts. See `.agent/skills/review-deploy-tooling/SKILL.md`.

### review-module-loading (2026-05-16)

Created to cover the module loading & bootstrap category (11.2%, #5). Gating files: `assets/js/bootstrap/*`, `assets/js/loader.ts`, `assets/js/library-view.js`, `assets/js/toy-view.ts`, `assets/js/milkdrop/catalog-store*.ts`, `assets/data/toys.json`, `index.html`, gamepad polling code. See `.agent/skills/review-module-loading/SKILL.md`.

Both skills are registered in `scripts/mcp-shared.ts`, `docs/agents/custom-capabilities.md`, and `docs/agents/visualizer-workflows.md`.

## Validation

```bash
# Run after writing this doc
bun run check:quick
```

## Skills Updated

Four review skill percentage claims were corrected on 2026-05-16 to match the audit data (125 fix commits):

| Skill | Old | New | Note |
|---|---|---|---|
| `review-webgpu-parity` | ~35% | ~22% | Still #1 category |
| `review-workspace-ui-state` | ~10% | ~18% | Now #2 (was understated) |
| `review-test-harness` | ~20% | ~15% | Slight overstatement corrected |
| `review-renderer-fallback` | ~25% | ~8% | Now smallest category; fallback state machine (Sprint 7) may have reduced rate further |
