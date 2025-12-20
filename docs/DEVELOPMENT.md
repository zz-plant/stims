# Development Guide

This guide focuses on day-to-day development tasks for the Stim Webtoys Library. It complements the quick start notes in `README.md` and the contribution checklist in `CONTRIBUTING.md`.

## Tooling and Environment

- **Bun 1.2+** is the default for installs and testing. **Node.js 22** (see `.nvmrc`) is supported as an optional fallback if you prefer npm for Vite or tooling.
- Install dependencies once per clone with Bun:
  ```bash
  bun install
  ```
  If you install with Bun and rely on Git hooks, the `postinstall` script will invoke `husky install` when `npm_config_user_agent` starts with `bun`. If hooks still don’t appear, run `bun x husky install`. When using Node, `npm install` is a backup option.
- The project uses **TypeScript**, **Vite**, **Three.js**, and the Bun test runner. No extra ESM flags are required when running `bun test`.
- Run the dev server locally with Bun:
  ```bash
  bun run dev
  ```
  If you’re on Node, use `npm run dev` instead.
  The site serves from `http://localhost:5173`.

## Common Scripts (Bun-first)

| Task | Command (Bun / optional Node fallback) |
| ---- | ------------------------------------- |
| Start dev server | `bun run dev` (`npm run dev`) |
| Production build | `bun run build` (`npm run build`) |
| Preview build locally | `bun run preview` (`npm run preview`) |
| Run test suite | `bun run test` (`npm test` proxies to Bun) |
| Lint | `bun run lint` (`npm run lint`) |
| Format with Prettier | `bun run format` (`npm run format`) |
| Type check without emit | `bun run typecheck` (`npm run typecheck`) |

When debugging a single test file, run:
```bash
bun test tests/filename.test.js
```

Use the `bun run test` (or `npm test`) script instead of raw `bun test` so the `--preload=./tests/setup.ts` and `--importmap=./tests/importmap.json` flags are always applied; they load happy-dom globals and a Three.js stub to keep specs headless and fast.

## Project Structure

- `assets/js/toys/`: Individual toy implementations. Each module exports a `start` function that receives a DOM canvas/audio context.
- `assets/js/core/`: Reusable systems such as renderer initialization, audio analysis, camera controls, and device input helpers.
- `assets/js/utils/`: Small helpers (math, color, randomization, easing).
- `assets/css/`: Shared styles for HTML entry points.
- `assets/data/`: Static JSON or other payloads consumed by toys.
- `tests/`: Bun specs covering utilities and shared behaviors.
- HTML entry points (`toy.html`, `brand.html`, etc.) load specific toys or groups of toys.

## Development Workflow

1. **Create a branch** from `main` for each change.
2. **Run linters and tests** before committing.
3. **Keep changes scoped**: small, reviewable pull requests are easier to land.
4. **Document additions**: update `assets/js/toys-data.js` when adding toys, and note any new npm scripts or setup steps in the docs.
5. **Commit style**: prefer descriptive commit messages summarizing intent and outcome.

## Working With Audio and Input

- Toys often request microphone access. Provide clear UI messaging when microphone permissions are missing or denied.
- When debugging audio issues, confirm `navigator.mediaDevices.getUserMedia` is available and that the page is served over HTTPS or `localhost`.
- Device motion or touch input may be used on some toys—test on mobile-friendly viewports if you add multi-touch interactions.

## Performance Tips

- Three.js rendering defaults to `window.devicePixelRatio`; pass `maxPixelRatio` to `initRenderer` to cap DPI when targeting lower-powered devices.
- Profile heavy scenes with the browser performance tools. Reduce geometry complexity, particle counts, or shader work when frame times exceed 16ms.
- Debounce expensive resize handlers and cache allocations in animation loops.
- A shared floating settings panel now exposes quality presets used across toys. Defaults:
  - **Battery saver**: `maxPixelRatio: 1.25`, `renderScale: 0.9`, ~65% particle counts.
  - **Balanced (default)**: `maxPixelRatio: 2`, `renderScale: 1`, 100% particle counts.
  - **Hi-fi visuals**: `maxPixelRatio: 2.5`, `renderScale: 1`, ~135% particle counts.
  These settings persist between toys so you can cap GPU load once per session. Updating a preset calls `toy.updateRendererSettings()` to apply the new pixel ratio without a page reload.

## Testing Expectations

- Prefer fast, deterministic tests in `tests/`. Mock audio contexts or DOM APIs when real instances are unnecessary.
- Prefer Bun’s built-in mocking (`mock.fn`, `mock.module`) and avoid CommonJS-specific globals.
- Keep tests colocated with utilities when practical, or place shared behaviors in `tests/`.

## Accessibility and UX

- Add keyboard shortcuts or focusable controls when introducing new UI elements.
- Provide feedback for permission failures, loading states, or unsupported browsers.
- Avoid autoplaying audio; let users control start/stop actions.

## Deployment Checklist

- `bun run build` completes without errors. (`npm run build` is available if you’re on Node.)
- Verify the generated `dist/` assets load via `bun run preview` or a simple static server. (`npm run preview` remains a fallback.)
- Spot-check microphone prompts and toy selection flows in the production build.
