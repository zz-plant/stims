# Development Guide

This guide focuses on day-to-day development tasks for the Stim Webtoys Library. It complements the quick start notes in `README.md` and the contribution checklist in `CONTRIBUTING.md`.

If you’re spinning up the project for the first time, confirm the basics before diving into code:

1. Install **Bun 1.2+** (preferred) or **Node.js 22** (see `.nvmrc`). Run `nvm use` if you use nvm to match the recorded version.
2. Install dependencies with **Bun**: `bun install`. If you need to fall back to npm, run `npm install --no-package-lock` so the repo continues to track only `bun.lock`.
3. Smoke-test the dev server wiring without opening a browser:
   ```bash
   bun run dev:check
   # or
   npm run dev:check
   ```
   This starts Vite on a fixed port, fetches the root page once, and exits—helpful when you’re validating a fresh clone or CI runner.
4. Start the dev server for interactive work with `bun run dev` (or `npm run dev`).

## Tooling and Environment

- **Bun 1.2+** is the default for installs and testing. **Node.js 22** (see `.nvmrc`) is supported as an optional fallback if you prefer npm for Vite or tooling.
- Use the **Bun/Node matrix** below to match local commands to CI:
  | Task | Bun command | Node 22 command |
  | ---- | ----------- | --------------- |
  | Install deps | `bun install --frozen-lockfile` | `npm install --no-package-lock` |
  | Dev server smoke test | `bun run dev:check` | `npm run dev:check` |
  | Lint | `bun run lint` | `npm run lint` |
  | Type check | `bun run typecheck` | `npm run typecheck` |
  | Build | `bun run build` | `npm run build` |
  | Tests | `bun run test` | `npm test` |
  The CI workflows run this same matrix for Bun and Node 22 to ensure both paths stay healthy.
- Install dependencies once per clone with Bun:
  ```bash
  bun install
  ```
  If you install with Bun and rely on Git hooks, the `postinstall` script will invoke `husky install` when `npm_config_user_agent` starts with `bun`. If hooks still don’t appear, run `bun x husky install`. When using Node, `npm install --no-package-lock` is a backup option.
  - Keep `bun.lock` authoritative; avoid committing `package-lock.json`. Use `bun install --frozen-lockfile` in CI and prefer Bun locally to keep dependency resolution consistent.
- The project uses **TypeScript**, **Vite**, **Three.js**, and the Bun test runner. No extra ESM flags are required when running `bun test`.
- Run the dev server locally with Bun:
  ```bash
  bun run dev
  ```
  If you’re on Node, use `npm run dev` instead.
  The site serves from `http://localhost:5173`. For LAN/mobile testing, start the server with `bun run dev:host` (or `npm run dev:host`) to bind Vite to all interfaces.

## Common Scripts (Bun-first)

| Task | Command (Bun / optional Node fallback) |
| ---- | ------------------------------------- |
| Start dev server | `bun run dev` (`npm run dev`) |
| Start dev server (LAN) | `bun run dev:host` (`npm run dev:host`) |
| Production build | `bun run build` (`npm run build`) |
| Preview build locally | `bun run preview` (`npm run preview`) |
| Run test suite | `bun run test` (`npm test` proxies to Bun) |
| Lint | `bun run lint` (`npm run lint`) |
| Format with Prettier | `bun run format` (`npm run format`) |
| Type check without emit | `bun run typecheck` (`npm run typecheck`) |
| Dev server smoke test (no browser) | `bun run dev:check` (`npm run dev:check`) |
| Validate toy registry and docs | `bun run check:toys` |
| Serve built assets from `dist/` | `bun run serve:dist` |
| Cloudflare Pages preview | `bun run pages:dev` |
| Cloudflare Pages deploy | `bun run pages:deploy` |

Notes:

- `bun run check:toys` verifies that every toy listed in `assets/js/toys-data.js` has the expected TypeScript entry file, that iframe toys have matching HTML entry points, and that `docs/TOY_SCRIPT_INDEX.md` references each slug. Run this when adding or renaming toys.
- `bun run serve:dist` is a quick way to host the built assets without Vite’s dev server. Use it to validate the `dist/` output locally.
- The Pages scripts rely on `wrangler`; they rebuild before starting a preview session or deploying.

When debugging a single test file, run:
```bash
bun test tests/filename.test.js
```

### Editor Tooling

- VS Code users can install recommended extensions via `.vscode/extensions.json` (Prettier, ESLint, and the TypeScript ESLint language service).
- `.vscode/settings.json` configures Prettier as the default formatter and enables format-on-save for common web languages.
- `.vscode/launch.json` includes a Vite dev-server debug config (with a Bun-backed prelaunch task) and a Bun test debug config so you can attach the debugger without additional setup.
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
