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
