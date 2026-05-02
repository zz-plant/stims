# Recurring Fix Patterns Audit (2026-05)

> Snapshot of the last ~400 commits, with focus on the ~22 non-merge fix/regression commits, cross-referenced against existing audit docs.

## 1. Executive Summary

Across the last 400 commits, **~10% of non-merge commits are fixes or regression repairs**. The overwhelming majority of those fixes cluster in **three areas**: (1) **MilkDrop shader/feedback/WebGPU parity**, (2) **renderer capability and fallback lifecycle**, and (3) **test harness drift**. A striking ~38 fix-related commits (including merges) come from `codex/*` branches, indicating that **AI-assisted code review is surfacing issues that human review missed**—but also that **the same categories of bugs keep being re-discovered**.

**No reverts** in the sampled window, which suggests fixes are small and surgical rather than catastrophic rollbacks. However, the **density of parity and fallback fixes** signals that the WebGPU/WebGL dual-backend and the preset compiler/renderer boundary are still **unstable under change**.

---

## 2. Fix Category Breakdown

### 2.1 MilkDrop Shader / Feedback / WebGPU Parity (~35% of fixes)

**Commits:**
- `fix(milkdrop): refine color mixing logic in feedback shaders and enhance shader tests`
- `fix(milkdrop): update resolution scales and feedback target sizes in backend behavior`
- `Fix shader-texture feedback parity on WebGPU`
- `Fix blend alpha parity for shapes and custom waves`
- `Fix additive render order for procedural wave blends`
- `Fix WebGPU procedural blend wave interpolation`
- `Fix closed WebGPU batched waves`
- `Fix lowered field center normalization in GPU shaders`
- `Fix lowered field shader center handling`
- `Fix renderer adapter blend script issues`
- `Update parity backlog for sampler and line-width fixes`

**Files most touched:**
- `assets/js/milkdrop/feedback-manager-shared.ts` (3×)
- `assets/js/milkdrop/feedback-manager-webgpu.ts` (3×)
- `assets/js/milkdrop/renderer-adapter.ts` (2×)
- `assets/js/milkdrop/renderer-adapter-webgpu.ts`
- `assets/js/milkdrop/backend-behavior.ts`
- `assets/js/milkdrop/compiler/gpu-descriptor-plan.ts`

**What we keep getting wrong:**
- **Alpha blending order and feedback color math** are repeatedly tweaked. The interaction between WebGPU TSL shaders and the legacy MilkDrop feedback pipeline is subtle; small changes in resolution scale or target size break parity.
- **Wave interpolation and batched-wave closure** keep regressing when the renderer adapter changes. The WebGPU path has different sampling behavior than WebGL, and the adapter abstraction leaks.
- **GPU shader lowering** (field center normalization, shader center handling) is fragile. Changes to the compiler IR or descriptor plan propagate into generated shader code in non-obvious ways.

**Cross-reference:**
- `docs/FRONTEND_PERFORMANCE_BOTTLENECKS.md` flags per-frame VM/renderer data reconstruction and blend-state cloning as hotspots. The fixes above are the *functional* counterpart: the same code paths that are slow are also buggy.
- `docs/CODE_REVIEW_PATTERNS_2026-03.md` calls out "correctness in edge cases" and "bucket/average math mismatches." The parity fixes are exactly that—edge-case math mismatches between backends.

---

### 2.2 Renderer Capability / Fallback / Timeout Lifecycle (~25% of fixes)

**Commits:**
- `Fix WebGPU timeout fallback regressions`
- `Prefer WebGL fallback and fix analyser worklet path`
- `Fix runtime renderScale propagation for pooled renderers`
- `Fix scripted legacy motion vector descriptor fallback`
- `Fix Cream of the Crop preset fallback`
- `Fix WebGPU parity capture and certification preset routing`
- `Fix immersive demo startup in agent integration harness`

**Files most touched:**
- `assets/js/core/renderer-setup.ts` (3×)
- `assets/js/core/renderer-capabilities.ts` (2×)
- `assets/js/core/services/render-service.ts` (2×)
- `assets/js/core/renderer-init-timeout.ts`
- `assets/js/core/renderer-plan.ts`
- `assets/js/core/renderer-query-override.ts`
- `assets/js/core/audio-handler.ts`
- `assets/js/milkdrop/runtime/backend-fallback.ts`

**What we keep getting wrong:**
- **Fallback chains are deep and brittle.** WebGPU → WebGL → error-state transitions involve timeout logic, capability probing, and render-scale propagation. A change in one layer (e.g., timeout duration) breaks another (e.g., pooled renderer reuse).
- **renderScale propagation** is a recurring bug. The value is computed in the capability probe, passed through the renderer plan, overridden by query params, and then applied to pooled renderers. Any mismatch in this chain produces silent visual degradation or black screens.
- **Audio worklet path** is tangled with renderer selection. The analyser worklet initialization depends on the chosen backend, and fallback changes disrupt it.

**Cross-reference:**
- `docs/CODE_REVIEW_PATTERNS_2026-03.md` explicitly calls out "audio lifecycle and permission handling" as a recurring review theme. The analyser worklet fix is a direct instance.
- `docs/FRONTEND_ANTI_PATTERNS_2026-03.md` notes "event-listener lifecycle leak risk." While not identical, the fallback/timeout fixes share the same root cause: stateful lifecycle code with implicit ordering assumptions.

---

### 2.3 Test Harness / Expectation / Fixture Drift (~20% of fixes)

**Commits:**
- `fix(tests): correct formatting of architecture violation source path`
- `Fix failing test expectations`
- `Refactor test harness and fixture modules`
- `Fix immersive demo startup in agent integration harness`
- `Add main-wave blend alpha regression test`
- `Expand legacy wave alias regression coverage`
- `Refactor URL state alias normalization and add regression coverage`

**Files most touched:**
- `tests/milkdrop-renderer-adapter.test.ts` (5× across all fix commits)
- `tests/milkdrop-compiler.test.ts` (2×)
- `tests/milkdrop-compiler-seams.test.ts` (2×)
- `tests/milkdrop-feedback-composite-profile.test.ts` (2×)
- `tests/loader.test.js` (2×)
- `tests/renderer-setup.test.ts` (2×)
- `tests/renderer-capabilities.test.js` (2×)
- `tests/environment/*` (dom.ts, install.ts, webgpu.ts, animation-frame.ts)

**What we keep getting wrong:**
- **Tests are tightly coupled to internal file paths and formatting.** The "architecture violation source path" fix is a tell: the test was asserting on a string that changed when directories moved. This is a maintenance tax every refactor pays.
- **Expectation drift** happens when the production behavior changes slightly (e.g., a new default, a renamed field) and tests are updated reactively rather than proactively.
- **Integration harness startup** is flaky. The agent integration harness and immersive demo both depend on a precise initialization sequence; changes to the shell or audio bridge break them.

**Cross-reference:**
- `docs/CODE_REVIEW_PATTERNS_2026-03.md` recommends "narrow regression tests for known weak spots." The regression tests being *added* in fix commits (blend alpha, wave alias) prove the point: we are playing catch-up.
- `docs/OUTSTANDING_ISSUES_AUDIT_2026-03.md` lists "toy smoke coverage expansion" as open. The test-fix commits show this is still a live issue.

---

### 2.4 Workspace UI / Shell / Toast (~10% of fixes)

**Commits:**
- `Fix workspace tool toggles and toast behavior`
- `Fix Codex session state and MCP dev guidance`

**Files:**
- `assets/js/frontend/App.tsx`
- `assets/js/frontend/workspace-hooks.ts`
- `assets/js/frontend/workspace-shell-hooks.ts`
- `assets/js/frontend/url-state.ts`

**What we keep getting wrong:**
- **React workspace state and the imperative MilkDrop runtime are not fully decoupled.** Tool toggles and toast notifications interact with session state that is also manipulated by the engine adapter. Race-y or double-fire behavior results.
- **URL state normalization** keeps needing fixes. Legacy query params (`experience`, `panel`) and canonical params (`tool`, `collection`) collide.

**Cross-reference:**
- `docs/ARCHITECTURE.md` defines the "engine seam" boundary, but the fixes show the seam is still leaky for UI state.
- `docs/CODE_REVIEW_PATTERNS_2026-03.md` flags "async state transition" and "stale state after async operations" as recurring issues.

---

### 2.5 Deploy / Config / Tooling (~10% of fixes)

**Commits:**
- `Fix deploy helper post-upload exit handling`
- `Fix Pages deploy helper config handling`

**Files:**
- `scripts/deploy-cloudflare.mjs` (2×)

**What we keep getting wrong:**
- **Deploy scripts have implicit state assumptions** (exit codes, config file presence) that break when Wrangler or GitHub Actions behavior changes. These are low-frequency but high-friction when they fail.

---

## 3. What the Data Says About Process

### 3.1 AI Review Is Finding What Humans Missed

~38 fix-related commits (including merges) originate from `codex/*` branches. The branch names tell a story:
- `fix-issues-from-codex-review-for-pr-#XXX`
- `fix-high-priority-bug-in-...`
- `fix-codex-review-issues-...`

This means **a significant fraction of fixes are follow-ups to AI-generated review comments.** This is valuable—it's catching edge cases—but it also means **the initial PRs are landing with known defect categories**.

### 3.2 The Same Files Keep Breaking

**Top files in *all* commits (not just fixes):**
- `assets/js/milkdrop/runtime.ts` (31×)
- `tests/milkdrop-renderer-adapter.test.ts` (29×)
- `assets/js/milkdrop/feedback-manager-shared.ts` (18×)
- `assets/js/milkdrop/feedback-manager-webgpu.ts` (17×)
- `assets/js/milkdrop/renderer-adapter.ts` (15×)

These are the hottest files in the repo. They are also the ones that keep needing fixes. **High churn + high fix density = instability cluster.**

### 3.3 Fixes Touch More Test Files Than Source Files

In fix commits, **41 file changes were in `tests/` vs. 31 in `assets/js/milkdrop/` and 12 in `assets/js/core/`**. This suggests:
- Tests are brittle and require co-fixing.
- Or: fixes are often *validated* by test changes, which is good, but the ratio implies test maintenance overhead is high.

---

## 4. Root Cause Themes

| Theme | Evidence | Why It Repeats |
|-------|----------|----------------|
| **Dual-backend parity drift** | WebGPU/WebGL shader math, blend order, wave interpolation fixes | Two rendering paths with different GPU semantics; changes to one break the other |
| **Deep fallback chain fragility** | timeout, renderScale, capability probe, worklet fixes | Stateful, ordered initialization with implicit dependencies; no formal state machine |
| **Compiler → renderer boundary leaks** | lowered field center, shader center, blend script fixes | IR changes propagate unpredictably into generated GPU code |
| **Test coupling to internals** | architecture path formatting, expectation drift, harness startup | Tests assert on strings, paths, and ordering rather than behavior |
| **UI/runtime state races** | toast, toggle, URL state fixes | React declarative state and imperative engine state are not fully isolated |

---

## 5. Recommendations

### A. Harden the WebGPU/WebGL parity boundary

- **Add a parity gate to CI.** Before any PR touching `feedback-manager-*`, `renderer-adapter*`, or `backend-behavior.ts` can merge, require `bun run test:compat` to pass against a fixed set of reference presets.
- **Freeze reference preset outputs.** Capture pixel-level (or perceptual-hash) baselines for `eos-phat-cubetrace-v2`, `krash-rovastar-cerebral-demons-stars`, and `rovastar-parallel-universe`. Any PR changing the renderer pipeline must show no baseline shift.
- **Document parity assumptions.** Every shader math tweak should include a comment explaining the WebGPU vs. WebGL semantic difference it addresses.

### B. Replace implicit fallback chains with explicit state machines

- The renderer setup, capability probe, and fallback logic (`renderer-setup.ts`, `renderer-capabilities.ts`, `render-service.ts`, `backend-fallback.ts`) should be modeled as an explicit state machine with transitions, not a sequence of `if (webgpu) { ... } else if (webgl) { ... }` blocks.
- **Add property-based tests** for fallback transitions: given any combination of `{webgpuSupported, webglSupported, timeout, preferredBackend}`, assert that the resulting renderer and audio context are valid and consistent.

### C. Reduce test coupling to internal paths and strings

- **Ban path-string assertions in tests.** The "architecture violation source path" fix should never have been necessary. Use module identifiers or behavior-based assertions instead.
- **Separate integration harness startup from test logic.** The immersive demo and agent harness should have a single, versioned startup contract. Changes to the shell should not require test fixes unless the contract itself changes.

### D. Isolate workspace UI state from engine state

- **Enforce the adapter boundary.** `App.tsx` and workspace hooks should not read or write MilkDrop runtime internals directly. All state exchange should go through `milkdrop-engine-adapter.ts` with typed events.
- **Add a UI-state regression test.** Simulate rapid toggle/overlay/open/close sequences and assert no duplicate toasts, no stale URL params, and no engine crashes.

### E. Targeted pre-commit checklists

Add a PR checklist for the high-churn areas:

> **If touching `assets/js/milkdrop/feedback-manager-*` or `renderer-adapter*`**:
> - [ ] WebGL and WebGPU paths both tested with reference presets?
> - [ ] No hardcoded resolution scales or target sizes without comment?
> - [ ] Blend alpha order verified against projectM baseline?
>
> **If touching `assets/js/core/renderer-*` or `audio-handler.ts`**:
> - [ ] Fallback chain tested with WebGPU disabled?
> - [ ] renderScale propagation verified end-to-end?
> - [ ] Audio worklet initialization validated on fallback path?
>
> **If touching `tests/*`**:
> - [ ] No new path-string or formatting assertions?
> - [ ] Integration harness startup contract unchanged?

### F. Measure fix-rate monthly

Track from the same commit sample each month:
- % of non-merge commits that are fixes
- Fix density by directory (`milkdrop/`, `core/`, `frontend/`)
- % of fixes originating from `codex/*` review branches
- Top 5 files appearing in fix commits

A lightweight dashboard (even a markdown table updated monthly) keeps the quality loop visible.

---

## 6. References

- `docs/CODE_REVIEW_PATTERNS_2026-03.md`
- `docs/FRONTEND_ANTI_PATTERNS_2026-03.md`
- `docs/FRONTEND_PERFORMANCE_BOTTLENECKS.md`
- `docs/OUTSTANDING_ISSUES_AUDIT_2026-03.md`
- `docs/ARCHITECTURE.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `docs/MILKDROP_PROJECTM_PARITY_PLAN.md`
- `docs/VERIFICATION_MATRIX.md`
