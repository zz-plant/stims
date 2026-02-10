# Three typical user journeys: constructive critique (traversed pass)

This pass walks through three user journeys on the local app (`bun run dev` + Playwright) and critiques each flow with practical, incremental improvements.

## Journey 1: Launch from the hero quick-start CTA

### Traversal
1. Open `index.html` (`/`).
2. Click the first hero CTA (`Open Halo Flow`).
3. Observe route/state after launch.

### What worked well
- Hero intent is clear: users immediately see a fast-path CTA cluster with explicit choices (`Open Halo Flow`, `Start flow mode`, `Surprise me`).
- The transition keeps momentum: click-through lands directly in toy mode (`/?toy=holy`) without a full hard-navigation detour.
- Capability preflight appears promptly, giving users a compatibility snapshot before interaction.

### Constructive critique
- **Route semantics may be surprising for non-technical users.** The hero link advertises `toy.html?toy=holy`, but runtime navigation resolves to `/?toy=holy`. This is functionally fine, but can create mild trust friction when users watch the URL bar change to an unexpected form.
- **The preflight dialog can feel like a speed bump on “quick start.”** It is informative, but it visually interrupts the “instant play” promise before the user can choose an audio source.
- **Too many first-step choices at once.** Four hero CTAs can increase decision friction for first-time users who only want one obvious “just start” path.

### Improvements to consider
- Add a short helper line under hero CTAs: “You may see a quick compatibility check before play.”
- Keep one dominant default CTA and visually demote the others for first-time sessions.
- Mirror the final route format in CTA hover/status copy to reduce URL mismatch surprise.

---

## Journey 2: Search and narrow the library

### Traversal
1. Load `/` and wait for library cards.
2. Search for `webgpu`, `mobile`, and a nonsense query.
3. Clear search and verify recovery.

### What worked well
- Search is responsive and understandable: result messaging updates with query context (`1 results • q: “webgpu”`, `0 results • q: “nonexistent-zzzz”`).
- Filtering behavior appears reliable across intent types (capability keyword, form-factor keyword, no-match query).
- Reset path is obvious: Clear restores full library state quickly (`24 results`).

### Constructive critique
- **No visible “why this matched” cues in condensed scanning.** Result counts are clear, but first-time users still need to open/scan cards to understand why `webgpu` or `mobile` matched.
- **Zero-results recovery could be more assistive.** The `0 results` message is accurate, but it does not immediately suggest alternatives (remove filters, try capability tags, open starter packs).
- **Power users may want faceted narrowing after search.** Free-text works, but common follow-ups (“only demo-audio toys”, “touch-first only”) still require manual refinement.

### Improvements to consider
- Add inline “matched on: capability/tag/mood” chips to surfaced cards.
- Expand empty-state text with one-click suggestions (e.g., “Show all”, “Try demo-audio”, “Try mobile”).
- Add lightweight post-search filters (capabilities, mood, setup difficulty) to complement text query.

---

## Journey 3: Start audio on toy page with capability preflight in front

### Traversal
1. Open `toy.html?toy=geom`.
2. Observe preflight dialog and status copy.
3. Confirm mic/demo controls availability behind/after preflight.

### What worked well
- Preflight messaging is explicit and confidence-building: users get immediate status for rendering, microphone readiness, environment, and performance.
- Audio choices are clear when controls are available (`Use microphone` and `Use demo audio` both present).
- The guidance language is practical and non-alarmist, which helps reduce setup anxiety.

### Constructive critique
- **Modal interception can block expected first click behavior.** The preflight dialog can intercept pointer events for audio controls, which may feel like a broken button to impatient users.
- **Sequence clarity can improve.** Users may not understand whether they should finish/dismiss preflight before choosing mic/demo.
- **Status hierarchy is dense for first-run users.** Four capability sections in one block are useful for diagnostics, but heavy for someone who only wants to begin quickly.

### Improvements to consider
- Add a single prominent preflight action (“Continue to audio setup”) so next-step intent is explicit.
- Include one-line sequencing copy: “Step 1 of 2: quick compatibility check.”
- Offer a compact/default preflight summary with expandable technical detail.

---

## Priority recommendations (impact × effort)

1. **High impact / low effort:** Clarify flow sequencing between preflight and audio-start actions.
2. **High impact / low effort:** Improve zero-results recovery with actionable shortcuts.
3. **Medium impact / low effort:** Reduce hero CTA choice pressure by emphasizing one canonical “start now” action.
4. **Medium impact / medium effort:** Add “why matched” and facet filters to tighten discovery confidence.
