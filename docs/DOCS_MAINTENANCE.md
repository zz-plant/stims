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

## What to update by change type

| Change type | Required docs updates |
| --- | --- |
| New script or renamed script | `docs/DEVELOPMENT.md` plus agent overlays that reference scripts. |
| New toy / renamed toy slug | `docs/TOY_DEVELOPMENT.md`, `docs/TOY_SCRIPT_INDEX.md`, and `docs/toys.md` in the same change. |
| Workflow behavior changes | Update the source workflow doc (for example `docs/DEVELOPMENT.md`, `docs/DEPLOYMENT.md`, `docs/QA_PLAN.md`). |
| Docs restructuring | Update links and references across all entry points listed above. |

## PR metadata expectations

PR descriptions should include:

- A short summary,
- Explicit list of tests run,
- Explicit list of docs touched/added (or `None`).
