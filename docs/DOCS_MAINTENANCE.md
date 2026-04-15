# Documentation maintenance guide

Use this guide as the single source of truth for keeping documentation aligned when workflows, scripts, structure, or toy inventory changes.

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
| New toy / renamed toy slug | Update `assets/data/toys.json`, then run `bun run generate:toys` so `docs/TOY_SCRIPT_INDEX.md` and `docs/toys.md` stay aligned; update `docs/TOY_DEVELOPMENT.md` only if the workflow itself changed. |
| Workflow behavior changes | Update the source workflow doc (for example `docs/DEVELOPMENT.md`, `docs/DEPLOYMENT.md`, `docs/QA_PLAN.md`). |
| Repo-local agent skill/workflow changes | `AGENTS.md`, `docs/agents/README.md`, `docs/agents/custom-capabilities.md`, `docs/agents/visual-testing.md`, `docs/agents/visualizer-workflows.md`, and `docs/MCP_SERVER.md` when they mention the changed route, command, or capability. |
| Docs restructuring | Update links and references across all entry points listed above. |

## PR metadata expectations

PR descriptions should include:

- A short summary,
- Explicit list of tests run,
- Explicit list of docs touched/added (or `None`).
