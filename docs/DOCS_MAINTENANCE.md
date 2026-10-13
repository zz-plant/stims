# Documentation maintenance guide

## Canonical docs index

- `docs/README.md` is the canonical documentation index.
- When docs are added, renamed, moved, archived, or deleted, update `docs/README.md` in the same change.

## Cross-link alignment contract

When restructuring docs, keep these entry points in sync:

- `README.md` and `CONTRIBUTING.md`, for people
- `AGENTS.md`, for agents. `.claude/CLAUDE.md` imports it, and `.github/AGENTS.md` and `.github/copilot-instructions.md` only point to it: add guidance to `AGENTS.md`, and to those files only what is specific to their tool
- `docs/README.md` and `docs/agents/README.md`, the indexes

`bun run check:doc-references` checks the paths and `bun run` commands named in all of them, in `docs/`, `.agent/`, `.claude/`, `.opencode/`, and the Markdown under `.github/`.

## What to update by change type

| Change type | Required docs updates |
| --- | --- |
| New script or renamed script | `docs/DEVELOPMENT.md`, plus any entry point or agent page that names the script; `check:doc-references` flags a `bun run` reference to a script that no longer exists. |
| MCP tool added, removed, or renamed | `docs/MCP_SERVER.md`, the instructions in `scripts/mcp-shared.ts`, and `CHANGELOG.md`. A removal breaks every client that calls the tool, so say what replaces it. |
| Workflow behavior changes | Update the source workflow doc (for example `docs/DEVELOPMENT.md`, `docs/DEPLOYMENT.md`, `docs/QA_PLAN.md`). |
| Repo-local agent skill changes | `docs/agents/custom-capabilities.md` and `scripts/mcp-shared.ts` (`bun run check:skill-index` enforces both), plus `docs/MCP_SERVER.md` when the MCP-visible contract changes. |
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

## Commit and PR metadata

Commit subjects follow [Commit conventions](./COMMIT_CONVENTIONS.md). A PR description says what changed and why, lists each check run with its result, and names the docs touched (or `None`); `bun run pr:body` scaffolds one from the diff and `bun run pr:body -- --check <file>` applies CI's rules. The [steward skill](../.claude/skills/steward/SKILL.md) covers the rest of a PR's life.
