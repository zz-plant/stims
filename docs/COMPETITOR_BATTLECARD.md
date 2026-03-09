# Competitor battlecard (Stim Webtoys Library)

This doc intentionally separates **internal strategy content** from **external-safe messaging** so teams can reuse the same research without leaking direct competitor framing into public copy.

## Internal use: competitor battlecard table

Use this table for positioning, GTM planning, and sales/support alignment.

| Competitor | Segment | Primary buyer/user | Strongest claim | Weakest point vs Stims |
| --- | --- | --- | --- | --- |
| ShaderToy | Browser shader playground / creative coding community | Creative coders, shader artists, technical hobbyists | Largest ecosystem for real-time GLSL experimentation and remixing | Not a guided sensory-first toy library; higher technical barrier and less onboarding for audio/touch play |
| Silk (Weavesilk) | Casual calming visual toy | General consumers seeking quick, soothing interaction | Ultra-low-friction, beautiful immediate interaction | Single-mode drawing experience with limited depth, discovery, and capability-aware pathways |
| Cables.gl | Node-based real-time visual tooling | Motion designers, VJs, interactive studios | Powerful visual programming for complex interactive WebGL/WebGPU scenes | More of a creator tool than a ready-to-play toy destination for non-technical users |
| Butterchurn / Winamp-style web visualizers | Music visualizer apps | Music listeners who want reactive visuals during playback | Strong music-reactive visuals with familiar visualizer expectations | Usually focused on playback visualization, not multi-toy discovery, guided capability checks, or touch-first interaction |
| OpenProcessing (p5.js ecosystem) | Creative coding sketch community | Students, educators, creative coders | Massive catalog of community sketches and remix culture | Quality/UX consistency varies; not optimized as a cohesive sensory-first product experience |

## External use: homepage copy angle bank

Use these lines in public-facing pages (README/site/docs) without naming competitors directly.

- **No-code instant play:** "Play audio-reactive visual toys instantly—no shader coding required."
- **Beyond one-off visuals:** "Explore a full collection with audio, motion, and performance controls."
- **Curated over complex tooling:** "A ready-to-play sensory playground, designed for fast exploration."
- **More than a visualizer:** "Discover interactive toys for sound, touch, and motion in one place."
- **Consistent UX across toys:** "One shared experience layer across many playful, audio-reactive scenes."

## How this should change the site

Apply the external angle bank to public surfaces in this order:

1. **Homepage hero (`index.html`)**
   - Primary headline should emphasize instant play.
   - Supporting sentence should mention sound/touch/motion and low friction.
2. **Homepage discovery section (`index.html`)**
   - Section description should reinforce breadth (collection + capabilities).
3. **Metadata snippets (`index.html` OG/Twitter/description)**
   - Keep concise value proposition aligned with no-code, instant-play messaging.
4. **Public docs IA guidance (`docs/PUBLIC_DOCS_SITE_MAP.md`)**
   - Keep external-safe messaging rule explicit.

## Placement guidance (internal vs external)

- Keep direct competitor names and comparative weaknesses in this file only.
- Reuse the external angle bank in user-facing docs and homepage copy.
- When adding new comparisons, update both sections in the same change so positioning and copy stay aligned.
