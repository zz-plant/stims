# Stims

[![Live site](https://img.shields.io/badge/live-no.toil.fyi-5a67d8?style=flat-square&logo=cloudflare)](https://no.toil.fyi)
[![GitHub stars](https://img.shields.io/github/stars/zz-plant/stims?style=flat-square)](https://github.com/zz-plant/stims/stargazers)
[![GitHub issues](https://img.shields.io/github/issues/zz-plant/stims?style=flat-square)](https://github.com/zz-plant/stims/issues)
[![License](https://img.shields.io/github/license/zz-plant/stims?style=flat-square)](./LICENSE)
[![Built with Bun](https://img.shields.io/badge/bun-1.3+-14151a?style=flat-square&logo=bun)](https://bun.sh)

Stims is a browser-native MilkDrop-inspired visualizer. The product now centers on one shared runtime with curated presets, live source editing, and preset import/export instead of a broader multi-toy catalog.

Quick links:

- Live site: [no.toil.fyi](https://no.toil.fyi)
- Launch app: [no.toil.fyi/toy.html](https://no.toil.fyi/toy.html)
- Product page: [no.toil.fyi/toys/milkdrop/](https://no.toil.fyi/toys/milkdrop/)
- Docs hub: [docs/README.md](./docs/README.md)
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)

## What it includes

- A browser-native MilkDrop-inspired runtime built with Three.js and WebGL, with WebGPU support where available.
- Bundled presets and a preset browser.
- Live source editing without interrupting playback.
- Preset import/export workflows.
- Shared audio and performance controls.

## Local setup

1. Install dependencies with `bun install`.
2. Start the dev server with `bun run dev`.
3. Open `http://localhost:5173/toy.html`.

Useful commands:

- `bun run dev`
- `bun run build`
- `bun run preview`
- `bun run check`
- `bun run check:quick`
- `bun run test`

## Docs

Use [docs/README.md](./docs/README.md) as the canonical docs index.

The most relevant docs are:

- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md)
- [docs/MILKDROP_PRESET_RUNTIME.md](./docs/MILKDROP_PRESET_RUNTIME.md)
- [docs/LINEAGE_AND_CREDITS.md](./docs/LINEAGE_AND_CREDITS.md)
- [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)

## Lineage

Stims is not an official MilkDrop or Winamp release. It is an independent browser-native visualizer built in the lineage of Ryan Geiss's MilkDrop. When preset packs, fixtures, or compatibility work draw from the wider ecosystem, credit should remain explicit for preset authors, curators, and projectM contributors where relevant.
