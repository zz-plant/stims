# UX reduction critique (80/20 pass)

This revision is intentionally concrete: each recommendation maps to current UI elements in `index.html` and is scored for expected impact, risk, and implementation effort.

## 80% functionality baseline (must keep)

If these remain, the library retains most practical value:

1. **Fast launch:** one obvious primary CTA from home.
2. **Direct retrieval:** search input.
3. **Basic narrowing:** top-tier chips (`Calm`, `Energetic`, `Microphone`, `Demo audio`).
4. **Recovery:** one visible clear/reset action.
5. **Conversion surface:** toy cards + links.

## What can be removed now (low risk)

| Candidate | Current element | Why it is removable | Functional loss |
| --- | --- | --- | --- |
| Remove starter picks block | `<section class="starter-picks">` | Duplicates recommendation intent already served by hero primary CTA (`Start a recommended visual`). | Low |
| Remove shortcuts toggle from default state | `.search-shortcuts-toggle` + hint copy | Useful for power users, but not required for first-session completion. | Low |
| Remove duplicate reset labels | parallel reset affordances (`Clear filters` + secondary reset pattern) | Two labels for one action slows decision-making and increases ambiguity. | None |

## What should be moved (preserve capability, reduce scan cost)

| Move | From | To | Outcome |
| --- | --- | --- | --- |
| Active filter state | Current rail can be visually displaced by results | Immediately below search input; keep visible while scrolling list controls | Users always understand *why* result set changed |
| Secondary browse CTA | Hero row (`Browse with filters`) | Library heading/control area | Hero becomes single-decision, lowers first-click friction |
| Advanced filters | Mixed with quick chips in same disclosure rhythm | Clearly separated “More filters / Hide filters” container | Keeps basic flow lightweight while preserving depth |

## What should be resized

| Resize | Current issue | Recommended change | Guardrail |
| --- | --- | --- | --- |
| Hero vertical footprint | Intro section delays visibility of search + chips | Reduce intro spacing ~20–30% | Keep heading readability and tap target on primary CTA |
| Chip footprint | Chips wrap early and consume control area | Reduce horizontal padding / one typographic step on desktop | Keep accessible touch targets (44px min on touch contexts) |
| Search helper verbosity | Helper + hint text competes with control labels | Keep concise default line; reveal full guidance on demand | Status feedback must remain visible (`data-search-results`) |

## Prioritized cut plan (recommended order)

1. **Hero simplification:** keep only primary CTA in hero action row.
2. **Starter picks removal:** reclaim top-of-library space.
3. **Single reset system:** one canonical clear action.
4. **Advanced filter containment:** move non-core chips behind explicit toggle.
5. **Density pass:** resize hero/chips/meta copy.

## “Do not cut” list

To avoid degrading core usefulness, do **not** remove:

- Search input (`#toy-search`).
- Quick chips for mood + audio capability.
- Active-filter visibility and clear action.
- Result-count status line (`[data-search-results]`).

## Acceptance criteria for the 80/20 redesign

- First-time user reaches a toy in **≤2 decisions** from home.
- Returning user can **search → refine → clear** without re-orienting or scrolling back to hero.
- Above-the-fold area on common laptop viewport shows: primary CTA, search input, quick chips, active-filter state.
- No duplicate labels for identical actions (especially reset/clear patterns).
