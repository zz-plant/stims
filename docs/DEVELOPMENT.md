# Development Guide

This guide focuses on day-to-day development tasks for the Stim Webtoys Library. It complements the quick start notes in `README.md` and the contribution checklist in `CONTRIBUTING.md`.

## Tooling and Environment

- **Node.js 22** is required (see `.nvmrc`). Run `nvm use` if you have nvm installed.
- Install dependencies once per clone:
  ```bash
  npm install
  ```
- The project uses **TypeScript**, **Vite**, **Three.js**, and **Jest** with ESM. Keep `NODE_OPTIONS=--experimental-vm-modules` when invoking Jest directly.
- Run the dev server locally:
  ```bash
  npm run dev
  ```
  The site serves from `http://localhost:5173`.

## Common Scripts

| Task | Command |
| ---- | ------- |
| Start dev server | `npm run dev` |
| Production build | `npm run build` |
| Preview build locally | `npm run preview` |
| Run Jest suite | `npm test` |
| Lint | `npm run lint` |
| Format with Prettier | `npm run format` |

When debugging a single test file, run:
```bash
npm run jest -- --testPathPattern=relative/path/to/spec
```

## Project Structure

- `assets/js/toys/`: Individual toy implementations. Each module exports a `start` function that receives a DOM canvas/audio context.
- `assets/js/core/`: Reusable systems such as renderer initialization, audio analysis, camera controls, and device input helpers.
- `assets/js/utils/`: Small helpers (math, color, randomization, easing).
- `assets/css/`: Shared styles for HTML entry points.
- `assets/data/`: Static JSON or other payloads consumed by toys.
- `tests/`: Jest specs covering utilities and shared behaviors.
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

## Testing Expectations

- Prefer fast, deterministic tests in `tests/`. Mock audio contexts or DOM APIs when real instances are unnecessary.
- Use Jest’s ESM config from `package.json`; avoid CommonJS-specific globals.
- Keep tests colocated with utilities when practical, or place shared behaviors in `tests/`.

## Accessibility and UX

- Add keyboard shortcuts or focusable controls when introducing new UI elements.
- Provide feedback for permission failures, loading states, or unsupported browsers.
- Avoid autoplaying audio; let users control start/stop actions.

## Deployment Checklist

- `npm run build` completes without errors.
- Verify the generated `dist/` assets load via `npm run preview` or a simple static server.
- Spot-check microphone prompts and toy selection flows in the production build.

