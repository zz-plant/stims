# Public docs site map and messaging alignment

This document captures what the public Stims docs communicate, so repository docs and web-facing copy can stay aligned.

## Core product message

Stim Webtoys is positioned as an **independent browser-native visualizer in the lineage of Ryan Geiss's MilkDrop**, with one flagship launch flow, one browse surface, and a smaller set of canonical toy detail pages.

## Public docs information architecture

### Documentation tab

- **Get Started**
  - `introduction`
  - `quickstart`
  - `browser-support`
- **Using Stims**
  - `guides/milkdrop-visualizer`
  - `guides/playing-toys`
  - `guides/audio-setup`
  - `guides/accessibility` *(planned public surface — content lives in [`docs/guides/accessibility.md`](./guides/accessibility.md) today, sourced from [`docs/SENSORY_ACCESSIBILITY.md`](./SENSORY_ACCESSIBILITY.md))*
  - `guides/performance`
- **Create Presets** *(planned public surface — content lives in `docs/authoring/` today)*
  - `create/learn` — the authoring curriculum (Tracks 0–8, live examples)
  - `create/reference` — the generated language reference
- **Browse**
  - `browse/overview`
  - `browse/featured`
  - `toys/:slug`

### Development tab

Repository documentation is hubbed in [`docs/README.md`](./README.md) across 6 core developer tracks:

1. **🚀 Getting Started**: `DEVELOPMENT.md`, `DEPLOYMENT.md`, `TESTING.md`, `COMMIT_CONVENTIONS.md`
2. **🏛️ Architecture & Engine**: `ARCHITECTURE.md`, `TECHNICAL_ACHIEVEMENTS.md`, `MILKDROP_PRESET_RUNTIME.md`, `WEBGPU_ARCHITECTURAL_REVAMP.md`
3. **🎨 Preset Authoring**: `authoring/README.md` (curriculum), `authoring/reference.md` (generated language reference), `MILKDROP_CODING_GUIDE.md`, `MILKDROP_PROJECTM_PARITY_PLAN.md`, `MILKDROP_PROJECTM_PARITY_BACKLOG.md`
4. **🤖 AI & Infrastructure**: `api.md`, `MCP_SERVER.md`
5. **📊 Strategy & QA**: `ROADMAP.md`, `IMPLEMENTATION_STATUS.md`, `QA_PLAN.md`, `LINEAGE_AND_CREDITS.md`
6. **♿ Accessibility & Sensory Research**: `SENSORY_ACCESSIBILITY.md`, `LITERATURE.md`

- **Contributing**
  - `contributing/getting-started`
  - `contributing/development-setup`
  - `contributing/code-quality`
- **Architecture**
  - `architecture/overview`
  - `architecture/technical-achievements`
  - `architecture/rendering`
  - `architecture/preset-runtime`
- **Deployment**
  - `deployment/overview`
  - `deployment/cloudflare-pages`

## What each public page emphasizes

- **Introduction**: MilkDrop-led value proposition and lineage framing, with quick links to launch and browse.
- **Quickstart**: launch MilkDrop first, then explore the broader library from one browse surface.
- **Browser support**: feature-level compatibility and troubleshooting for WebGL, microphone, and WebGPU.
- **MilkDrop visualizer guide**: presets, blending, the editor flow, import/export, and compatibility guardrails.
- **Playing toys**: browse/launch flow, filters, badges, and the toy detail path.
- **Audio setup**: microphone, demo audio, and tab-capture paths plus troubleshooting.
- **Accessibility**: motion comfort defaults, reduced-motion handling, and fallback controls.
- **Performance**: quality presets, persistent settings, and the performance panel.
- **Browse overview / toy pages**: one browse hub plus canonical toy detail pages instead of large taxonomy matrices.
- **Contributing getting started**: quality checks and commit/PR expectations.
- **Competitive messaging handoff**: external-safe value propositions derived from internal battlecards, avoiding direct competitor callouts.

## Repo alignment checklist

When updating user-facing copy (README, landing copy, docs hubs), keep these themes visible:

1. Audio-reactive + sensory-friendly positioning.
2. MilkDrop-led lineage framing with careful language (no blanket compatibility claims).
3. Clear onboarding path (`introduction` -> `quickstart` -> `browser-support`).
4. Explicit mention of accessibility and performance controls.
5. Discovery vocabulary for the broader toy library, without relying on large standalone taxonomy hubs.
6. Contributor expectations (quality gates, commit/PR metadata, docs consistency).
7. External copy should use internal battlecard outputs without public competitor callouts.
