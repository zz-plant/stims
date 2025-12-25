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

### How to add a new guide

1. Create the Markdown file under `docs/` with a clear title and a short purpose statement in the first paragraph.
2. Add a bullet link in this README under the list above so others can find it.
3. Cross-link the guide from the relevant primary doc (for example, reference new build steps from `DEVELOPMENT.md`).
4. If the guide introduces new scripts, toy entry points, or deployment steps, update the checklists and indexes they depend on.

## Onboarding highlights

- Use **Bun 1.2+** for installs and scripts (Node 22 is available as a fallback). Run `bun install` in a fresh clone to populate `bun.lock`-aligned dependencies.
- Run a **dev server smoke test** without opening a browser via `bun run dev:check` (or `npm run dev:check`) to confirm Vite wiring before you start coding.
- When adding or renaming toys, run `bun run check:toys` to ensure `assets/js/toys-data.js` entries, TypeScript modules, iframe HTML files, and `docs/TOY_SCRIPT_INDEX.md` stay in sync.

## Navigation tips

- Start with [`DEVELOPMENT.md`](./DEVELOPMENT.md) if you’re getting your environment ready; it mirrors the quick start in the repo root but adds tooling details and command matrices.
- Jump to [`TOY_DEVELOPMENT.md`](./TOY_DEVELOPMENT.md) when you’re building or adjusting an experience; it links back to reusable components in `assets/js/core/` and the toy index.
- Check [`DEPLOYMENT.md`](./DEPLOYMENT.md) before shipping changes to production so your build/preview/Pages flow matches the current configuration.
- Review [`ARCHITECTURE.md`](./ARCHITECTURE.md) when you need a refresher on renderer wiring, data flow, or how audio/motion inputs are shared.

## Doc maintenance checklist

- Add or update a link here whenever you create a new guide under `docs/` so contributors can discover it.
- Cross-link new scripts or workflows from the relevant guide (for example, record new npm/bun scripts in `DEVELOPMENT.md` and toy-scaffolding changes in `TOY_DEVELOPMENT.md`).
- Keep toy-related documentation synchronized: update `TOY_SCRIPT_INDEX.md` and `toys.md` when adding, renaming, or removing a toy entry point.
- Before shipping a PR, skim the docs above for stale script names, flags, or file paths introduced by your change.
