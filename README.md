# Stims

[![Live site](https://img.shields.io/badge/live-no.toil.fyi-5a67d8?style=flat-square&logo=cloudflare)](https://no.toil.fyi)
[![GitHub stars](https://img.shields.io/github/stars/zz-plant/stims?style=flat-square)](https://github.com/zz-plant/stims/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/zz-plant/stims?style=flat-square)](https://github.com/zz-plant/stims/issues)
[![License](https://img.shields.io/github/license/zz-plant/stims?style=flat-square)](./LICENSE)
[![Built with Bun](https://img.shields.io/badge/bun-1.3+-14151a?style=flat-square&logo=bun)](https://bun.sh)

Stims is an independent browser-native visualizer built in the lineage of Ryan Geiss's MilkDrop. It centers on one shared runtime with curated presets, live source editing, and preset import/export, delivered through a responsive Three.js/WebGL app with WebGPU support where available.

It is built to feel like a first-class browser experience rather than a nostalgic desktop clone: quick preflight checks, multiple audio input paths, renderer fallback, and a visualizer shell that stays usable across desktop, laptop, touch, and TV-style setups.

Quick links:

- Live site: [no.toil.fyi](https://no.toil.fyi)
- Launch app: [no.toil.fyi/milkdrop/](https://no.toil.fyi/milkdrop/)
- Product page: [no.toil.fyi/milkdrop/](https://no.toil.fyi/milkdrop/)
- Marketing page opt-out: [no.toil.fyi/?landing=1](https://no.toil.fyi/?landing=1)
- Docs hub: [docs/README.md](./docs/README.md)
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)

## Why Stims exists

Stims aims to make MilkDrop-style visual play feel native to the browser instead of a desktop nostalgia port. The repository is organized around a single flagship visualizer experience rather than a broad toy catalog, so most implementation work lands in the shared runtime, preset workflows, and app shell.

## What you get

- A browser-native visualizer runtime built with Three.js, WebGL, and optional WebGPU rendering.
- Curated presets with a preset browser and smooth visual transitions.
- Live preset source editing without interrupting playback.
- Preset import/export flows for compatibility and experimentation.
- Shared controls for audio input, rendering capability, and performance.
- A launch flow with readiness checks before microphone prompts and renderer-heavy startup.
- Multiple audio paths including microphone, demo audio, tab capture, and YouTube-backed tab capture.
- Renderer preference handling with WebGPU-first startup and direct WebGL fallback when needed.
- A root URL that auto-forwards to the demo-backed visualizer, plus an opt-out marketing page at `/?landing=1` and the canonical visualizer route at `milkdrop/index.html` (`/milkdrop/`).

## Shipped experience

At the product level, Stims currently ships one flagship MilkDrop-led visualizer experience with:

- A quick-check preflight that surfaces graphics, microphone, motion, and compatibility status.
- A preset-led playback flow designed for immediate experimentation.
- A settings panel for quality presets, compatibility mode, motion preferences, render scale, and pixel ratio.
- Session-shell behavior that supports keyboard, gamepad, and TV-style remote navigation.
- Persistent session and local settings so the app can recover your last-used audio and rendering preferences.

## Quickstart

1. Install dependencies:

   ```bash
   bun install
   ```

2. Start the local dev server:

   ```bash
   bun run dev
   ```

3. Open the visualizer:

   ```text
   http://localhost:5173/milkdrop/
   ```

4. Use `index.html` at the same host if you want to review the launch/marketing surface.

If you want to validate the production bundle locally, run `bun run build` and then `bun run preview`.

## Common commands

| Task | Command |
| --- | --- |
| Start dev server | `bun run dev` |
| Start dev server on all interfaces | `bun run dev:host` |
| Start a WebGPU-focused local session | `bun run dev:webgpu` |
| Run the fast local quality gate | `bun run check:quick` |
| Run the full quality gate | `bun run check` |
| Run all tests | `bun run test` |
| Build production assets | `bun run build` |
| Preview the production build | `bun run preview` |
| Deploy to Cloudflare Pages | `bun run pages:deploy` |

For JavaScript or TypeScript changes, `bun run check` is the repository quality gate.

## Contributing at a glance

- Package manager: `bun`
- Runtime target: browser-first Three.js/WebGL app with optional WebGPU
- Main quality gate: `bun run check`
- Faster iteration gate: `bun run check:quick`
- Main contributor docs: [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/README.md](./docs/README.md)

If you change workflows, scripts, or documentation structure, keep the doc entry points aligned per [docs/DOCS_MAINTENANCE.md](./docs/DOCS_MAINTENANCE.md).

## Project shape

- `milkdrop/index.html` (`/milkdrop/`) is the primary visualizer entrypoint.
- `index.html` is the focused launch page for the same product.
- `assets/js/` contains the runtime, renderer, UI shell, and preset infrastructure.
- `assets/data/toys.json` is the checked-in app manifest source for the shipped MilkDrop entry.
- `tests/` contains unit, integration, and compatibility coverage.
- `docs/` is the canonical contributor documentation set.

## Docs

Use [docs/README.md](./docs/README.md) as the canonical docs index.

Start with:

- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)
- [docs/MILKDROP_PRESET_RUNTIME.md](./docs/MILKDROP_PRESET_RUNTIME.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/FEATURE_SPECIFICATIONS.md](./docs/FEATURE_SPECIFICATIONS.md)
- [docs/LINEAGE_AND_CREDITS.md](./docs/LINEAGE_AND_CREDITS.md)
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)

## Lineage

Stims is not an official MilkDrop or Winamp release. When presets, fixtures, screenshots, or compatibility work draw from the wider MilkDrop or projectM ecosystem, credits should remain explicit for original authors, curators, and contributors. See [docs/LINEAGE_AND_CREDITS.md](./docs/LINEAGE_AND_CREDITS.md) for the repository's attribution rules.
