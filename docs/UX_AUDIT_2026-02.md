# UX audit 2026-02 (Consolidated)

Date: 2026-02-11  
Scope: Library home and toy shell (`/`, `/toy.html?toy=...`) across desktop and mobile.

This file consolidates the baseline audit plus two same-day follow-up iterations. It supersedes the previous split docs and keeps only the most current recommendations.

## Method

- Reviewed local dev renders for first-run clarity, interaction confidence, hierarchy, and recovery from failure states.
- Used a Kondo lens for recommendations:
  - **Remove** low-value decision noise.
  - **Move** useful actions closer to user intent.
  - **Modify** wording and interaction priority for clearer outcomes.

## What improved over the iterations

1. Hero intent is clearer with one dominant launch action.
2. Discovery has better priority than diagnostics on first view.
3. Filter complexity is better staged via progressive disclosure.
4. Toy failure states now have more supportive recovery language.

## Current friction and consolidated actions

### 1) Hero and quick-start still partially duplicate first-step intent

- **Remove:** Extra first-fold quick-start options that recreate the same decision.
- **Move:** Secondary launch modes into optional “Explore modes” content.
- **Modify:** If quick-start remains, label as optional (for example “Or try”).

### 2) Search/filter controls are still dense before visual payoff

- **Remove:** Low-value default controls and verbose helper tokens.
- **Move:** Place “Refine results” after users see initial cards (especially on first session/mobile).
- **Modify:** Keep default controls to search + high-impact filters with outcome-first microcopy.

### 3) Advanced filters can still hide why results changed

- **Remove:** Duplicate state communication between hidden controls and active rows.
- **Move:** Show active advanced filters in one canonical “Applied filters” row, even when controls are collapsed.
- **Modify:** Auto-expand advanced controls when deep-linked advanced filters are present.

### 4) Diagnostics and system-check language remains too implementation flavored

- **Remove:** Technical terms from default, high-salience summaries.
- **Move:** Runtime-specific details under expandable “Details”.
- **Modify:** Use user-outcome labels first (for example “Runs in compatible mode”, “Microphone permission needed on start”).

### 5) Preflight/error action stacks still have competing priorities

- **Remove:** Equal visual weight for multiple CTAs in each state.
- **Move:** Keep one context-aware primary action per state and demote alternates.
- **Modify:** Match CTA text to best next step (for example “Browse compatible toys” when blocked).

### 6) Mobile first viewport is still utility-first instead of delight-first

- **Remove:** Extra helper copy lines in the first mobile viewport.
- **Move:** One featured playable card above heavier control rails.
- **Modify:** Keep one large “start now” touch target with reassurance copy.

## Priority roadmap

### Now (1 sprint)

1. De-duplicate first-step prompts (hero vs quick-start).
2. Reduce initial control density and keep active filters always visible.
3. Simplify preflight/error actions to one clear primary CTA per state.

### Next (1–2 sprints)

1. Move diagnostics and technical language behind progressive disclosure.
2. Reorder mobile layout so delight/launch appears before dense controls.
3. Normalize status taxonomy across home and toy shell (Ready/Fallback/Unsupported).

### Later

1. Personalize launch defaults using prior successful sessions.
2. Add lightweight, dismissible onboarding hints.
3. A/B test minimal hero-only launch vs hero + quick-start variants.

## Suggested success metrics

- First-action latency (landing → first click).
- Time to first successful toy launch.
- Control/filter interactions before first launch.
- Toy error recovery completion vs abandonment.
- Mobile first-session launch success.

## Kondo north star

> Keep one obvious next action in every viewport, and reveal everything else only when intent is explicit.
