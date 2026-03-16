# Developer and contributor docs

This is the canonical documentation map for the repository. Root-level entry points (`README.md`, `CONTRIBUTING.md`, and `AGENTS.md`) should link here instead of duplicating large doc lists.

Stims positioning baseline: Stims is a browser-native **MilkDrop successor** with a broader collection of related audio-reactive toys. Keep this framing consistent in public and routing docs.

## Start here

- Human contributors: [`../CONTRIBUTING.md`](../CONTRIBUTING.md)
- Agent contributors: [`../AGENTS.md`](../AGENTS.md) then [`agents/README.md`](./agents/README.md)
- Day-to-day implementation: [`DEVELOPMENT.md`](./DEVELOPMENT.md)
- Repo-local agent capabilities: [`agents/custom-capabilities.md`](./agents/custom-capabilities.md)

## How to use this map

Use the docs in this order:

1. Start with the routing docs (`README.md`, `CONTRIBUTING.md`, `docs/README.md`, `docs/agents/README.md`).
2. Move to the current operational/spec docs for the task at hand.
3. Treat audit, critique, and roadmap docs as context and follow-up material unless they explicitly say they are authoritative.

If you only need the current operating surface, prefer the sections below named **Core workflows**, **Implementation references**, and **Agent overlays**.

## Quick task routing

If you need to...

- Align homepage/public messaging with MilkDrop-led positioning: [`PUBLIC_DOCS_SITE_MAP.md`](./PUBLIC_DOCS_SITE_MAP.md), [`PAGE_SPECIFICATIONS.md`](./PAGE_SPECIFICATIONS.md), [`FEATURE_SPECIFICATIONS.md`](./FEATURE_SPECIFICATIONS.md)
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
- [`IMPLEMENTATION_STATUS.md`](./IMPLEMENTATION_STATUS.md) — consolidated done/in-progress/pending implementation tracker.

### Product, UX, and research docs

These are useful context docs, but many are audits, critiques, or dated planning documents rather than day-to-day operating guides.

When these docs predate major positioning changes, keep findings intact and add a short historical-context note instead of rewriting conclusions as current product truth.

- [`FEATURE_SPECIFICATIONS.md`](./FEATURE_SPECIFICATIONS.md)
- [`FEATURE_AUDIT.md`](./FEATURE_AUDIT.md)
- [`SEO_AUDIT.md`](./SEO_AUDIT.md)
- [`USER_JOURNEY_CRITIQUE.md`](./USER_JOURNEY_CRITIQUE.md)
- [`USABILITY_AUDIT.md`](./USABILITY_AUDIT.md)
- [`UX_AUDIT_2026-02.md`](./UX_AUDIT_2026-02.md)
- [`UX_REDUCTION_CRITIQUE_2026-02.md`](./UX_REDUCTION_CRITIQUE_2026-02.md)
- [`AGENT_PLAYTEST_FUN_REPORT_2026-02.md`](./AGENT_PLAYTEST_FUN_REPORT_2026-02.md)
- [`SCREENSHOT_CRITIQUE_2026-02-16.md`](./SCREENSHOT_CRITIQUE_2026-02-16.md)
- [`COPYWRITING_AUDIT_2026-02.md`](./COPYWRITING_AUDIT_2026-02.md)
- [`OUTSTANDING_ISSUES_AUDIT_2026-03.md`](./OUTSTANDING_ISSUES_AUDIT_2026-03.md)
- [`CODE_REVIEW_PATTERNS_2026-03.md`](./CODE_REVIEW_PATTERNS_2026-03.md)
- [`FRONTEND_ANTI_PATTERNS_2026-03.md`](./FRONTEND_ANTI_PATTERNS_2026-03.md)
- [`TECH_STACK_CAPABILITY_RESEARCH_2026-02.md`](./TECH_STACK_CAPABILITY_RESEARCH_2026-02.md)
- [`COMPETITOR_BATTLECARD.md`](./COMPETITOR_BATTLECARD.md)
- [`PUBLIC_DOCS_SITE_MAP.md`](./PUBLIC_DOCS_SITE_MAP.md)
- [`LITERATURE.md`](./LITERATURE.md)
- [`stim-assessment.md`](./stim-assessment.md)
- [`stim-user-critiques.md`](./stim-user-critiques.md)

### Agent overlays

- [`agents/README.md`](./agents/README.md)
- [`agents/custom-capabilities.md`](./agents/custom-capabilities.md)
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
