# UX audit iteration 2 (Constructive + Kondo-style)

Date: 2026-02-11  
Scope: Current library landing, search/filter stack, and toy preflight/error entry flow.

## Method

- Reviewed local desktop and mobile renders on current branch after recent UX refactors.
- Focused on first-click confidence, discoverability, control density, and failure recovery clarity.
- Recommendations use a Kondo lens:
  - **Remove** what adds decision noise.
  - **Move** what is useful but misplaced.
  - **Modify** what is good but needs clearer intent.

## What’s working better now

1. **Top-of-page decision load is materially lower.** The hero has one dominant action and a cleaner hierarchy.
2. **Discovery is prioritized over diagnostics.** Putting full system check below the library keeps momentum.
3. **Filter controls are more staged.** Progressive reveal helps avoid overwhelming first-time users.
4. **Recovery language is gentler than before.** Toy-start failures are less abrupt and offer alternatives.

## Remaining friction (remove / move / modify)

### 1) Quick-start and hero still duplicate the same decision

- **Symptoms:** Hero says “start now,” then quick-start asks users to choose another path immediately.
- **Remove:**
  - Remove the “Quick start” heading block on desktop once hero CTA is visible above the fold.
- **Move:**
  - Move “Surprise stim” into a compact inline option next to the hero secondary link.
- **Modify:**
  - If quick-start remains, rename it to “Or try” to signal optionality instead of another required decision.

### 2) Search/filter rail still feels control-heavy before delight

- **Symptoms:** Starter picks + search + filters + refine controls create a dense command center before visual payoff.
- **Remove:**
  - Remove one starter pick from default desktop row (keep 2 max).
- **Move:**
  - Move “Refine results” after initial card row for first-time sessions (can reappear sticky after scroll).
- **Modify:**
  - Add placeholder microcopy tuned to outcomes (“Try calming, rhythm, or microphone”).

### 3) Refine toggle state can still hide why results changed

- **Symptoms:** Advanced chips can remain hidden unless active, but users still may not understand source-of-truth between active row and hidden controls.
- **Remove:**
  - Remove duplicated state communication between chips and active-filter badges.
- **Move:**
  - Move advanced active chips exclusively into the Active row when collapsed, and keep filter rail itself minimal.
- **Modify:**
  - Rename “Active” row label to “Applied filters” for clarity.

### 4) System-check labels improved, but status language is still implementation-flavored

- **Symptoms:** Some status copy remains technical (“WebGL fallback”, “Secure context”) in high-salience panel states.
- **Remove:**
  - Remove backend terminology from the default collapsed status summaries.
- **Move:**
  - Move backend/runtime details under “Details” only.
- **Modify:**
  - Use user-outcome summaries first, e.g.:
    - “Runs in compatible mode”
    - “Microphone will ask permission when you start”
    - “You can continue now”

### 5) Preflight modal action stack is still too equal-weight

- **Symptoms:** “Improve performance”, “Back to library”, “Continue to audio setup”, and “Retry checks” all compete visually in a compact area.
- **Remove:**
  - Remove one secondary CTA from default state (suggest hiding “Improve performance” unless low-power condition is detected).
- **Move:**
  - Move “Retry checks” to inline text action below statuses.
- **Modify:**
  - Keep one primary action per state:
    - Ready → “Continue to audio setup”
    - Blocked → “Browse compatible toys”

### 6) Mobile first viewport still under-delivers immediate delight

- **Symptoms:** Mobile screens remain clear but utilitarian; emotional “wow” arrives after scroll.
- **Remove:**
  - Remove one line of helper/supporting text in hero on small screens.
- **Move:**
  - Move one visual featured-card preview directly below hero CTA (before quick-start/search).
- **Modify:**
  - Add one sentence reassurance: “Optimized for this device right now.”

## Prioritized recommendations

### Now (high impact, low-medium effort)

1. De-duplicate hero vs quick-start decision prompts.
2. Reduce starter picks to two and demote refine controls for first session.
3. Simplify preflight actions to one dominant CTA per state.

### Next

1. Consolidate active-filter communication into one canonical location.
2. Shift default preflight copy fully to outcome-first language.
3. Add mobile featured visual card ahead of utility controls.

### Later

1. Personalize launch affordances based on previous successful toy types.
2. Session-aware UI that starts minimal and progressively unlocks controls.
3. A/B test “hero-only launch” vs “hero + quick-start.”

## Suggested metrics for this iteration

- First-action latency (landing view → first click).
- Time to first successful toy start.
- Scroll depth before first toy launch.
- Refine-controls open rate vs launch conversion.
- Preflight modal completion vs abandonment rate.

## Kondo north star (iteration 2)

> Keep one obvious next action in every viewport; defer every other control until intent is explicit.
