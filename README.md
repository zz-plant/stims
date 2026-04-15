# Stims

[![Live site](https://img.shields.io/badge/live-toil.fyi-5a67d8?style=flat-square&logo=cloudflare)](https://toil.fyi)
[![GitHub stars](https://img.shields.io/github/stars/zz-plant/stims?style=flat-square)](https://github.com/zz-plant/stims/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/zz-plant/stims?style=flat-square)](https://github.com/zz-plant/stims/issues)
[![License](https://img.shields.io/github/license/zz-plant/stims?style=flat-square)](./LICENSE)
[![Built with Bun](https://img.shields.io/badge/bun-1.3+-14151a?style=flat-square&logo=bun)](https://bun.sh)

Stims is an instant browser music visualizer inspired by Ryan Geiss's MilkDrop. You can start with demo audio in one click, switch to your own sound when you want to, and move through curated presets without leaving the main stage.

It is designed to feel like a real browser product instead of a desktop port: fast first play, live preset browsing, optional deeper controls, and a shell that stays usable across desktop, laptop, touch, and TV-style setups.

## Quick links

- Live site: [toil.fyi](https://toil.fyi)
- Homepage: [toil.fyi/](https://toil.fyi/)
- Launch app: [toil.fyi/](https://toil.fyi/)
- Legacy alias: [toil.fyi/milkdrop/](https://toil.fyi/milkdrop/)
- Docs hub: [docs/README.md](./docs/README.md)
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)

## Table of contents

- [Why Stims exists](#why-stims-exists)
- [What you get](#what-you-get)
- [Shipped experience](#shipped-experience)
- [Quickstart](#quickstart)
- [Common commands](#common-commands)
- [README maintenance checklist](#readme-maintenance-checklist)
- [Development notes](#development-notes)
- [Contributing at a glance](#contributing-at-a-glance)
- [Project shape](#project-shape)
- [Troubleshooting](#troubleshooting)
- [Docs](#docs)
- [Lineage](#lineage)

## Why Stims exists

Stims exists to make reactive music visuals feel immediate on the web. The product is centered on a single flagship experience: press play, get moving visuals fast, then go deeper into presets, editing, and input choices only if you want to.

## What you get

- One-click demo playback so first-time users can start immediately.
- Curated presets with a browser for quick discovery and smooth transitions.
- Optional live audio input from microphone, tab audio, or YouTube-backed tab capture.
- Live preset editing plus import/export for people who want to customize deeper.
- Shared playback, browse, and settings surfaces that work across desktop, touch, and TV-style setups.
- One unified workspace route at `index.html` (`/`) for launch, playback, and live session entry, plus a `/milkdrop/` alias that redirects into the same experience.

## Shipped experience

At the product level, Stims currently ships one flagship MilkDrop-led visualizer experience with:

- An instant-start launch route that makes demo playback the default first run.
- A preset-led playback flow designed for quick experimentation and repeat browsing.
- Optional audio-source upgrades when users want the visuals to follow their own sound.
- A settings panel built around quick looks first, with advanced tuning hidden until needed.
- A live overlay that keeps preset browsing primary and tucks editing and inspection one layer deeper without leaving playback.
- Session-shell behavior that supports keyboard, gamepad, and TV-style remote navigation.
- Persistent session and local settings so the app can recover your last-used audio and rendering preferences.

## Quickstart

### Prerequisites

- [Bun](https://bun.sh) 1.3+
- A modern browser with WebGL enabled (WebGPU is optional and auto-detected)

### Run locally

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
   http://localhost:5173/
   ```

If you want to validate the production bundle locally, run `bun run build` and then `bun run preview`.

## Common commands

| Task | Command |
| --- | --- |
| Start dev server | `bun run dev` |
| Warm an agent session stack | `bun run session:codex -- --profile review` |
| Start dev server on all interfaces | `bun run dev:host` |
| Start a WebGPU-focused local session | `bun run dev:webgpu` |
| Run the fast local quality gate | `bun run check:quick` |
| Run the full quality gate | `bun run check` |
| Run all tests | `bun run test` |
| Build production assets | `bun run build` |
| Preview the production build | `bun run preview` |
| Manual Cloudflare Pages preview deploy | `bun run pages:deploy:preview` |
| Manual Cloudflare Pages production deploy | `bun run pages:deploy` |

For JavaScript or TypeScript changes, `bun run check` is the repository quality gate.

## README maintenance checklist

When changing project workflows or documentation structure, keep README-level entry points aligned in the same change:

- `README.md` (this file)
- `CONTRIBUTING.md`
- `AGENTS.md`
- `docs/README.md`
- `docs/agents/README.md`

Use [docs/DOCS_MAINTENANCE.md](./docs/DOCS_MAINTENANCE.md) as the synchronization checklist for add/move/rename/delete docs updates.

## Development notes

- Prefer `bun run dev:host` when testing on phones, tablets, or TV browsers on your local network.
- Use `bun run session:codex -- --profile review` to keep a local agent stack warm with the dev server, LM Studio model roles when available, and a background verification watcher.
- If your browser supports WebGPU but visuals fail, switch renderer preference to WebGL in app settings and refresh.
- Use `bun run preview` after `bun run build` to test the production bundle behavior (including route handling) before deployment.
- Cloudflare Pages preview and production deploys default to the GitHub Actions direct-upload jobs in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml); the `pages:deploy:*` scripts are the manual fallback path.
- [`wrangler.toml`](./wrangler.toml) is checked in as the Pages config source of truth for compatibility and placement settings; keep dashboard-only build settings aligned with it.

## Contributing at a glance

- Package manager: `bun`
- Runtime target: browser-first Three.js/WebGL app with optional WebGPU
- Main quality gate: `bun run check`
- Faster iteration gate: `bun run check:quick`
- Main contributor docs: [CONTRIBUTING.md](./CONTRIBUTING.md) and [docs/README.md](./docs/README.md)

If you change workflows, scripts, or documentation structure, keep the doc entry points aligned per [docs/DOCS_MAINTENANCE.md](./docs/DOCS_MAINTENANCE.md).

## Project shape

- `index.html` (`/`) is the canonical workspace route for the visualizer.
- `milkdrop/index.html` (`/milkdrop/`) is a compatibility alias that redirects to `/`.
- `assets/js/frontend/` contains the product-facing workspace UI, URL state, and engine adapter seam.
- `assets/js/` contains the runtime, renderer, UI shell, and preset infrastructure.
- `assets/data/toys.json` is the checked-in app manifest source for the shipped MilkDrop entry.
- `tests/` contains unit, integration, and compatibility coverage.
- `docs/` is the canonical contributor documentation set.

## Troubleshooting

- **Blank canvas on startup**: confirm hardware acceleration is enabled in your browser and retry with WebGL preference.
- **No microphone or tab audio input**: check browser permission prompts and verify the selected input device in the in-app controls.
- **Mobile device cannot reach local dev server**: use `bun run dev:host`, then load the host machine IP from the mobile browser.

## Docs

Use [docs/README.md](./docs/README.md) as the canonical docs index.

Start with:

- [docs/agents/agent-handoffs.md](./docs/agents/agent-handoffs.md)
- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)
- [docs/MILKDROP_PRESET_RUNTIME.md](./docs/MILKDROP_PRESET_RUNTIME.md)
- [docs/MILKDROP_SUCCESSOR_WORKSTREAMS.md](./docs/MILKDROP_SUCCESSOR_WORKSTREAMS.md)
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- [docs/MANUAL_SMOKE_BASELINE.md](./docs/MANUAL_SMOKE_BASELINE.md)
- [docs/QA_PLAN.md](./docs/QA_PLAN.md)
- [docs/FEATURE_SPECIFICATIONS.md](./docs/FEATURE_SPECIFICATIONS.md)
- [docs/DOCS_MAINTENANCE.md](./docs/DOCS_MAINTENANCE.md)
- [docs/LINEAGE_AND_CREDITS.md](./docs/LINEAGE_AND_CREDITS.md)
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)

## Lineage

Stims is not an official MilkDrop or Winamp release. When presets, fixtures, screenshots, or compatibility work draw from the wider MilkDrop or projectM ecosystem, credits should remain explicit for original authors, curators, and contributors. See [docs/LINEAGE_AND_CREDITS.md](./docs/LINEAGE_AND_CREDITS.md) for the repository's attribution rules.
