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
