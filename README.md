<div align="center">

# ⚡ Stims

**Modern Browser Music Visualizer & AI Shader Studio**

*One click to moving visuals — deep editor, WebGPU pipeline, stem reactivity, and AI generation when you want more.*

[![Live Site](https://img.shields.io/badge/live-toil.fyi-5a67d8?style=for-the-badge&logo=cloudflare)](https://toil.fyi)
[![GitHub Stars](https://img.shields.io/github/stars/zz-plant/stims?style=for-the-badge&logo=github)](https://github.com/zz-plant/stims/stargazers)
[![Built with Bun](https://img.shields.io/badge/bun-1.3+-14151a?style=for-the-badge&logo=bun)](https://bun.sh)
[![WebGPU & WebGL2](https://img.shields.io/badge/graphics-WebGPU%20%7C%20WebGL2-00C7B7?style=for-the-badge&logo=webgpu)](https://toil.fyi)
[![License](https://img.shields.io/github/license/zz-plant/stims?style=for-the-badge)](./LICENSE)

---

[🚀 **Launch App at toil.fyi**](https://toil.fyi) • [📚 **Developer Docs Portal**](./docs/README.md) • [🏆 **Technical Achievements**](./docs/TECHNICAL_ACHIEVEMENTS.md) • [💬 **Discussions**](https://github.com/zz-plant/stims/discussions)

</div>

---

## ✨ Features at a Glance

| Feature | Description |
| --- | --- |
| ⚡ **Instant Visuals** | One-click instant audio playback with zero setup. Hero CTA floats over a running visual stage. |
| 🎨 **1,868 Presets** | Imported from the Butterchurn and projectM archives. Interactive card grid with filters, favorites, and 1-tap loading. |
| 🤖 **AI Generation & Blending** | Natural language text-to-preset synthesis ("neon waves pulsing through a starfield"), batch variations, and AST preset motion/color blending. |
| ✒️ **CodeMirror 6 Editor** | Full IDE with 60+ MilkDrop completions, bracket matching, live register tuning sliders (`zoom`, `warp`, `rot`, `decay`), and AI Quick Fix error correction. |
| 🎧 **Stem-Aware Audio Engine** | Off-thread AudioWorklet DSP isolating drum transients, sub-bass, vocals, and synth channels into live visual uniforms. |
| 🎛️ **WebMIDI & VJ Controls** | Physical MIDI hardware controller bridge mapping CC knobs and faders directly to MilkDrop registers. |
| 🔍 **Semantic Vector Search** | Find visually similar presets using BGE code/text embeddings and Cloudflare D1 edge cosine similarity. |
| 📽️ **4K / 60FPS Video Export** | Built-in canvas recorder targeting 4K, 1080p, Spotify Canvas (9:16), TikTok, and YouTube Shorts. |

---

## 🏆 Key Technical Achievements

Stims is an open-web platform combining legacy Winamp MilkDrop preset compatibility with modern browser graphics and AI edge infrastructure:

1. ⚡ **In-Browser JIT Compiler & VM**: Compiles legacy Winamp MilkDrop EEL2/HLSL math into zero-closure 60 FPS JS functions ([expression-jit.ts](./src/js/milkdrop/expression-jit.ts)) with complete `megabuf` and `gmegabuf` memory emulation ([vm.ts](./src/js/milkdrop/vm.ts)).
2. 🖥️ **Dual WebGPU / WebGL2 Pipeline**: High-performance WebGPU compute pipelines and TSL feedback managers ([feedback-manager-webgpu-tsl.ts](./src/js/milkdrop/feedback-manager-webgpu-tsl.ts)) with zero-interruption WebGL2 fallbacks ([renderer-capabilities.ts](./src/js/core/renderer-capabilities.ts)).
3. 🤖 **Serverless AI Preset Synthesizer**: Edge-deployed Cloudflare Worker endpoints ([generate-preset.ts](./functions/api/generate-preset.ts)) translating natural language to MilkDrop math, performing 5-way batch generation, and AST equation blending ([blend-presets.ts](./functions/api/blend-presets.ts)).
4. 🔍 **Edge Vector Search**: TTL-cached in-memory cosine similarity search over 1,868+ preset embeddings using Cloudflare D1 ([visual-search.ts](./functions/api/visual-search.ts)).
5. 🎧 **Off-Main-Thread AudioWorklet DSP**: Multi-band energy, envelope, and stem calculations off the main thread ([frequency-analyser-processor.ts](./src/js/utils/audio/frequency-analyser-processor.ts)) with zero-copy 512x2 RGBA audio GPU textures ([audio-gpu-texture.ts](./src/js/core/audio-gpu-texture.ts)).
6. 🎛️ **WebMIDI Hardware Controller Bridge**: Physical MIDI controller integration ([webmidi-controller.ts](./src/js/core/services/webmidi-controller.ts)) mapping physical knobs to live VM registers.
7. 🥽 **WebXR 6DoF Spatial VR Stage**: Immersive WebXR spatial stage session manager ([webxr-stage-session.ts](./src/js/core/services/webxr-stage-session.ts)) for VR/AR web browsers.
8. 🌐 **Zero-Router History API**: Ultra-fast URL state synchronization ([url-state.ts](./src/js/frontend/url-state.ts)) preserving deep links, tools, and agent flags without client-side routing libraries.

> See [**TECHNICAL_ACHIEVEMENTS.md**](./docs/TECHNICAL_ACHIEVEMENTS.md) for detailed architecture breakdowns.

---

## 🚀 Quickstart

### Prerequisites
- [Bun](https://bun.sh) 1.3+
- A modern browser supporting WebGL2 (WebGPU supported)

```bash
# Clone the repository
git clone https://github.com/zz-plant/stims.git
cd stims

# Install dependencies
bun install

# Start local development server
bun run dev
```

Open `http://localhost:5173`.

---

## ⚡ Quick Reference Commands

```bash
bun run dev           # Start development server
bun run check:quick   # Fast quality gate (lint + types + catalog check)
bun run check         # Full quality gate (lint + types + tests + architecture check)
bun run build         # Build production web app
bun run test          # Run unit and integration test suites
bun run preview       # Preview production build locally
```

---

## 🌐 Serverless Edge API

All edge endpoints run on Cloudflare Workers at `https://toil.fyi/api/`. Full documentation in [**docs/api.md**](./docs/api.md).

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/generate-preset` | `POST` | Translates natural language prompts to executable MilkDrop equations |
| `/api/blend-presets` | `POST` | Merges motion equations from Preset A with color/atmosphere from Preset B |
| `/api/batch-generate` | `POST` | Generates 5 concurrent preset variations from one prompt |
| `/api/image-to-preset` | `POST` | Multimodal vision model processing converting screenshots to equations |
| `/api/visual-search` | `POST` | Semantic vector search via BGE embeddings and D1 cosine similarity |
| `/api/presets` | `GET/POST` | Community gallery CRUD with Cloudflare D1 + R2 storage |

---

## 📚 Developer Documentation Portal

Explore full technical guides in the **[Developer Documentation Portal](./docs/README.md)**:

| Track | Key Documents |
| --- | --- |
| 🚀 **Getting Started** | [Development Setup](./docs/DEVELOPMENT.md) • [Deployment Guide](./docs/DEPLOYMENT.md) • [Testing Specs](./docs/TESTING.md) |
| 🏛️ **Architecture & Engine** | [Architecture Overview](./docs/ARCHITECTURE.md) • [Technical Achievements](./docs/TECHNICAL_ACHIEVEMENTS.md) • [Preset Runtime](./docs/MILKDROP_PRESET_RUNTIME.md) |
| 🎨 **Preset Authoring** | [MilkDrop Coding Guide](./docs/MILKDROP_CODING_GUIDE.md) • [projectM Parity Plan](./docs/MILKDROP_PROJECTM_PARITY_PLAN.md) |
| 🤖 **AI & Infrastructure** | [API Reference](./docs/api.md) • [MCP Server Guide](./docs/MCP_SERVER.md) |
| 📊 **Strategy & History** | [Project Roadmap](./docs/ROADMAP.md) • [Implementation Status](./docs/IMPLEMENTATION_STATUS.md) • [Lineage & Credits](./docs/LINEAGE_AND_CREDITS.md) |

---

## 🤝 Contributing

Contributions, bug reports, and PRs are welcome!
- Start with [CONTRIBUTING.md](./CONTRIBUTING.md).
- Have questions or ideas? Join our [GitHub Discussions](https://github.com/zz-plant/stims/discussions).

---

## 📜 Lineage & License

Stims is an independent browser-native visualizer built in the lineage of Ryan Geiss's legendary Winamp MilkDrop, Butterchurn, and projectM.

Licensed under the MIT License. See [LICENSE](./LICENSE) for details.
