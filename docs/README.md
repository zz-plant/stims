# Developer and contributor docs

This is the canonical documentation map for the repository. Root-level entry points (`README.md`, `CONTRIBUTING.md`, and `AGENTS.md`) should link here instead of duplicating large doc lists.

## Start here

- Human contributors: [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
- Agent contributors: [`../AGENTS.md`](../AGENTS.md) then [`agents/README.md`](./agents/README.md)
- Day-to-day implementation: [`DEVELOPMENT.md`](./DEVELOPMENT.md)

## Quick task routing

If you need to...

- Set up locally, run scripts, or understand quality gates: [`DEVELOPMENT.md`](./DEVELOPMENT.md)
- Add or modify a toy: [`TOY_DEVELOPMENT.md`](./TOY_DEVELOPMENT.md)
- Verify toy coverage/expectations: [`TOY_TESTING_SPEC.md`](./TOY_TESTING_SPEC.md)
- Validate high-impact behavior: [`QA_PLAN.md`](./QA_PLAN.md)
- Ship or update release flow: [`DEPLOYMENT.md`](./DEPLOYMENT.md)
- Understand runtime architecture: [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- Check page-level requirements: [`PAGE_SPECIFICATIONS.md`](./PAGE_SPECIFICATIONS.md)
- Use the MCP server: [`MCP_SERVER.md`](./MCP_SERVER.md)

## Full index by category

### Core workflows

- [`DEVELOPMENT.md`](./DEVELOPMENT.md) — setup, local scripts, and implementation workflow.
- [`DOCS_MAINTENANCE.md`](./DOCS_MAINTENANCE.md) — canonical checklist for docs synchronization and restructuring updates.
- [`QA_PLAN.md`](./QA_PLAN.md) — high-impact QA paths and automation coverage.
- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — deploy paths and release flow.
- [`TOY_DEVELOPMENT.md`](./TOY_DEVELOPMENT.md) — toy implementation patterns and checklists.
- [`TOY_TESTING_SPEC.md`](./TOY_TESTING_SPEC.md) — toy testing expectations.

### Implementation references

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — runtime composition and data flow.
- [`PAGE_SPECIFICATIONS.md`](./PAGE_SPECIFICATIONS.md) — page-level UX/spec requirements.
- [`TOY_SCRIPT_INDEX.md`](./TOY_SCRIPT_INDEX.md) — toy slug-to-entry-point map.
- [`toys.md`](./toys.md) — per-toy notes and implementation details.
- [`MCP_SERVER.md`](./MCP_SERVER.md) — MCP stdio server usage.
- [`FULL_REFACTOR_PLAN.md`](./FULL_REFACTOR_PLAN.md) — staged refactor roadmap.
- [`TECH_DEBT_REGISTER_2026-02.md`](./TECH_DEBT_REGISTER_2026-02.md) — prioritized technical debt inventory and next steps.

### Product, UX, and research docs

- [`FEATURE_SPECIFICATIONS.md`](./FEATURE_SPECIFICATIONS.md)
- [`FEATURE_AUDIT.md`](./FEATURE_AUDIT.md)
- [`SEO_AUDIT.md`](./SEO_AUDIT.md)
- [`USER_JOURNEY_CRITIQUE.md`](./USER_JOURNEY_CRITIQUE.md)
- [`USABILITY_AUDIT.md`](./USABILITY_AUDIT.md)
- [`UX_AUDIT_2026-02.md`](./UX_AUDIT_2026-02.md)
- [`AGENT_PLAYTEST_FUN_REPORT_2026-02.md`](./AGENT_PLAYTEST_FUN_REPORT_2026-02.md)
- [`SCREENSHOT_CRITIQUE_2026-02-16.md`](./SCREENSHOT_CRITIQUE_2026-02-16.md)
- [`TECH_STACK_CAPABILITY_RESEARCH_2026-02.md`](./TECH_STACK_CAPABILITY_RESEARCH_2026-02.md)
- [`LITERATURE.md`](./LITERATURE.md)
- [`stim-assessment.md`](./stim-assessment.md)
- [`stim-user-critiques.md`](./stim-user-critiques.md)

### Agent overlays

- [`agents/README.md`](./agents/README.md)
- [`agents/tooling-and-quality.md`](./agents/tooling-and-quality.md)
- [`agents/metadata-and-docs.md`](./agents/metadata-and-docs.md)
- [`agents/toy-development.md`](./agents/toy-development.md)
- [`agents/toy-workflows.md`](./agents/toy-workflows.md)
- [`agents/reference-docs.md`](./agents/reference-docs.md)

## Baseline conventions

- Package manager: **Bun** (`bun@1.3.8` in `package.json`).
- Main quality gate for JS/TS work: `bun run check`.
- Quick iteration gate: `bun run check:quick`.
- Toy consistency gate: `bun run check:toys`.

## Doc maintenance checklist

Follow [`DOCS_MAINTENANCE.md`](./DOCS_MAINTENANCE.md) for the canonical docs synchronization contract and per-change update requirements.
