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
  - `guides/accessibility`
  - `guides/performance`
- **Browse**
  - `browse/overview`
  - `browse/featured`
  - `toys/:slug`

### Development tab

- **Contributing**
  - `contributing/getting-started`
  - `contributing/development-setup`
  - `contributing/code-quality`
- **Architecture**
  - `architecture/overview`
  - `architecture/toy-lifecycle`
  - `architecture/audio-system`
  - `architecture/rendering`
- **Building Toys**
  - `development/toy-development`
  - `development/toy-interface`
  - `development/testing-toys`
  - `development/toy-manifest`
- **Deployment**
  - `deployment/overview`
  - `deployment/cloudflare-pages`
  - `deployment/static-hosting`

## What each public page emphasizes

- **Introduction**: MilkDrop-led value proposition, lineage framing, and quick links to launch + browse.
- **Quickstart**: launch MilkDrop first, then explore the broader library from one browse surface.
- **Browser support**: feature-level compatibility and troubleshooting for WebGL, microphone, and WebGPU.
- **MilkDrop visualizer guide**: presets, blending, editor flow, import/export, and compatibility guardrails.
- **Playing toys**: browse/launch flow, filters, badges, and the toy detail path.
- **Audio setup**: microphone, demo audio, and tab-capture paths plus troubleshooting.
- **Accessibility**: motion comfort defaults, reduced-motion handling, and fallback controls.
- **Performance**: quality presets, persistent settings, and performance panel details.
- **Browse overview / toy pages**: one browse hub plus canonical toy detail pages instead of large taxonomy matrices.
- **Contributing getting started**: quality checks, commit/PR expectations, and docs consistency guidance.
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
