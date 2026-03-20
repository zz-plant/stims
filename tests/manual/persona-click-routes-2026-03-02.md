# Persona click-route review (2026-03-02)

## Persona

**Curious first-time visitor on desktop**, wants to quickly find a toy that works without setup friction, then optionally try microphone mode.

## Route 1: Homepage ➜ Toys index ➜ first launch

1. Land on `https://no.toil.fyi`.
2. Click `/toys/` from the hero/primary nav.
3. Click the first featured toy card and land on capability-check modal.

### Observed friction

- User intent is “play now,” but the first launch path opens a capability gate before showing delight.
- First toy defaults to a WebGPU issue state (`WebGPU could not start`), which can feel like immediate failure for new users.

### Streamline opportunities

- Prioritize a known-compatible toy in first-card ordering, or route first-time users to a “best on this browser” card.
- Offer a single primary CTA in the modal (“Start with demo audio”) as the obvious path to success.

### Extraneous / distracting

- Button-dense modal creates decision fatigue before the user sees any visual payoff.

## Route 2: Toys index ➜ search intent (“microphone”) ➜ launch

1. Go to `/toys/`.
2. Attempt to search for “microphone”.
3. Launch first available card.

### Observed friction

- Search box was not immediately obvious in this pass, so the flow became “scan and click first card.”
- Generic card CTA text (“Launch toy”) provides little confidence about capability requirements before click.

### Streamline opportunities

- Add quick filter chips near the top (Mic, Demo audio, Mobile-friendly, Low-power).
- Surface concise capability previews directly on CTAs (e.g., “Launch (Demo audio ready)”).

### Extraneous / distracting

- Large card set with repeated generic CTAs encourages random clicking over informed selection.

## Route 3: Toys index ➜ browse/filter intent ➜ toy launch

1. Enter `/toys/`.
2. Use browse/filter controls to narrow toward microphone-ready toys.
3. Open first matching toy card.

### Observed friction

- Filter-to-toy route still lands in capability modal again, which duplicates context the user already signaled by narrowing the browse view first.

### Streamline opportunities

- Treat browse filters as pre-qualified context and suppress redundant warnings unless there is a hard blocker.
- Preselect “demo audio” or persist prior source preference to reduce repeated setup prompts.

### Extraneous / distracting

- Repeated setup messaging on each launch can feel like loops rather than progress.

## Cross-route recommendations (highest impact first)

1. **Reduce pre-play friction**: guarantee a no-fail first visual in one click.
2. **De-duplicate capability messaging** across pages and launch modal.
3. **Condense audio/capture controls** behind progressive disclosure with one dominant next step.
4. **Improve card clarity** with stronger capability badges and outcome-oriented CTA text.


## Prioritized change list

### P0 — Must fix first (immediate first-play success)

1. **Replace multi-option capability modal with a single primary "Start with demo audio" path.**
   - Why first: removes the biggest point of drop-off before any visual reward.
   - Keep secondary options (mic/tab/YouTube) behind an "Advanced" expander.
2. **Guarantee a browser-compatible default toy for first launch.**
   - Why first: prevents "WebGPU could not start" as the first emotional impression.
   - Fallback behavior: auto-route to a known compatible toy when capability preflight fails.

### P1 — High-impact next (discovery and confidence)

3. **Add fast filter chips at top of `/toys/` (Mic, Demo audio, Mobile-friendly, Low-power).**
   - Why: converts scanning effort into one-tap intent matching.
4. **Upgrade toy-card CTA and badges from generic "Launch toy" to capability-aware copy.**
   - Example: "Launch • Demo audio ready" or "Launch • Mic recommended".
   - Why: helps users predict success before click.

### P2 — Reduce repeated friction in deeper paths

5. **Avoid re-showing full capability messaging after users arrive via capability pages.**
   - Why: capability pages already indicate user intent and context.
   - Show only hard blockers or lightweight confirmation.
6. **Persist previous audio-source choice across launches in-session.**
   - Why: removes repetitive setup loops when trying multiple toys.

### P3 — Polish and focus

7. **Trim top-level modal/button density with progressive disclosure.**
   - Why: lower cognitive load for first-time users.
8. **Make search/filter controls visually dominant above the card grid.**
   - Why: discourages random first-card clicks and improves directed exploration.


## High effort, high payoff bets

1. **Adaptive first-run orchestration (capability-aware launcher).**
   - **Effort:** High (requires shared preflight state, routing logic, and UX copy alignment across home, toys, capability pages, and launch modal).
   - **Payoff:** Very high. New users reliably see a successful visual in one click, reducing early abandonment and support confusion.
   - **What to build:** A first-run decision engine that selects the best toy + best audio source for the current browser/device and degrades gracefully.

2. **Unified launch surface replacing fragmented modal flows.**
   - **Effort:** High (rework modal architecture, component states, analytics events, and backward compatibility for direct toy links).
   - **Payoff:** Very high. Removes duplicated prompts and inconsistent messaging; creates one predictable launch mental model.
   - **What to build:** A single launcher UI with progressive disclosure (`Start now` primary path, advanced capture options secondary).

3. **Intent-first discovery redesign of `/toys/`.**
   - **Effort:** High (taxonomy refinement, metadata quality pass, faceted filtering UI, ranking/sorting strategy, and content QA).
   - **Payoff:** High. Users find a suitable toy faster and click with more confidence; improves breadth exploration beyond first card.
   - **What to build:** Sticky facet chips + capability badges + smarter default sort (compatibility + responsiveness + popularity/quality signals).

4. **Session memory + cross-toy continuity for audio/input choices.**
   - **Effort:** Medium-high to high (state persistence model, privacy-safe defaults, edge-case handling per toy capability).
   - **Payoff:** High for repeat interactions. Dramatically reduces repetitive setup loops when users try multiple toys.
   - **What to build:** In-session preference memory for demo/mic/tab source, with clear reset/override controls.

5. **Measurement pipeline for launch-friction funnel.**
   - **Effort:** High (instrumentation taxonomy, event governance, dashboarding, experiment framework, and KPI definitions).
   - **Payoff:** High and compounding. Enables objective prioritization and validates whether UX changes increase successful first-play rate.
   - **What to build:** Funnel metrics from landing → toy click → capability prompt → first rendered frame/audio active; segment by browser/device.
