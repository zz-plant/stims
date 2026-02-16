# Screenshot critique (2026-02-16)

This pass reviews key user-facing surfaces observed in local screenshots:

- Homepage hero + navigation + library controls
- Library card grid section
- Toy runtime preflight (“Quick check”) panel

## What works well

1. **Strong visual cohesion**
   - The frosted cards, soft borders, and subtle glow effects create a recognizable visual language that feels calm and intentionally “stim-forward.”
2. **Clear top-level entry point**
   - The hero’s “Start now” CTA is prominent and paired with secondary options (“Browse all stims”, “Surprise me”), which supports both directed and exploratory behavior.
3. **High scannability in the library**
   - Card titles, short descriptions, and capability pills (Mic, Demo audio, Motion) make it easy to compare toys quickly.
4. **Thoughtful runtime preflight concept**
   - The Quick check panel communicates compatibility and microphone expectations before launch, reducing surprise for permission-sensitive features.

## Constructive critique and improvement opportunities

1. **Contrast and readability in light mode could be stronger**
   - Several text elements (helper copy, muted pill labels, secondary descriptions) appear very low-contrast on gray backgrounds.
   - Recommendation: raise text contrast for secondary body copy and chip labels to improve accessibility and quick scanning.

2. **Above-the-fold hierarchy feels slightly compressed**
   - The nav, hero, and library heading stack tightly; the “Start now” card appears visually detached from the following “Browse all stims” heading.
   - Recommendation: increase vertical rhythm between hero and library heading, or add a subtle transitional label/anchor.

3. **Filter controls need stronger active-state clarity**
   - In the library controls, selected vs unselected filter chips are visually close in tone.
   - Recommendation: add a more distinct active treatment (fill, border weight, icon, or checkmark) so state changes are obvious at a glance.

4. **Runtime preflight panel has high information density**
   - The right-side Quick check panel is useful but text-heavy, with multiple similarly styled boxes and CTAs.
   - Recommendation: collapse lower-priority details by default and emphasize a single primary action path (“Continue to audio setup”).

5. **Whitespace balance in large viewports**
   - On wide screens, the toy runtime view leaves a large empty canvas area while controls remain constrained in a narrow right column.
   - Recommendation: consider contextual hints/preview content on the left before toy initialization, or a centered preflight layout prior to playback.

6. **Card action labels could be more outcome-specific**
   - Repeated “Play demo” labels are understandable but generic.
   - Recommendation: augment with contextual verbs where useful (e.g., “Preview motion”, “Try mic mode”), while keeping terminology consistent.

## Suggested prioritization

- **High impact / low effort**: improve text contrast and filter active states.
- **Medium effort**: simplify Quick check information architecture and CTA emphasis.
- **Higher effort**: refine wide-screen runtime layout strategy before toy start.
