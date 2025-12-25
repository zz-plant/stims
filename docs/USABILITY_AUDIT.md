# Usability audit (non-a11y)

## Scope and method
- Reviewed the landing page library experience (`index.html`) and the shared toy entry flow (`toy.html`).
- Focused on discovery, expectation-setting, and task flow clarity rather than accessibility checks.

## Findings and recommendations

1) **Library search promises more breadth than it delivers**  
The search hint invites vibe-based queries (e.g., "aurora," "fractal," "WebGPU"), but the filter only matches toy titles and descriptions, so many mood keywords or capability terms return no results. This can make the search feel broken and forces users to guess exact phrasing.  
**Recommendation:** add structured metadata (tags, capabilities, moods) to `toys.json` and include those fields in the filter, then surface match highlights or a results count so users know the query worked.  
**Evidence:** search input copy and placeholder; filtering logic limited to `title` and `description`.【F:index.html†L231-L350】

2) **No empty-state guidance after filtering**  
When a search returns zero matches, the grid simply disappears with no feedback or way to reset, which feels like a broken page.  
**Recommendation:** render a friendly "No matches" state with a clear reset control and maybe a couple of suggested queries to keep users moving.  
**Evidence:** the filter repaints the list but does not handle empty results or render a reset affordance.【F:index.html†L339-L351】

3) **Capability and input requirements are hidden until after click-through**  
Library cards only show a WebGPU badge; they omit microphone or device-motion expectations even though toys require audio to start, so users only learn about the permission prompt after landing on the toy page.  
**Recommendation:** add requirement badges (e.g., Mic, Motion, Demo audio available) to each card so users can pick experiences that fit their current context.  
**Evidence:** card rendering adds only the WebGPU badge; microphone requirement is only revealed on the toy page’s "Start audio" panel.【F:index.html†L312-L325】【F:toy.html†L11-L27】

4) **Demo-audio option is tucked away instead of being a first-class choice**  
People who want to try a toy without granting mic access cannot choose demo audio from the initial control panel because the fallback button starts hidden and only appears when error handling toggles it. That delays exploration and may cause abandonment at the permission prompt.  
**Recommendation:** present both "Use microphone" and "Use demo audio" as parallel primary buttons by default, with concise copy about what each does.  
**Evidence:** the fallback button is rendered but hidden by default in the toy entry UI, leaving only the mic-based CTA visible on first load.【F:toy.html†L11-L27】
