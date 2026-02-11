# UX audit (Constructive + Kondo-style)

Date: 2026-02-11  
Scope: Library home and toy shell (`/`, `/toy.html?toy=...`) in local dev.

## Method

- Reviewed desktop and mobile renders in local dev server.
- Focused on first-run clarity, interaction confidence, visual hierarchy, and friction.
- Framed recommendations using a **Kondo lens**:
  - **Remove**: delete low-value clutter.
  - **Move**: relocate useful elements to where users need them.
  - **Modify**: keep the intent but improve wording/behavior/priority.

## What currently sparks joy

1. **Fast orientation at the top of the library.** The page gives immediate context (“Stim library”), tags, and a primary CTA without hiding the experience behind marketing copy.
2. **Strong capability framing.** “Pick your starting mode” + “Check your device” reduce anxiety for users who are unsure whether their browser/device can run graphics/audio features.
3. **Toy shell safety rails are thoughtful.** The quick-check panel and direct fallback actions (“Back to library”, “Retry checks”) reduce dead ends when permissions or graphics fail.
4. **Visual language is cohesive.** Soft glow cards, rounded containers, and gentle gradients align with the sensory-play goal.

## Friction points (with Kondo actions)

### 1) Header and hero controls feel dense on first glance

- **Symptoms:** Many pills/toggles/actions compete in the same viewport band. On first load, users must parse navigation, filters, and onboarding cues at once.
- **Remove:**
  - Defer secondary chips in the top hero row that are not essential for first action.
  - Collapse low-frequency controls behind a “More filters” disclosure.
- **Move:**
  - Keep one dominant primary action in the hero (“Start browsing” or “Start with recommendations”) and move secondary utilities to below-the-fold anchor sections.
- **Modify:**
  - Convert parallel CTAs into a progressive sequence: primary CTA → optional refinement.

### 2) “Check your device” card competes with “Browse all stims” card

- **Symptoms:** Device diagnostics and discovery grid both look like primary content blocks. Users may pause before understanding where to click first.
- **Remove:**
  - Trim explanatory text in diagnostics to the shortest actionable sentence.
- **Move:**
  - Demote full diagnostics below the first set of toy cards, keeping only a compact status summary near the top.
- **Modify:**
  - Use explicit state labels: “Ready now”, “Works with fallback”, “Needs browser change”.

### 3) Search/filter area has high control count for first-time users

- **Symptoms:** Search input + multiple chips + selects + sorting controls appear together, increasing cognitive load.
- **Remove:**
  - Hide advanced filtering (multi-tag logic, rare capabilities) until user opts in.
- **Move:**
  - Keep only search + one high-impact filter row in the default view.
- **Modify:**
  - Add plain-language helper text under search, e.g., “Try ‘microphone’ or ‘calming’.”

### 4) Toy shell quick-check panel is useful but visually heavy

- **Symptoms:** On failure states, the right-side panel draws more attention than the central toy status message and can feel intimidating for non-technical users.
- **Remove:**
  - Remove deeply technical labels from default view (e.g., adapter details) unless user expands “Details”.
- **Move:**
  - Move contextual explanation right next to the primary action button users need now.
- **Modify:**
  - Reword from diagnostic-first to action-first copy: “You can continue with demo audio” / “Try browser X for full mode.”

### 5) Error state messaging can be gentler and more outcome-driven

- **Symptoms:** “Unable to load this toy” is clear but emotionally harsh, and the fix path can feel uncertain.
- **Remove:**
  - Remove stack-like implementation hints from primary copy in user-facing mode.
- **Move:**
  - Put “Try another toy” and “Open compatibility-friendly picks” at the same visual priority as “Back to library”.
- **Modify:**
  - Rewrite headings to “This toy couldn’t start here yet” with one-sentence next step.

### 6) Mobile top section still feels utility-first vs delight-first

- **Symptoms:** Small viewport shows compact controls quickly, but joy signal (visual preview / featured toy momentum) arrives late.
- **Remove:**
  - Reduce top-level button count on mobile by default.
- **Move:**
  - Move one featured playable card above deeper filter tooling.
- **Modify:**
  - Use a larger “Start now” touch target and one-line promise (“Best on your device right now”).

## Prioritized action plan

## Now (1–2 sprints)

1. **Simplify first screen hierarchy**: one primary CTA + condensed secondary options.
2. **Reduce default filter surface area** to search + essential chips.
3. **Refactor toy error copy** to action-oriented guidance with 2–3 obvious exits.

## Next (2–4 sprints)

1. **Progressive diagnostics**: compact summary by default, expandable technical details.
2. **Mobile-first onboarding strip** featuring one recommended toy with immediate launch.
3. **Consistent status taxonomy** across home and toy shell (Ready/Fallback/Unsupported).

## Later

1. Personalization memory (remember preferred mode and capabilities).
2. A/B test concise vs descriptive hero copy for first-run conversion.
3. Add lightweight “Why this recommendation?” transparency near suggested picks.

## Suggested UX success metrics

- Time to first toy launch (new visitors).
- First-session completion rate (toy successfully started).
- Filter interaction depth before launch (lower can mean clearer defaults).
- Bounce rate from toy error state.
- Mobile launch success vs desktop launch success.

## One-line Kondo north star

> Keep only the controls that help someone start delightfully in under 10 seconds; hide or defer everything else.
