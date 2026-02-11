# UX audit follow-up (Constructive + Kondo-style)

Date: 2026-02-11  
Scope: Post-implementation review of the library landing and toy shell.

## Method

- Reviewed current local dev renders for desktop and mobile (`/` and toy shell routes).
- Evaluated first-run clarity, hierarchy, interaction confidence, and friction recovery.
- Applied a Kondo lens to recommendations:
  - **Remove** low-value noise.
  - **Move** important actions where intent is highest.
  - **Modify** copy/interaction to reduce hesitation.

## What improved (and now sparks joy)

1. **Hero intent is clearer.** A single dominant “start now” CTA lowers the first-click decision burden.
2. **Filter complexity is better staged.** Progressive disclosure for advanced filters reduces immediate cognitive load.
3. **Diagnostics no longer steal the top funnel.** Moving full system-check content below browsing keeps discovery momentum.
4. **Toy failure actions are gentler.** “Try another toy” and “Browse compatible toys” make recovery less punishing.

## Remaining friction and recommendations

### 1) Quick-start section still duplicates first-step intent

- **Symptoms:** Hero already answers “what should I do first?”; “Pick your starting mode” repeats that decision and can reintroduce pause.
- **Remove:**
  - Remove one of the three quick-start cards from the default fold (prefer keeping Guided + Surprise).
- **Move:**
  - Move “Auto-flow mode” into a secondary “Explore modes” drawer below initial cards.
- **Modify:**
  - Add tiny confidence labels per card: “Easiest”, “Most playful”, “Hands-free”.

### 2) Search block is cleaner, but still visually dense near first cards

- **Symptoms:** Starter picks + search + filter row + advanced toggle still create a heavy control band before card browsing continues.
- **Remove:**
  - Remove “search scope” token list from default view (keep in help/tooltip).
- **Move:**
  - Move “Starter picks” above search on mobile only, so users can launch before parsing controls.
- **Modify:**
  - Change filter toggle label from “More filters” to “Refine results” for plain-language intent.

### 3) “More filters” can hide active context

- **Symptoms:** When advanced chips are active, users can lose visibility of why results are filtered if the panel is collapsed.
- **Remove:**
  - Remove hidden-state ambiguity by never hiding chips that are currently active.
- **Move:**
  - Move active advanced chips into the “Active” summary row even when advanced controls are collapsed.
- **Modify:**
  - Auto-open advanced controls if URL filter state includes advanced keys.

### 4) Device-readiness labels could be more outcome-based

- **Symptoms:** Current labels are clear but still system-ish (“Graphics acceleration”, “Motion comfort”).
- **Remove:**
  - Remove jargon-heavy phrasing where user outcome can be stated directly.
- **Move:**
  - Move detailed technical explanations behind “Details” only.
- **Modify:**
  - Translate to user outcomes: “Visual performance”, “Microphone access”, “Tilt controls”, “Low-motion mode”.

### 5) Toy error cards could provide one “smart next” action

- **Symptoms:** Recovery options are better, but users may still choose between two equal-weight exits without guidance.
- **Remove:**
  - Remove equal visual weight when one path is contextually best.
- **Move:**
  - Move “Best next step” to primary and demote alternate option.
- **Modify:**
  - Context-aware primary button copy:
    - compile/import issue → “Open another toy now”
    - capability issue → “Show compatible toys”.

### 6) Mobile experience still needs a stronger joy-above-controls moment

- **Symptoms:** Mobile first viewport remains action-safe but still control-forward.
- **Remove:**
  - Remove one secondary line in hero helper copy on mobile.
- **Move:**
  - Move a single featured toy card (with thumbnail + one tap CTA) directly below hero.
- **Modify:**
  - Add one-liner reassurance: “Designed to run smoothly on this device.”

## Priority roadmap

### Now (1 sprint)

1. Keep active advanced filters visible even when controls collapse.
2. Reduce quick-start card count in first fold.
3. Improve label language from system terms to user outcomes.

### Next (1–2 sprints)

1. Mobile ordering: featured launch card before full search controls.
2. Context-aware primary recovery action on toy error cards.
3. Rename and refine filter toggle copy (“Refine results”).

### Later

1. Personalize first CTA using last successful launch mode.
2. Add lightweight onboarding coachmarks that dismiss permanently.
3. Run A/B tests on quick-start card count and hero helper microcopy.

## Suggested metrics to validate this pass

- Time to first successful toy launch (new and returning users).
- Search/control interactions before first launch (aim lower for first-run users).
- Advanced-filter usage rate vs launch conversion.
- Toy error recovery rate (exit vs successful re-entry).
- Mobile first-session launch success.

## Kondo north star (follow-up)

> Keep only what helps users launch delightfully in one confident tap, and reveal everything else only when they ask for it.
