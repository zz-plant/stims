# Agent playtest report: making Stim more fun and stimulating

> Historical context note (2026-03): This document predates the MilkDrop-led repositioning. Treat it as historical playtest context rather than the current product-positioning baseline.

_Date:_ 2026-02-11  
_Tester:_ GPT agent (rapid exploratory playtest)

## Scope and method

This pass focused on the **first 2 minutes** of use, where delight and stimulation are either established or lost.

I ran a local dev server and did a lightweight browser-driven session across:

- Library landing page (`/`).
- Toy shell with representative toys:
  - `holy`
  - `bubble-harmonics`
  - `pocket-pulse`

I looked for:

- Time-to-delight (how quickly users can get a rewarding reaction).
- Choice friction (how hard it is to pick a toy and start playing).
- Discoverability of high-reward actions (audio, touch, movement, presets).

## What already works well

- **Fast perceived startup:** tested toys felt ready in about 1–2 seconds locally.
- **Consistent control shell:** once users learn one toy, interaction patterns transfer.
- **Early capability language:** mic/demo-audio cues are present near core controls.

## Key gaps that reduce stimulation

1. **Too much initial choice** on entry (especially for new users).
2. **No immediate “high-energy default”** for users who want an instant wow moment.
3. **Limited first-session guidance** toward toy-specific “aha” interactions.

## Prioritized recommendations

### P0 (ship first): fast novelty and instant intensity

1. **Add a one-tap `Surprise me` launcher on the homepage hero**
   - Why: removes decision paralysis and increases novelty.
   - Suggested behavior: pick from toys tagged for high responsiveness and device compatibility.
   - Success signal: lower time-to-first-toy-start.

2. **Add a global `Party mode` preset in the toy shell**
   - Why: one-click intensity boost for users seeking immediate stimulation.
   - Suggested default mapping:
     - higher motion/tempo
     - brighter palette
     - medium bloom / visual richness
   - Success signal: more control interactions in first 60 seconds.

### P1 (next): playful direction and retention

3. **Add first-load micro-goals (10–20 seconds each)**
   - Example prompts:
     - “Make it pulse faster.”
     - “Find the calm palette.”
     - “Trigger a split.”
   - Why: gives playful direction without heavy onboarding.
   - Success signal: higher completion of at least one guided action.

4. **Add `Best with` capability chips near start CTAs**
   - Examples: `🎤 Mic`, `👆 Touch`, `🎧 Demo audio`, `🧭 Motion`.
   - Why: better expectation setting = faster path to the strongest mode for the current device.
   - Success signal: increased use of capability-appropriate toys.

### P2 (deeper investment): sustained stimulation sessions

5. **Session playlist / auto-rotate mode**
   - Rotate toys every 60–120 seconds.
   - Optional transition style: soft crossfade between toy cards/views.
   - Why: preserves novelty for ambient or hands-off sessions.

6. **Optional beat-synced haptics on supported mobile devices**
   - Keep off by default with clear consent toggle.
   - Why: synchronized tactile + visual feedback can materially increase embodied stimulation.

## Candidate A/B experiment (small and high-confidence)

Test on homepage hero:

- **Variant A:** current controls.
- **Variant B:** current controls + `Surprise me` + `Party mode` entry point.

Track:

- Time to first interaction.
- Number of toys visited per session.
- Session duration.
- Return-session rate.

## Implementation notes (to reduce build risk)

- Start with existing metadata/capabilities to drive `Surprise me` toy selection.
- Reuse shared settings architecture for `Party mode` before adding toy-specific tuning.
- Keep micro-goals content-driven where possible (config/data), not hardcoded per toy.

## Suggested execution order

1. Ship `Surprise me`.
2. Ship `Party mode`.
3. Add micro-goals for top 5 most-used toys.
4. Expand into playlist mode and optional haptics.
