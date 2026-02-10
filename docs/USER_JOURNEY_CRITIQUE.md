# Three typical user journeys: constructive critique

This pass traverses three common journeys reflected in the current QA plan and app-shell behavior, then critiques each journey with practical, incremental improvements.

## 1) Discover a toy quickly from the library

### Journey traversal
1. Open the library landing experience.
2. Use search to narrow the toy list.
3. Launch the top match with keyboard or click.

### What is already strong
- Discovery starts quickly: toy cards render immediately, and the same page supports direct launch without extra routing steps.
- Search behavior is forgiving and keyboard-friendly (Escape clears, Enter launches top result).
- Demo-audio launch is available from library cards, lowering the barrier for users who are not ready to grant microphone access.

### Constructive critique
- **Information scent is still metadata-first.** New users can read titles/descriptions, but they still infer setup friction themselves.
- **Search relevance is functional, not intent-aware.** A user typing “calm” versus “party” may want mood-weighted sorting, not just text match.
- **Demo mode is present but understated.** It exists as an action, but not always framed as the easiest first step.

### Recommended improvements
- Add a compact “Best for” label on each card (for example: _quiet solo_, _showcase visuals_, _mobile tilt_).
- Prioritize beginner-friendly toys in ambiguous searches by introducing a “low-setup first” boost.
- Elevate demo audio as a first-run recommendation on eligible cards (copy + subtle badge).

---

## 2) Start audio-reactive play when permissions are uncertain

### Journey traversal
1. Open a toy and choose an audio source.
2. Attempt microphone access.
3. Recover gracefully via retry or demo fallback when permission is denied/blocked/timed out.

### What is already strong
- The microphone flow communicates success/error state clearly and exposes fallback actions instead of dead ends.
- Retry behavior is considerate: labels and accessibility text recover to their original state after a successful retry.
- Demo fallback is treated as a real path, not a hidden failure mode.

### Constructive critique
- **Decision-time guidance is still light.** Users can choose mic or demo, but tradeoffs (privacy vs immediacy) are not always explicit at the decision point.
- **Advanced sources can feel “expert only.”** Users may not know when tab/YouTube-like capture options are better than demo.
- **Emotional framing can improve.** Permission failure copy is correct but could do more to reassure and keep momentum.

### Recommended improvements
- Add one-line comparative copy near source controls: “Mic reacts to your space; Demo starts instantly with no permissions.”
- Introduce contextual defaults (for example: if denied once, preselect demo next time in-session).
- Add brief “When to use this” helper text for advanced audio capture modes.

---

## 3) Switch toys while preserving performance comfort

### Journey traversal
1. Open settings/system panel and choose a quality preset.
2. Switch to another toy.
3. Confirm quality preference persists and visuals remain consistent with user intent.

### What is already strong
- Quality selection persists across panel reuse, reducing repetitive tuning.
- Preset subscriptions are predictable, with clean initial and change notifications.
- Stored presets improve continuity for users on constrained devices who need stable performance.

### Constructive critique
- **Preset intent is technical, not experiential.** Labels like “hi-fi” or “balanced” are useful but may not map directly to user goals.
- **Preset side effects are not always transparent.** Users may not understand what changed (pixel ratio, effects, responsiveness).
- **Cross-toy expectation setting could be clearer.** Persistence works, but users may not realize it is global by design.

### Recommended improvements
- Add short experiential subtitles to presets (for example: “Hi-fi: best visuals, higher battery use”).
- Show a tiny “what changed” summary after preset updates.
- Add “applies to all toys” helper text next to the preset control to reinforce consistency.

---

## Prioritization (impact vs effort)

1. **High impact / low effort:** clarify mic-vs-demo tradeoffs with concise inline copy.
2. **High impact / medium effort:** add card-level “Best for” labels and low-setup sorting bias.
3. **Medium impact / low effort:** annotate presets with experiential descriptions and scope.
4. **Medium impact / medium effort:** add contextual defaults after permission-denied outcomes.

These changes preserve the project’s playful feel while reducing cognitive friction for first-time and privacy-sensitive users.
