# Public docs site map and messaging alignment

This document captures what the public Stims docs communicate, so repository docs and web-facing copy can stay aligned.

## Core product message

Stim Webtoys is positioned as **interactive, audio-reactive web toys built with Three.js/WebGL for sensory-friendly play**, with WebGPU paths for capable browsers.

## Public docs information architecture

### Documentation tab

- **Get Started**
  - `introduction`
  - `quickstart`
  - `browser-support`
- **Using Stims**
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

- **Introduction**: value proposition, key features (audio reactivity, sensory-friendly defaults, performance controls, WebGL/WebGPU support), and quick links.
- **Quickstart**: prerequisites, installation, local workflows, and troubleshooting.
- **Browser support**: feature-level compatibility and troubleshooting for WebGL, microphone, and WebGPU.
- **Playing toys**: browse/launch flow, filters, badges, and discovery utilities.
- **Audio setup**: microphone, demo audio, and tab-capture paths plus troubleshooting.
- **Accessibility**: motion comfort defaults, reduced-motion handling, and fallback controls.
- **Performance**: quality presets, persistent settings, and performance panel details.
- **Toy overview / category pages**: toy taxonomy by lifecycle, moods, tags, capabilities, and category-specific guidance.
- **Contributing getting started**: quality checks, commit/PR expectations, and docs consistency guidance.

## Repo alignment checklist

When updating user-facing copy (README, landing copy, docs hubs), keep these themes visible:

1. Audio-reactive + sensory-friendly positioning.
2. Clear onboarding path (`introduction` -> `quickstart` -> `browser-support`).
3. Explicit mention of accessibility and performance controls.
4. Discovery vocabulary (moods, tags, capabilities, featured/audio/interactive/WebGPU).
5. Contributor expectations (quality gates, commit/PR metadata, docs consistency).
