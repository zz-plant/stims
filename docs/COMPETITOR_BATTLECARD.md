# Competitor battlecard (Stims)

> Historical context note (2026-03): This document started under the broader multi-toy positioning. Keep it as strategy context only, and align any reused public copy with the current MilkDrop-led `/milkdrop/` product model before shipping it.

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

- **MilkDrop-led lineage framing:** "Stims brings an independent browser-native visualizer in the lineage of Ryan Geiss's MilkDrop to the web."
- **Careful claim language:** "Preset-driven and inspired by MilkDrop-era workflows, without claiming full legacy parity."
- **Instant launch:** "Open the MilkDrop Visualizer in one click and land in the dedicated launchpad."
- **Beyond one-off visuals:** "Explore curated presets with audio, motion, and performance controls."
- **Consistent UX across sessions:** "One shared experience layer across launch, preset browse, live editing, and playback."

## How this should change the site

Apply the external angle bank to public surfaces in this order:

1. **Homepage hero (`index.html`)**
   - Primary headline should position Stims as an independent browser-native visualizer in the MilkDrop lineage.
   - Primary CTA should launch `/milkdrop/`.
   - Supporting sentence should reinforce presets, live editing, import/export, and careful lineage language.
2. **Homepage proof + launchpad sections (`index.html`)**
   - Add a MilkDrop proof section before secondary browse/discovery content.
   - Keep launchpad and preset-browse language secondary to the flagship visualizer framing.
3. **Metadata snippets (`index.html` OG/Twitter/description)**
   - Keep concise value proposition aligned with MilkDrop-led messaging and Stims branding.
4. **Public docs IA guidance (`docs/PUBLIC_DOCS_SITE_MAP.md`)**
   - Keep external-safe messaging rule explicit and successor wording consistent.

## Placement guidance (internal vs external)

- Keep direct competitor names and comparative weaknesses in this file only.
- Reuse the external angle bank in user-facing docs and homepage copy.
- When adding new comparisons, update both sections in the same change so positioning and copy stay aligned.
