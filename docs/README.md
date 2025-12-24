# Developer Docs

This folder contains resources for contributors who are building or maintaining the Stim Webtoys Library:

- [`DEVELOPMENT.md`](./DEVELOPMENT.md): day-to-day setup, scripts, workflow, and performance/testing expectations.
- [`TOY_DEVELOPMENT.md`](./TOY_DEVELOPMENT.md): playbook for creating or updating toy experiences, including audio, rendering, and debugging tips.
- [`TOY_SCRIPT_INDEX.md`](./TOY_SCRIPT_INDEX.md): map from each toy/visualizer to the JS/TS entry points it uses.
- [`stim-assessment.md`](./stim-assessment.md): Assessment findings and remediation plans.
- [`toys.md`](./toys.md): per-toy notes, presets, and other focused references.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md): end-to-end app architecture, loader flow, and core runtime composition with diagrams.
- [`DEPLOYMENT.md`](./DEPLOYMENT.md): build, preview, static hosting layout, and Cloudflare Worker deployment steps.
- [`MCP_SERVER.md`](./MCP_SERVER.md): how to launch and use the MCP stdio server (`scripts/mcp-server.ts`) and its registered tools.

If you add new tooling or patterns, update these docs so the next contributor has a reliable starting point.

## Onboarding highlights

- Use **Bun 1.2+** for installs and scripts (Node 22 is available as a fallback). Run `bun install` in a fresh clone to populate `bun.lock`-aligned dependencies.
- Run a **dev server smoke test** without opening a browser via `bun run dev:check` (or `npm run dev:check`) to confirm Vite wiring before you start coding.
- When adding or renaming toys, run `bun run check:toys` to ensure `assets/js/toys-data.js` entries, TypeScript modules, iframe HTML files, and `docs/TOY_SCRIPT_INDEX.md` stay in sync.
