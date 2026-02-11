# Developer and Contributor Docs

This directory is organized by **audience + workflow** so contributors and agents can quickly find the right guidance.

## Start here

- Human contributors: [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
- Agent contributors: [`../AGENTS.md`](../AGENTS.md) then [`agents/README.md`](./agents/README.md)
- Day-to-day implementation: [`DEVELOPMENT.md`](./DEVELOPMENT.md)

## Docs by purpose

### Build, test, and ship

- [`DEVELOPMENT.md`](./DEVELOPMENT.md) — setup, scripts, and local workflows.
- [`QA_PLAN.md`](./QA_PLAN.md) — high-impact QA paths and automated coverage.
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — build/preview/deploy guidance.

### Implementation references

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — runtime composition and data flow.
- [`TOY_DEVELOPMENT.md`](./TOY_DEVELOPMENT.md) — implementation patterns for toys.
- [`TOY_SCRIPT_INDEX.md`](./TOY_SCRIPT_INDEX.md) — slug-to-entry-point map.
- [`PAGE_SPECIFICATIONS.md`](./PAGE_SPECIFICATIONS.md) — page-level specs.
- [`MCP_SERVER.md`](./MCP_SERVER.md) — MCP stdio server usage.

### Product and research context

- [`FEATURE_SPECIFICATIONS.md`](./FEATURE_SPECIFICATIONS.md)
- [`FEATURE_AUDIT.md`](./FEATURE_AUDIT.md)
- [`SEO_AUDIT.md`](./SEO_AUDIT.md)
- [`stim-assessment.md`](./stim-assessment.md)
- [`stim-user-critiques.md`](./stim-user-critiques.md)
- [`USER_JOURNEY_CRITIQUE.md`](./USER_JOURNEY_CRITIQUE.md)
- [`UX_AUDIT_2026-02.md`](./UX_AUDIT_2026-02.md)
- [`UX_AUDIT_2026-02_FOLLOWUP.md`](./UX_AUDIT_2026-02_FOLLOWUP.md)
- [`UX_AUDIT_2026-02_ITERATION_2.md`](./UX_AUDIT_2026-02_ITERATION_2.md)
- [`LITERATURE.md`](./LITERATURE.md)
- [`TECH_STACK_CAPABILITY_RESEARCH_2026-02.md`](./TECH_STACK_CAPABILITY_RESEARCH_2026-02.md)

### Agent overlays

- [`agents/README.md`](./agents/README.md)
- [`agents/tooling-and-quality.md`](./agents/tooling-and-quality.md)
- [`agents/metadata-and-docs.md`](./agents/metadata-and-docs.md)
- [`agents/toy-development.md`](./agents/toy-development.md)
- [`agents/toy-workflows.md`](./agents/toy-workflows.md)
- [`agents/reference-docs.md`](./agents/reference-docs.md)

## Current baseline conventions

- Package manager: **Bun** (`bun@1.3.8` declared in `package.json`).
- Main quality gate for JS/TS work: `bun run check`.
- Quick gate for iteration: `bun run check:quick`.
- Toy consistency check (metadata + docs + entry points): `bun run check:toys`.

## Doc maintenance checklist

When you add or change workflows:

1. Update the source workflow doc (for example `DEVELOPMENT.md` or `TOY_DEVELOPMENT.md`).
2. Update this index if a file moved or a new guide was added.
3. Keep contributor/agent entry points aligned:
   - `README.md`
   - `CONTRIBUTING.md`
   - `AGENTS.md`
   - `docs/agents/README.md`
4. For toy additions/renames, update `TOY_SCRIPT_INDEX.md` and `toys.md` in the same PR.
