<div align="center">

# Stims

**Browser music visualizer — one click to moving visuals, deep editor + AI when you want more.**

[![Live site](https://img.shields.io/badge/live-toil.fyi-5a67d8?style=flat-square&logo=cloudflare)](https://toil.fyi)
[![GitHub stars](https://img.shields.io/github/stars/zz-plant/stims?style=flat-square)](https://github.com/zz-plant/stims/stargazers)
[![License](https://img.shields.io/github/license/zz-plant/stims?style=flat-square)](./LICENSE)
[![Built with Bun](https://img.shields.io/badge/bun-1.3+-14151a?style=flat-square&logo=bun)](https://bun.sh)
[![Discussions](https://img.shields.io/badge/discussions-welcome-8b5cf6?style=flat-square)](https://github.com/zz-plant/stims/discussions)

</div>

<p align="center">
  <em>Demo audio in one click. 1,868 presets, live mic/tab input, AI generation, and a full code editor with autocomplete.</em>
</p>

---

## Try it now

**[→ Launch at toil.fyi](https://toil.fyi)** — no install, no signup. Click play.

---

## What it does

**Instant visuals.** One click plays demo audio and mounts a moving visualizer. No setup. The hero CTA floats over the running stage.

**1,868 presets** imported from the Butterchurn / projectM archive. Browse, preview cards, one-tap playback. Filter, shuffle, favorite.

**AI preset generation.** Describe what you want in plain English — "neon waves pulsing through a starfield" — and the AI writes the MilkDrop equations. Batch mode generates 5 variations in parallel. Blending combines the motion of one preset with the color of another.

**AI-assisted editor.** Full CodeMirror 6 editor with 60+ MilkDrop autocompletions, syntax highlighting, bracket matching, search, foldable sections, clickable diagnostics, 14 code snippets, and an "Explain this preset" mode. Slider sidebar for live visual tuning (zoom, warp, rot, decay, hue). Quick Fix sends compiler errors to the AI for automatic correction.

**Live audio.** Microphone, browser tab capture, or YouTube tab routing. Demo audio engine (arpeggiator + kick drum + sub drone) always available.

**Visual search.** Click "More like this" on any preset to find visually similar ones via embedding cosine similarity. Audio match chip appears when audio is active, suggesting presets that fit the energy level.

**Community gallery.** Browse, upload, and favorite presets from other users. Lineage badges show blend ancestry.

**Mobile support.** Bottom control bar with macro mood buttons (Chill, Retro, Aggressive, Cosmic), touch-friendly browse drawer, swipe-friendly preset grid.

**Performance controls.** Render resolution (100/75/50%), shader detail slider, eco mode (30 FPS cap). Quality presets for casual users, granular sliders for advanced users.

**Keyboard shortcuts.** Press `?` for the full overlay. Space → audio, F → fullscreen, B → browse, E → editor, N → next preset, Cmd+Enter → compile.

---

## Install locally

```bash
git clone https://github.com/zz-plant/stims.git
cd stims
bun install
bun run dev
```

Open `http://localhost:5173`.

**Prerequisites:** [Bun](https://bun.sh) 1.3+, a browser with WebGL (WebGPU optional).

See [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) for setup, troubleshooting, and production builds.

---

## Quick reference

```
bun run dev           Start development server
bun run check:quick   Fast quality gate (lint + types)
bun run check         Full quality gate (lint + types + tests)
bun run build         Production build
bun run test          Run unit/integration tests
bun run preview       Preview production build locally
```

---

## API

All endpoints at `https://toil.fyi/api/`. Full docs in [docs/api.md](./docs/api.md).

| Endpoint | Description |
|----------|-------------|
| `POST /api/generate-preset` | Text → MilkDrop equations with AI model routing |
| `POST /api/refine-preset` | Modify existing preset, explain mode, conversation history |
| `POST /api/batch-generate` | N parallel variations from one description |
| `POST /api/blend-presets` | Combine two presets (motion from A, color from B) |
| `POST /api/image-to-preset` | Screenshot → describe → generate |
| `POST /api/visual-search` | Semantic search via BGE embeddings + D1 cosine similarity |
| `POST /api/model-router` | Classify complexity, route to optimal model (7 models) |
| `GET/POST /api/presets` | Community gallery CRUD with D1 + R2 storage |

---

## Contributing

PRs welcome. Start with [CONTRIBUTING.md](./CONTRIBUTING.md).

Questions? [GitHub Discussions](https://github.com/zz-plant/stims/discussions).

---

## Project docs

- [Development guide](./docs/DEVELOPMENT.md)
- [Architecture overview](./docs/ARCHITECTURE.md)
- [MilkDrop coding guide](./docs/MILKDROP_CODING_GUIDE.md) — patterns from the top 1%
- [Preset runtime docs](./docs/MILKDROP_PRESET_RUNTIME.md)
- [API reference](./docs/api.md)
- [Lineage and credits](./docs/LINEAGE_AND_CREDITS.md)

---

## Ecosystem

- [**Refract**](https://github.com/refract-org/refract) — Agent-readable knowledge change infrastructure
- [**sabnzbd-mcp**](https://github.com/zz-plant/sabnzbd-mcp) — MCP server for SABnzbd
- [**ethotechnics.org**](https://github.com/zz-plant/ethotechnics.org) — Ethical technology and human-centered design
