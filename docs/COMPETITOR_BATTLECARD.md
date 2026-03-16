# Competitor battlecard (Stims)

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

- **MilkDrop-led successor framing:** "Stims brings a browser-native MilkDrop successor to the web."
- **Careful claim language:** "Preset-driven and inspired by MilkDrop-era workflows, without claiming full legacy parity."
- **Instant launch:** "Open the MilkDrop Visualizer in one click, then branch into the broader toy lab."
- **Beyond one-off visuals:** "Explore a full collection with audio, motion, and performance controls."
- **Consistent UX across toys:** "One shared experience layer across MilkDrop and the rest of Stims."

## How this should change the site

Apply the external angle bank to public surfaces in this order:

1. **Homepage hero (`index.html`)**
   - Primary headline should position Stims as a browser-native MilkDrop successor.
   - Primary CTA should launch `toy.html?toy=milkdrop`.
   - Supporting sentence should reinforce presets, live editing, import/export, and careful successor language.
2. **Homepage proof + discovery sections (`index.html`)**
   - Add a MilkDrop proof section before broader toy-lab discovery.
   - Keep broader discovery language secondary and explicit.
3. **Metadata snippets (`index.html` OG/Twitter/description)**
   - Keep concise value proposition aligned with MilkDrop-led messaging and Stims branding.
4. **Public docs IA guidance (`docs/PUBLIC_DOCS_SITE_MAP.md`)**
   - Keep external-safe messaging rule explicit and successor wording consistent.

## Placement guidance (internal vs external)

- Keep direct competitor names and comparative weaknesses in this file only.
- Reuse the external angle bank in user-facing docs and homepage copy.
- When adding new comparisons, update both sections in the same change so positioning and copy stay aligned.
