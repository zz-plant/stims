# Public docs site map and messaging alignment

This document captures what the public Stims docs communicate, so repository docs and web-facing copy can stay aligned.

## Core product message

Stim Webtoys is positioned as a **browser-native MilkDrop successor** with a broader collection of related audio-reactive toys, with WebGPU paths for capable browsers.

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
- **Toy Catalog**
  - `toys/overview`
  - `toys/featured`
  - `toys/audio-visualizers`
  - `toys/interactive-tools`
  - `toys/webgpu-toys`

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

- **Introduction**: MilkDrop-led value proposition, successor framing, and quick links to launch + browse.
- **Quickstart**: launch MilkDrop first, then explore the broader toy lab.
- **Browser support**: feature-level compatibility and troubleshooting for WebGL, microphone, and WebGPU.
- **MilkDrop visualizer guide**: presets, blending, editor flow, import/export, and compatibility guardrails.
- **Playing toys**: broader toy-lab browse/launch flow, filters, badges, and discovery utilities.
- **Audio setup**: microphone, demo audio, and tab-capture paths plus troubleshooting.
- **Accessibility**: motion comfort defaults, reduced-motion handling, and fallback controls.
- **Performance**: quality presets, persistent settings, and performance panel details.
- **Toy overview / category pages**: toy taxonomy by lifecycle, moods, tags, capabilities, and category-specific guidance.
- **Contributing getting started**: quality checks, commit/PR expectations, and docs consistency guidance.
- **Competitive messaging handoff**: external-safe value propositions derived from internal battlecards, avoiding direct competitor callouts.

## Repo alignment checklist

When updating user-facing copy (README, landing copy, docs hubs), keep these themes visible:

1. Audio-reactive + sensory-friendly positioning.
2. MilkDrop-led successor framing with careful language (no blanket compatibility claims).
3. Clear onboarding path (`introduction` -> `quickstart` -> `browser-support`).
4. Explicit mention of accessibility and performance controls.
5. Discovery vocabulary for the broader toy lab (moods, tags, capabilities, featured/audio/interactive/WebGPU).
6. Contributor expectations (quality gates, commit/PR metadata, docs consistency).
7. External copy should use internal battlecard outputs without public competitor callouts.
