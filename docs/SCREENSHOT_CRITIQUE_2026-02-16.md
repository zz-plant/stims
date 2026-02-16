# Screenshot critique (2026-02-16)

This pass reviews important user-facing pages/sections from a local dev build (`bun run dev:host`):

1. Homepage + top navigation + hero call-to-action
2. Library controls + filter/search panel
3. Library card grid (discovery/scanning section)
4. Toy runtime “Quick check” preflight + performance controls side panel

## What is working well

1. **Consistent visual language across surfaces**
   - Rounded containers, frosted panels, and soft glow accents create a coherent “calm-tech” personality.
   - The style carries from discovery (library) to runtime preflight, which reduces context switching.

2. **Strong discoverability in the library**
   - The grid makes breadth obvious quickly, and each card presents enough metadata to compare options without entering a detail page.
   - Capability pills provide practical clues (mic/demo/responsive) at scan speed.

3. **Good safety framing before runtime start**
   - The “Quick check” preflight sets expectations before microphone prompts and renderer-intensive work.
   - The performance controls panel is visible and explicit, helping users adapt quality to device limits.

## Constructive critique

1. **Top-of-page hierarchy is visually compressed**
   - The nav, hero CTA, and “Browse all stims” transition sit close together with limited separation cues.
   - Suggestion: increase vertical spacing or add a subtle divider/section lead-in between hero and catalog.

2. **Secondary text contrast is low in bright theme contexts**
   - Helper copy and some muted labels are hard to parse at a glance.
   - Suggestion: raise contrast on non-primary text tokens and chip labels to improve readability and accessibility.

3. **Filter state clarity can be stronger**
   - Active vs inactive chips are currently close in treatment.
   - Suggestion: use a more explicit active state (icon/checkmark, stronger fill, border weight, or tone shift).

4. **Grid density risks scan fatigue on large viewports**
   - Many similarly weighted cards appear in a long uninterrupted list.
   - Suggestion: introduce stronger grouping affordances (featured row, category separators, or optional compact/detail toggle).

5. **Runtime preflight has high cognitive load**
   - Quick check + heads-up + details + multiple actions + performance panel compete for attention.
   - Suggestion: simplify first-run emphasis to a single primary action with progressive disclosure for advanced controls.

6. **Action wording can be more outcome-oriented**
   - Repeating generic “play/demo” style labels can reduce decision confidence.
   - Suggestion: tune CTA copy toward expected outcome (e.g., “Preview with demo audio,” “Start mic-reactive mode”).

## Prioritized recommendations

- **High impact / low effort:** increase secondary-text contrast and strengthen filter active state styling.
- **Medium effort:** tighten above-the-fold spacing rhythm and reduce preflight information density.
- **Higher effort:** improve large-screen catalog grouping strategy and refine runtime-first action hierarchy.
