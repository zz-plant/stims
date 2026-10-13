---
name: update-docs
description: "Guide for updating or adding agent documentation: from planning to validation to cross-linking. Use when adding/editing agent guides, architecture docs, or README updates."
---

# Update Agent or Architecture Docs

You're updating or adding documentation. Follow this flow.

## 1. Determine the Document Type

| Type | Location | When to update | Validation |
|------|----------|---------------|----|
| Agent guidance | `docs/agents/*.md` | Agent workflows, tools, task routing | Links stay current |
| Architecture | `docs/*.md` | Runtime behavior, design decisions | Accuracy with code |
| README alignment | `README.md`, `AGENTS.md`, etc. | When adding/moving docs | `docs/DOCS_MAINTENANCE.md` |
| In-code comments | `src/`, `packages/`, `scripts/`, `tests/` | Complex logic, non-obvious patterns | Stays in sync with code |

## 2. Plan Your Changes

- [ ] Is this new doc or updating existing?
- [ ] Does this affect other READMEs? (check `docs/DOCS_MAINTENANCE.md`)
- [ ] Are you adding/moving/removing? (requires cross-file updates)

## 3. Write or Edit the Doc

- [ ] Start with useful content; avoid repeating the title as a purpose statement
- [ ] Progressive disclosure (start simple, drill into detail)
- [ ] Links to related docs are relative paths
- [ ] Code examples are current and tested

### Markdown checklist:
- [ ] Headings hierarchy is logical (h1 → h2 → h3)
- [ ] Lists use consistent formatting
- [ ] Code blocks have language tags (```bash, ```typescript)
- [ ] Links use relative paths: `[Testing](../../docs/TESTING.md)`

## 4. Validate Links and Format

```bash
# Documentation references and public claims
bun run check:doc-references
bun run check:readme-claims

# Also run affected generator checks and verify changed command examples
```

## 5. Cross-Link Maintenance

If you added, moved, renamed, or removed a doc:

- [ ] Update `docs/README.md` (canonical index)
- [ ] Update `docs/agents/README.md` (task routing)
- [ ] Update `AGENTS.md` (root entry point)
- [ ] Update `.github/copilot-instructions.md` if it mentions the doc
- [ ] Update `docs/DOCS_MAINTENANCE.md` if the contract changed

See `docs/DOCS_MAINTENANCE.md` for the full synchronization checklist.

## 6. Check Alignment

Read through:
- [ ] `docs/README.md` — Is your doc listed where expected?
- [ ] `docs/agents/README.md` — Does task routing link to it?
- [ ] `AGENTS.md` — Should it be mentioned in quick-start?

## 7. Record the result

Include changed files, checks run, remaining gaps, and any PR link in the task handoff. Do not require a machine-specific session file.

## 8. Commit & PR

- Commit message: Conventional Commits, sentence case, no trailing period (e.g., "docs: Update visual testing workflows")
- PR description: List which docs changed, why, and any cross-links updated

---

**Common patterns:**

**For new agent guidance:**
- Add to `.agent/skills/` or `docs/agents/`
- Link from `docs/agents/README.md` task routing
- Update `.github/copilot-instructions.md` if high-level

**For architecture docs:**
- Add to `docs/` with related docs linked
- Reference in `.github/copilot-instructions.md` "When to Read" section
- Link from `docs/README.md`

**For README changes:**
- Follow `docs/DOCS_MAINTENANCE.md` checklist entirely
- Update affected entry points in the same commit; keep package docs aligned when relevant

---

**Anti-patterns:**
- Doc exists but isn't linked from index (invisible)
- Multiple sources of truth (same info in 2+ places)
- Links that break (relative paths or typos)
- Outdated commands in examples

**See:**
- `docs/DOCS_MAINTENANCE.md` — Full cross-link contract
- `docs/README.md` — Canonical index
- Existing agent docs: `docs/agents/`
