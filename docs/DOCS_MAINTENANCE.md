# Documentation maintenance guide

Use this guide as the single source of truth for keeping documentation aligned when workflows, scripts, structure, or catalog inventory changes.

## Canonical docs index

- `docs/README.md` is the canonical documentation index.
- When docs are added, renamed, moved, archived, or deleted, update `docs/README.md` in the same change.

## Cross-link alignment contract

When restructuring docs, keep these entry points in sync:

- `README.md`
- `CONTRIBUTING.md`
- `AGENTS.md`
- `docs/README.md`
- `docs/agents/README.md`
- `docs/agents/agent-handoffs.md` when agent bootstrap, delegation, or return-contract guidance changes
- `docs/agents/custom-capabilities.md` when repo-local agent skills/workflows change
- `docs/agents/visual-testing.md` when agent browser-verification routes or expectations change
- `docs/agents/visualizer-workflows.md` when repo-local workflow routing or command guidance changes
- `docs/MCP_SERVER.md` when repo-local capability discovery or MCP-visible workflow metadata changes

## What to update by change type

| Change type | Required docs updates |
| --- | --- |
| New script or renamed script | `docs/DEVELOPMENT.md` plus `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `docs/agents/README.md`, `docs/agents/tooling-and-quality.md`, `docs/agents/visualizer-workflows.md`, and `docs/MCP_SERVER.md` when they reference the changed script. |
| MCP tool added, removed, or renamed | `docs/MCP_SERVER.md`, the instructions in `scripts/mcp-shared.ts`, and `CHANGELOG.md`. A removal breaks every client that calls the tool, so say what replaces it. |
| Workflow behavior changes | Update the source workflow doc (for example `docs/DEVELOPMENT.md`, `docs/DEPLOYMENT.md`, `docs/QA_PLAN.md`). |
| Repo-local agent skill/workflow changes | `AGENTS.md`, `docs/agents/README.md`, `docs/agents/custom-capabilities.md`, `docs/agents/visual-testing.md`, `docs/agents/visualizer-workflows.md`, and `docs/MCP_SERVER.md` when they mention the changed route, command, or capability. |
| New or changed guard script | Update the guard's docblock — it is the source of truth. Regenerate with `bun run generate:guardrails`; `check:guardrails-doc` fails if `docs/GUARDRAILS.md` is stale. |
| New `src/` module over 400 lines | Add a file-level docblock saying what it owns and what it leaves to others (`bun run check:module-docs`). |
| Docs restructuring | Update links and references across all entry points listed above. |

## Current guidance, proposals, and history

- Keep usage and current capabilities in `docs/USER_GUIDE.md` and `docs/IMPLEMENTATION_STATUS.md`; link implementation owners and state support limits.
- Treat dated reports and design studies as snapshots. Preserve measurements and provenance instead of rewriting them as current results. If an active checklist is superseded, retain its snapshot under `docs/archive/` and link the replacement.
- Avoid copying changing script, test, catalog, or certification counts into prose. Link the runner, command discovery, or canonical manifest.
- Edit canonical sources for generated references and public pages, then regenerate and check them. Do not hand-edit generated output.
- Validate local Markdown links as well as repo-path literals. Site-root links in learn sources resolve against the generated website.
- Check package publication separately from workspace builds; label install instructions for an unpublished release accordingly.

## Page voice

Don't open a page by narrating itself. If the title, outline, or a table's header row already conveys the scope, don't start with "This document/guide/page covers..." — start with the content, and keep only sentences that add information the structure doesn't.

## PR metadata expectations

PR descriptions should include:

- A short summary,
- Explicit list of tests run,
- Explicit list of docs touched/added (or `None`).
