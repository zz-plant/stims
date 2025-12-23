# Stim Webtoys Library

Welcome to the **Stim Webtoys Library**, hosted at [no.toil.fyi](https://no.toil.fyi). This is a collection of interactive web-based toys designed to provide some fun sensory stimulation. They’re built with **Three.js**, **WebGL**, and live **audio interaction** for anyone who enjoys engaging, responsive visuals. These are great for casual play, or as a form of sensory exploration, especially for neurodiverse folks.

For setup, testing, and contribution guidelines, see [CONTRIBUTING.md](./CONTRIBUTING.md). If you're building or updating toys, the developer docs in [`docs/`](./docs) cover common workflows and patterns.
If you’re using the Model Context Protocol server in [`scripts/mcp-server.ts`](./scripts/mcp-server.ts), see the dedicated guide in [`docs/MCP_SERVER.md`](./docs/MCP_SERVER.md).

Looking for release notes? Check out the [CHANGELOG](./CHANGELOG.md) to see what’s new, what changed, and what’s coming next.

## Quick Start

1. Clone the repo and `cd` into it.
2. Choose your runtime (the repo records `bun@1.2.14` in `package.json` via `packageManager`):
   - **Bun 1.2+**: install from [bun.sh](https://bun.sh/) for the fastest install/test cycle.
   - **Node.js 22** (see `.nvmrc`): still supported for Vite and general tooling if you prefer npm.
3. Install dependencies with `bun install` (preferred). The repository tracks `bun.lock` for reproducible installs—use `bun install --frozen-lockfile` to respect it. If you use npm, run `npm install` locally; a `package-lock.json` will be generated but is not committed.
4. Start the dev server with `npm run dev` or `bun run dev`, then open `http://localhost:5173` in your browser. The dev server already binds to all interfaces for easy forwarding and mobile checks; `bun run dev:host` (or `npm run dev:host`) remains available as an explicit alternative.

## Getting Started

### What You’ll Need:

- **A Modern Web Browser**: Anything that supports WebGL should work (think Chrome, Firefox, Edge).
- **Microphone Access**: A lot of these toys respond to sound, so you’ll want to enable that.
- **Touch Devices**: Some toys are enhanced by touch, but that’s optional.

### How to Play:

Head to [no.toil.fyi](https://no.toil.fyi) and jump right in. The toys respond to sound, touch, and other inputs to create a chill or stimulating experience. If you’d rather play locally, follow the steps in **Local Setup** to run the dev server and open the toys at `http://localhost:5173`.

## Repository Layout

This project is organized so you can find the visuals, core utilities, and shared assets quickly:

- `assets/js/toys/`: Individual toy implementations such as `cube-wave.ts`, `spiral-burst.ts`, and other sound-reactive scenes.
- `assets/js/core/`: Rendering and input helpers used by multiple toys (for example, renderer initialization and audio analyzers).
- `assets/js/utils/`: Small utility modules that support the core helpers and toys.
- `assets/css/`: Shared styling for the various HTML entry points.
- `assets/data/`: Static data files consumed by the toys.
- `tests/`: Bun specs that validate core behaviors.
- `toy.html`, `brand.html`, `seary.html`, and other HTML files: Entry points that load specific toys or collections of toys.

If you add a new toy, place the implementation in `assets/js/toys/`, register it in `assets/js/toys-data.js`, and make sure there’s an entry point (often `toy.html?toy=<slug>`) that can load it.

## Toys in the Collection

| Toy | Description |
| --- | --- |
| [3D Toy](./toy.html?toy=3dtoy) | Dive into a twisting 3D tunnel that responds to sound. |
| [Aurora Painter](./toy.html?toy=aurora-painter) | Paint flowing aurora ribbons that react to your microphone in layered waves. |
| [Star Guitar Visualizer](./toy.html?toy=brand) | A visual journey inspired by an iconic music video, synced to your music. |
| [Pottery Wheel Sculptor](./toy.html?toy=clay) | Spin and shape a clay vessel with tactile smoothing and carving tools. |
| [Defrag Visualizer](./toy.html?toy=defrag) | A nostalgic, sound-reactive visualizer evoking old defragmentation screens. |
| [Evolutionary Weirdcore](./toy.html?toy=evol) | Watch surreal landscapes evolve with fractals and glitches that react to music. |
| [Geometry Visualizer](./toy.html?toy=geom) | Push shifting geometric forms directly from live mic input. |
| [Ultimate Satisfying Visualizer](./toy.html?toy=holy) | Layered halos, particles, and morphing shapes that respond to your music. |
| [Multi-Capability Visualizer](./toy.html?toy=multi) | Shapes and lights move with both sound and device motion. (Requires WebGPU.) |
| [Trippy Synesthetic Visualizer](./toy.html?toy=seary) | Blend audio and visuals in a rich synesthetic experience. |
| [Pattern Recognition Visualizer](./toy.html?toy=sgpat) | See patterns form dynamically in response to sound. |
| [Terminal Word Grid](./toy.html?toy=legible) | A retro green text grid that pulses to audio and surfaces fresh words as you play. |
| [SVG + Three.js Visualizer](./toy.html?toy=svgtest) | A hybrid visualizer blending 2D and 3D elements, reacting in real time. |
| [Dreamy Spectrograph](./toy.html?toy=symph) | A relaxing spectrograph that moves gently with your audio. |
| [Interactive Word Cloud](./toy.html?toy=words) | Speak and watch the word cloud react and shift with your voice. |
| [Grid Visualizer](./toy.html?toy=cube-wave) | Swap between cube waves and bouncing spheres without stopping the music. |
| [Bubble Harmonics](./toy.html?toy=bubble-harmonics) | Translucent, audio-inflated bubbles that split into harmonics on high frequencies. |
| [Cosmic Particles](./toy.html?toy=cosmic-particles) | Jump between orbiting swirls and nebula fly-throughs with a single toggle. |
| [Audio Light Show](./toy.html?toy=lights) | Swap shader styles and color palettes while lights ripple with your microphone input. |
| [Spiral Burst](./toy.html?toy=spiral-burst) | Colorful spirals rotate and expand with every beat. |
| [Rainbow Tunnel](./toy.html?toy=rainbow-tunnel) | Fly through colorful rings that spin to your music. |
| [Star Field](./toy.html?toy=star-field) | A field of shimmering stars reacts to the beat. |
| [Fractal Kite Garden](./toy.html?toy=fractal-kite-garden) | Grow branching kite fractals that sway with mids and shimmer with crisp highs. |

---

## What’s in the Pipeline

### **WebGL Compatibility**

- **Issue**: Some users with older or unsupported browsers/devices might run into issues.
- **Fix**: Add fallback options or messages for users without WebGL support.

### **Performance Tweaks**

- **Issue**: Some toys are heavy on resources and might lag on lower-end devices.
- **Fix**: Add settings to adjust visual quality (e.g., reduce particle count or resolution).

If you want to reduce GPU load on high-DPI screens without degrading visuals too much, pass a `maxPixelRatio` option to
`initRenderer` (defaults to `2`). This caps the renderer to `Math.min(window.devicePixelRatio, maxPixelRatio)`, so setting
`maxPixelRatio` to `1.5` or `1` can significantly cut per-frame work while retaining clarity.

### **Audio Permissions**

- **Issue**: Not much feedback when audio permissions are denied or unavailable.
- **Fix**: Add error messages or alternative audio input options when microphone access isn’t granted.

### **Touch Responsiveness**

- **Issue**: Some toys are touch-sensitive, but they don’t always work well on mobile.
- **Fix**: Improve multi-touch support and make the toys more mobile-friendly.

---

## Local Setup

To play with the toys locally you’ll need to run them from a local web server. Opening the HTML files directly won’t work because the TypeScript modules and JSON fetches can’t load over `file://`. Here’s the quick setup:

1. Clone the repository:

   ```bash
   git clone https://github.com/zz-plant/stims.git
   cd stims
   ```

2. Use Bun 1.2+ (recorded in `package.json`). Node.js 22 (see `.nvmrc`) is available as an optional fallback; if you have nvm installed, run `nvm use` to select it.

3. Install dependencies (Bun is preferred and the only locked flow):

   ```bash
   bun install
   # or, if you prefer npm locally
   npm install
   ```

   The repository tracks `bun.lock`; pin installs with `bun install --frozen-lockfile`. If you use npm, regenerate `package-lock.json` locally as needed, but do not commit it.

   Bun does not automatically run `prepare` scripts, so the repo includes a `postinstall` hook that installs Husky when `npm_config_user_agent` starts with `bun`. If that step fails for any reason, fall back to `bun x husky install` (or `npx husky install`).

4. Start the development server (Bun by default):

   ```bash
   bun run dev
   ```

   If you’re on Node, use `npm run dev` instead.

Open `http://localhost:5173` in your browser.

To serve a static build instead of the dev server, run:

```bash
bun run build
bun run preview

bun run serve:dist
# or use Python as a fallback
python3 -m http.server dist

# Node fallback
npm run build
npm run preview
```

The preview server hosts the contents of `dist/` on port `4173` using Vite's `--host` flag, so you can load the build from other devices on your LAN if needed.

All JavaScript dependencies are installed via npm (or Bun) and bundled locally with Vite, so everything works offline without hitting a CDN.

### Troubleshooting

#### Microphone permissions

- If the browser denied microphone access, re-allow it via the address bar/site settings and click the start button again. Hard-refreshing the page will re-trigger the prompt on most browsers.
- Switch to demo audio if you keep seeing timeouts or “blocked” errors—the UI exposes a fallback button for a pre-mixed track so you can keep exploring without mic input.
- For deeper debugging (including timeouts and permission-state checks), see the microphone flow helper in [`assets/js/core/microphone-flow.ts`](./assets/js/core/microphone-flow.ts).

#### WebGPU gating

- A WebGPU fallback warning means the browser lacked a compatible adapter or device at startup; toys will fall back to WebGL when possible.
- To force a retry (for example, after toggling a browser flag or switching GPUs), refresh the page—WebGPU detection resets and will attempt the adapter/device handshake again.
- WebGPU-only toys (like [`multi`](./multi.html)) won’t run without WebGPU; expect them to stay idle or prompt you to pick another toy until the capability probe succeeds. The renderer capability probe and fallback reasons live in [`assets/js/core/renderer-capabilities.ts`](./assets/js/core/renderer-capabilities.ts) if you need to trace the gating logic.

#### Dev-server hosting

- Use `bun run dev:host` (or `npm run dev:host`) to bind the dev server to your LAN interface for mobile/device testing; the script mirrors the default `dev` command but with explicit hosting.
- Check the served port in the terminal output (Vite defaults to `5173`; preview uses `4173`). Connect from other devices via `http://<your-ip>:<port>`.
- Avoid loading toys over `file://`; the modules and JSON fetches require an HTTP server, so always use the dev server, preview server, or another static host.

### Helpful Scripts (Bun-first)

- `bun run dev`: Start the Vite development server for local exploration. (`npm run dev` works if you’re on Node.)
- `bun run dev:host`: Start the Vite dev server bound to your LAN interface for quick mobile/device testing. (`npm run dev:host` works if you’re on Node.)
- `bun run build`: Produce a production build in `dist/`. (`npm run build` is available as a fallback.)
- `bun run preview`: Serve the production build locally (Vite preview with `--host` for LAN testing) to validate the output before deploying. (`npm run preview` is the Node fallback.)
- `bun run test`: Run the Bun-native test suite with the required `--preload=./tests/setup.ts` and `--importmap=./tests/importmap.json` flags applied. These load happy-dom globals and a Three.js stub so specs run headlessly. `npm test` proxies to the same script when you’re on Node.
- `bun run test:watch`: Keep the Bun test runner active while you iterate on specs.
- `bun run lint`: Check code quality with ESLint. (`npm run lint` is an optional fallback.)
- `bun run format`: Format files with Prettier. (`npm run format` is an optional fallback.)
- `bun run typecheck`: Run TypeScript’s type checker without emitting files. (`npm run typecheck` is an optional fallback.)
- `bun run scripts/scaffold-toy.ts`: Interactive (or flag-driven) scaffolder that prompts for a slug/title/type, creates a starter module from [`docs/TOY_DEVELOPMENT.md`](./docs/TOY_DEVELOPMENT.md), appends metadata to `assets/js/toys-data.js`, updates `docs/TOY_SCRIPT_INDEX.md`, and can optionally drop a minimal Bun spec. Pass flags such as `--slug ripple-orb --title "Ripple Orb" --type module --with-test` for non-interactive runs.
- `bun run serve:dist`: Serve the `dist/` build with Bun (preferred for local production previews).

## Code of Conduct and Contributions

Please review our [Code of Conduct](./CODE_OF_CONDUCT.md) before participating in the project. By contributing, you agree to uphold these community standards. A full contributing guide will live alongside the Code of Conduct so expectations are always clear.

### Running Tests

This project uses the [Bun test runner](https://bun.sh/docs/test) for its suite. To install
dependencies and run the tests:

1. Install dependencies:

   ```bash
   bun install
   ```

   (`npm install` is available if you’re using Node.)

2. Run the tests (via the script so required flags are applied):
   ```bash
   bun run test
   ```

   This script pins `--preload=./tests/setup.ts` and `--importmap=./tests/importmap.json` to load happy-dom globals and a Three.js stub for headless execution. Use `npm test` as the Node equivalent.

For quick iteration, use the watch mode:

```bash
bun run test:watch
```

### Linting and Formatting

Before committing, run `bun run lint` to check code style and `bun run format` to automatically format your files. If you’re on Node, the `npm run lint` and `npm run format` fallbacks are available. This keeps the project consistent.

## Cloudflare Pages (Bun) build & deploy

Cloudflare Pages can build this project with Bun using the `wrangler.toml` in the repo root. Key settings:

- Project name: `stims` (top-level `name` in `wrangler.toml`)
- Build output directory: `dist/` (set via `pages_build_output_dir` in `wrangler.toml`)
- Build command: `bun run build` (set in the Pages UI under **Settings → Builds & deployments → Build command**; Pages rejects a `[build]` table in `wrangler.toml`)
- Set the `BUN_VERSION` environment variable (for example, `BUN_VERSION=1.2.14`) in your Pages project so the hosted runtime matches local installs.
- Enable Pages’ **Bun runtime** so the build runs under Bun instead of Node.
- The `compatibility_date` in `wrangler.toml` keeps Pages aligned with the Cloudflare Workers API version.
- Do not add a `[pages]` table in `wrangler.toml`; Cloudflare Pages expects project linkage to be configured in the dashboard.
- If you prefer to omit the build command in the Pages UI, keep `CF_PAGES=1` in the environment; `scripts/postinstall.mjs` will run `bun run build` (or `npm run build`) during `npm install` to populate `dist/` automatically. The script still only installs Husky when the installer is Bun, matching local behavior.

To verify the preview locally, run `bun run build` and inspect the generated `dist/` folder; it matches the assets Pages will serve when the Bun runtime is enabled and the build output directory is `dist/`.

## Contributing

If you run into a problem or want to propose an improvement, please use the GitHub issue templates so we get the details we need:

- **Bug reports**: include clear reproduction steps, your environment, and what you expected to happen.
- **Feature requests**: describe the problem you’re trying to solve, the behavior you’d like, and any alternatives you considered.

When opening a pull request, fill out the PR template with a summary of the change and the tests you ran. Check the lint and test boxes only if you executed those commands.

---

## License

This project is released under the [Unlicense](https://unlicense.org/), so you’re free to copy, modify, sell, and distribute it however you like. Do whatever you want with it—there are no restrictions.

Feel free to add more toys, tweak the visuals, or contribute in any way.
