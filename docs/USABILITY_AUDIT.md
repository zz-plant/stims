# Usability audit (non-a11y)

## Scope and method

- Reviewed the landing page library experience (`index.html`) and the shared toy entry flow (`toy.html`).
- Focused on discovery, expectation-setting, and task flow clarity rather than accessibility checks.

## Findings and recommendations

1. **Library search scope vs. copy alignment**  
   The search haystack now matches titles, slugs, descriptions, tags, moods, capability terms, and the WebGPU marker, which supports the broader discovery copy. The UX risk now is stale placeholder/hint copy if the indexed terms change.  
   **Recommendation:** keep the search hint/placeholder aligned with the `library-view` haystack fields whenever metadata or filter logic changes, and consider adding match highlighting to reinforce the coverage.  
   **Status:** resolved; haystack includes tags, moods, and capability terms in the live filter logic.【F:assets/js/library-view.js†L1284-L1312】

2. **Empty-state guidance after filtering**  
   The library now renders a “No stims match your search or filters” empty state with a reset control, which solves the “blank grid” failure mode.  
   **Recommendation:** keep the empty-state copy short and ensure the reset button remains visible and focusable when filters or query strings are active.  
   **Status:** resolved; empty state and reset UI are rendered in the library view.【F:assets/js/library-view.js†L1739-L1755】

3. **Capability and input requirements are hidden until after click-through**  
   Library cards only show a WebGPU badge; they omit microphone or device-motion expectations even though toys require audio to start, so users only learn about the permission prompt after landing on the toy page.  
   **Recommendation:** add requirement badges (e.g., Mic, Motion, Demo audio available) to each card so users can pick experiences that fit their current context.  
   **Evidence:** card rendering adds only the WebGPU badge; microphone requirement is only revealed on the toy page’s "Start audio" panel.【F:index.html†L312-L325】【F:toy.html†L11-L27】

4. **Demo-audio option is tucked away instead of being a first-class choice**  
   People who want to try a toy without granting mic access cannot choose demo audio from the initial control panel because the fallback button starts hidden and only appears when error handling toggles it. That delays exploration and may cause abandonment at the permission prompt.  
   **Recommendation:** present both "Use microphone" and "Use demo audio" as parallel primary buttons by default, with concise copy about what each does.  
   **Evidence:** the fallback button is rendered but hidden by default in the toy entry UI, leaving only the mic-based CTA visible on first load.【F:toy.html†L11-L27】

## Mobile journey walkthrough (iPhone 13 viewport)

### Journey 1: “I just want to try something fast” (Library → Play demo now)

- **Path tested:** open library on mobile, tap `Play demo now` from the first visible card.
- **Observed behavior:** this flow is quick and low-friction; the card-level action opens the toy flow directly via `openToy(toy, { preferDemoAudio: true })`, which keeps momentum high for first-time users on phones.
- **Constructive critique:** in practice, users enter an in-page toy state with no obvious close affordance at the top of the viewport. This can feel modal-like, but without a clearly signposted “exit” in the same visual zone as the start controls.
- **Recommendation:** add a persistent top-row “Back to library”/“Close toy” action inside the initial mobile viewport whenever `?toy=` is active, so users do not need to hunt for escape routes.
- **Evidence:** card-level `Play demo now` action wiring and toy-opening behavior in the library renderer.【F:assets/js/library-view.js†L1947-L1957】【F:assets/js/library-view.js†L1739-L1748】

### Journey 2: “I’m filtering to find the right stim for this moment” (Search → No matches → recover)

- **Path tested:** enter a no-match mobile query, review empty state, attempt to recover to a full list.
- **Observed behavior:** empty-state messaging is explicit and supportive, and it includes one-tap recovery plus suggested follow-up searches.
- **Constructive critique:** there are now multiple recovery choices (`Reset search and filters` plus suggested query chips). On small screens, this can add decision overhead when users are already in an error-recovery mindset.
- **Recommendation:** keep the primary reset action visually dominant and demote suggestion chips behind a “Try suggestions” disclosure on narrow viewports.
- **Evidence:** empty-state copy, reset CTA, and suggested query buttons are rendered together in the fallback state.【F:assets/js/library-view.js†L2010-L2050】

### Journey 3: “I’m browsing in one hand and rotating my phone” (Portrait → landscape continuity)

- **Path tested:** load library in portrait, rotate to landscape, continue scanning controls/content.
- **Observed behavior:** controls remain functional, but the header/hero region can consume a large share of vertical space in landscape. This pushes card content and actionable controls below the fold, increasing scroll before interaction.
- **Constructive critique:** this is not a blocker, but it weakens “quick pick” ergonomics in short-height mobile contexts.
- **Recommendation:** apply a landscape+short-height compaction mode (reduced hero spacing, condensed nav blocks, and earlier exposure of library controls/cards) for better first-action visibility.
- **Evidence:** current mobile breakpoints optimize max-width, but there is no dedicated landscape/short-height compaction rule in the existing responsive blocks shown here.【F:assets/css/index.css†L3041-L3116】
