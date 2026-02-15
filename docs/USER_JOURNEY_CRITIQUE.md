# Three typical user routes: constructive critique (browser traversal)

This pass traverses three common first-session routes on the local app (`bun run dev:host` + Playwright/Firefox against `http://localhost:5173`) and focuses on practical product decisions in three buckets:
- what can be **removed**,
- what should be **rebuilt**,
- what needs **modification**.

## Route 1 — Home → `Start now`

### Traversal
1. Open `/`.
2. Click `Start now` in the hero actions.
3. Observe route and immediate UI state.

### Observed behavior
- `Start now` is present and clickable.
- The URL changes to `/?modal=rendering-capability`.
- The landing context still emphasizes browsing card content while a capability modal state is active.

### Remove
- Remove duplicate “start” intent labels that overlap (`Start now`, `Browse all stims`, `Surprise`, `Calm pick`, `High energy pick`) in the first viewport. Keep one primary action and demote the rest.

### Rebuild
- Rebuild the `Start now` handoff so it feels like a clear 2-step onboarding flow:
  1) compatibility check,
  2) explicit next action (“Launch recommended toy”).
- Today, route state changes, but the transition feels like a mixed browse/check context rather than a focused start flow.

### Modify
- Modify hero microcopy to set expectation before click: “Quick system check opens first.”
- Modify modal framing to include progress semantics (for example, “Step 1 of 2”).

---

## Route 2 — Home → discover via browse/filter controls

### Traversal
1. Open `/`.
2. Scan discovery controls (`Browse all stims`, category chips such as `Calm`, `Energetic`, `Microphone`).
3. Attempt to narrow and reset.

### Observed behavior
- Discovery controls are visible and expressive.
- The previous search-box-first path appears replaced by chips/curation-first exploration.
- Reset affordance visibility depends on active filter state and can be easy to miss in quick scans.

### Remove
- Remove low-signal filter labels or overlapping taxonomy where two chips communicate nearly the same thing.
- Remove any non-essential control text in the first viewport that competes with the primary discovery path.

### Rebuild
- Rebuild filtering as an explicit “active filters” rail/chip row with always-visible clear state.
- Rebuild the empty/zero-results state to include one-click recovery actions (“Clear filters”, “Show calm picks”, “Try random”).

### Modify
- Modify chip affordances so selected/unselected states are more obvious at a glance.
- Modify result feedback copy to describe *why* toys are shown (“Matched: microphone + calm”).

---

## Route 3 — Direct toy deep link (`/toy.html?toy=geom`)

### Traversal
1. Open `/toy.html?toy=geom` directly.
2. Confirm preflight route behavior and audio controls.
3. Verify immediate action options.

### Observed behavior
- Route resolves to `.../toy.html?toy=geom&modal=rendering-capability`.
- `Use microphone` and `Use demo audio` controls are available.
- `Back to library` is available.

### Remove
- Remove redundant preflight verbosity for repeat users once capability has already been confirmed in-session.

### Rebuild
- Rebuild first-run toy entry as a tighter decision screen:
  - one sentence on capability status,
  - one dominant audio action,
  - one secondary fallback.
- Current structure is functional, but can feel heavy before the first interaction.

### Modify
- Modify preflight to support “remember this decision for this session.”
- Modify button hierarchy so the safest default action is visually primary (typically demo audio), with microphone as explicit opt-in.

---

## Priority cut list

1. **Rebuild first-click onboarding** (`Start now` should feel linear, not mixed-context).
2. **Modify filter state visibility** (clear selected state + always-obvious reset).
3. **Remove overlapping first-viewport action labels** to reduce choice overload.
4. **Modify toy preflight persistence** to reduce repeat friction.

---

## Follow-up pass (2026-02): two typical first-session routes

This pass re-ran live traversal using `bun run dev:host --port 4173` with Playwright/Chromium against `http://127.0.0.1:4173` and focuses on concrete UI decisions that can be turned into scoped tickets.

### Route A — Home hero CTA → `Start now` preflight

#### Traversal
1. Open `/`.
2. Click `Start now`.
3. Evaluate first actionable decision point before visualizer launch.

#### Observed behavior (evidence)
- The preflight panel correctly reports readiness in four status blocks (`Rendering`, `Microphone`, `Environment`, `Performance`).
- First-run actions are split across multiple competing controls (`Use microphone`, `Use demo audio`, `Continue to audio setup`, `Start visualizer`).
- Secondary affordances (`More info`) repeat inside the same step, increasing scan cost before first play.

#### What can be removed
- Remove duplicated progression controls in step 1. Keep a single forward action for each state.
- Remove repeated inline `More info` triggers unless they expose materially different content.

#### What needs to be rebuilt
- Rebuild onboarding as a strict linear flow:
  - **Step 1:** choose audio source,
  - **Step 2:** launch visualizer.
- Rebuild CTA hierarchy so each step has exactly one primary CTA and one optional secondary action.

#### What needs modification
- Modify status copy to explain impact, not just state (example: “Compatible mode reduces visual fidelity but keeps interactions responsive”).
- Modify panel density with collapsed advanced details by default, expandable on demand.

#### Suggested acceptance checks
- New users can reach first visual response in ≤2 explicit clicks after `Start now`.
- Only one primary CTA is visible at any preflight step.

### Route B — Home browse flow → filter refinement (`Calm` + `Demo audio`)

#### Traversal
1. Open `/`.
2. Jump to `Browse` / toy list controls.
3. Apply `Calm`, then open refinement controls and apply `Demo audio`.

#### Observed behavior (evidence)
- Filter feedback is strong once applied (result-count summary plus a `Matched:` explanation for active filters).
- Advanced chips are hidden behind `Refine results`, so key constraints can feel “missing” until discovered.
- Reset behavior is duplicated (`Clear all` in applied rail vs `Clear filters` in control row).

#### What can be removed
- Remove one reset label and keep one canonical clear action.
- Remove semantic overlap between quick-filter and advanced-filter naming where possible.

#### What needs to be rebuilt
- Rebuild filters into a single system with:
  - persistent quick chips,
  - explicit advanced drawer,
  - one shared reset action.
- Rebuild result context so active filters remain visible while scrolling the toy grid.

#### What needs modification
- Modify `Refine results` into a clearer stateful toggle (`More filters` / `Hide filters`).
- Modify selected-chip contrast in light mode for faster peripheral recognition.

#### Suggested acceptance checks
- Users can identify active filters without scrolling back to the control bar.
- Clearing filters is discoverable via one consistently named action.
