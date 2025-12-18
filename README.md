# Stim Webtoys Library

Welcome to the **Stim Webtoys Library**, hosted at [no.toil.fyi](https://no.toil.fyi). This is a collection of interactive web-based toys designed to provide some fun sensory stimulation. They’re built with **Three.js**, **WebGL**, and live **audio interaction** for anyone who enjoys engaging, responsive visuals. These are great for casual play, or as a form of sensory exploration, especially for neurodiverse folks.

For setup, testing, and contribution guidelines, see [CONTRIBUTING.md](./CONTRIBUTING.md). If you're building or updating toys, the developer docs in [`docs/`](./docs) cover common workflows and patterns.

Looking for release notes? Check out the [CHANGELOG](./CHANGELOG.md) to see what’s new, what changed, and what’s coming next.

## Quick Start

1. Clone the repo and `cd` into it.
2. Choose your runtime (the repo records `bun@1.2.14` in `package.json` via `packageManager`):
   - **Bun 1.2+**: install from [bun.sh](https://bun.sh/) for the fastest install/test cycle.
   - **Node.js 22** (see `.nvmrc`): still supported for Vite and general tooling if you prefer npm.
3. Install dependencies with `bun install` (preferred). The repository tracks `bun.lock` for reproducible installs—use `bun install --frozen-lockfile` to respect it. If you use npm, run `npm install` locally; a `package-lock.json` will be generated but is not committed.
4. Start the dev server with `npm run dev` or `bun run dev`, then open `http://localhost:5173` in your browser.

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

### Helpful Scripts (Bun-first)

- `bun run dev`: Start the Vite development server for local exploration. (`npm run dev` works if you’re on Node.)
- `bun run build`: Produce a production build in `dist/`. (`npm run build` is available as a fallback.)
- `bun run preview`: Serve the production build locally (Vite preview with `--host` for LAN testing) to validate the output before deploying. (`npm run preview` is the Node fallback.)
- `bun test` (or `bun run test`): Run the Bun-native test suite. `npm run test` will proxy to Bun when available.
- `bun run test:watch`: Keep the Bun test runner active while you iterate on specs.
- `bun run lint`: Check code quality with ESLint. (`npm run lint` is an optional fallback.)
- `bun run format`: Format files with Prettier. (`npm run format` is an optional fallback.)
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

2. Run the tests:
   ```bash
   bun test
   ```

   (`npm run test` proxies to Bun when present.)

For quick iteration, use the watch mode:

```bash
bun run test:watch
```

### Linting and Formatting

Before committing, run `bun run lint` to check code style and `bun run format` to automatically format your files. If you’re on Node, the `npm run lint` and `npm run format` fallbacks are available. This keeps the project consistent.

## Contributing

If you run into a problem or want to propose an improvement, please use the GitHub issue templates so we get the details we need:

- **Bug reports**: include clear reproduction steps, your environment, and what you expected to happen.
- **Feature requests**: describe the problem you’re trying to solve, the behavior you’d like, and any alternatives you considered.

When opening a pull request, fill out the PR template with a summary of the change and the tests you ran. Check the lint and test boxes only if you executed those commands.

---

## License

This project is released under the [Unlicense](https://unlicense.org/), so you’re free to copy, modify, sell, and distribute it however you like. Do whatever you want with it—there are no restrictions.

Feel free to add more toys, tweak the visuals, or contribute in any way.
