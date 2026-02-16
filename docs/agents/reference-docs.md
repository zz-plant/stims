# Reference Docs and Code Hotspots

## Primary docs

- `docs/DEVELOPMENT.md` — scripts and contributor workflow baseline.
- `docs/TOY_DEVELOPMENT.md` — full toy implementation guide.
- `docs/TOY_TESTING_SPEC.md` — toy testing strategy.
- `docs/ARCHITECTURE.md` — runtime architecture and flow.
- `docs/DEPLOYMENT.md` — shipping and hosting guidance.

## High-signal code locations

- `assets/js/toys/` — toy modules.
- `assets/data/toys.json` (or `assets/data/toys.yaml` / `assets/data/toys.yml`) — toy metadata source of truth.
- `assets/js/loader.ts` — loader/query param routing.
- `assets/js/core/toy-runtime.ts` — shared toy runtime plumbing.
- `assets/js/utils/start-audio.ts` — mic/demo audio unlock path.
- `toys/` — standalone page-backed toy entry points.

## Config and entry points

- `package.json` — scripts, package manager, tool versions.
- `vite.config.js` — bundling and dev-server behavior.
- `index.html` and `toy.html` — app and toy shell entry points.

## Fast triage

1. Toy missing in UI → verify `assets/data/toys.json` entry.
2. Toy not loading → inspect loader behavior in `assets/js/loader.ts`.
3. No audio response → inspect `start-audio.ts` and runtime wiring.
4. Docs mismatch → refresh `docs/TOY_SCRIPT_INDEX.md` and `docs/toys.md`.
