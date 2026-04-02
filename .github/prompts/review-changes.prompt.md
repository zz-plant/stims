---
name: review-changes
description: "Checklist for reviewing code/docs before committing or merging. Use when doing self-review, pre-commit validation, or reviewing agent work."
---

# Review Changes Before Committing

Use this checklist before you push or open a PR.

## 1. Validate Quality Gate

```bash
# This must pass
bun run check
```

If anything fails, fix it before proceeding.

## 2. Code Review Checklist

### Structure & Clarity
- [ ] Code follows conventions in `.github/copilot-instructions.md`
- [ ] Variable/function names are descriptive
- [ ] Complex logic has comments explaining the "why"
- [ ] No dead code or unused imports

### Types & Safety
- [ ] No `@ts-nocheck` directives anywhere
- [ ] TypeScript passes strict mode
- [ ] Types are accurate (no `any` unless justified)

### Testing
- [ ] Tests added for new behavior
- [ ] Tests updated for changed behavior
- [ ] All tests pass (`bun run check` confirms)
- [ ] Edge cases covered (not just happy path)

### Performance
- [ ] No obvious inefficiencies added
- [ ] Loops don't unnecessarily run multiple times
- [ ] No blocking operations on main thread (if runtime-critical)

## 3. Documentation Review

### For code changes:
- [ ] Complex functions have JSDoc comments
- [ ] Architecture docs updated if design changed
- [ ] Examples in comments are current

### For doc changes:
- [ ] Links are relative and correct
- [ ] markdown formatting is clean
- [ ] Cross-link checklist done (see `docs/DOCS_MAINTENANCE.md`)
- [ ] No outdated info or broken links

## 4. Commit Message Review

- [ ] **Sentence case, no trailing period** (e.g., "Add preset search feature")
- [ ] Describes the change clearly
- [ ] Includes issue ref if applicable (e.g., "Fixes #123")
- [ ] Technical context in description (not just subject line)

## 5. PR Description Review (if applicable)

Include:
- [ ] What changed (high-level)
- [ ] Why it changed (context)
- [ ] Tests run / verified
- [ ] Docs touched (if any)
- [ ] Breaking changes? (if any)

**Example:**

```
## Description
Added preset search filtering to the library view.

## Testing
- Unit tests: `tests/milkdrop/search.test.ts`
- Integration test: `bun run test:integration` ✓
- Visual verification: Tested at `?agent=true` URL with 10+ presets

## Docs
- Updated: `docs/agents/visual-testing.md` (added search example)

## Checklist
- [x] `bun run check` passes
- [x] No `@ts-nocheck` directives
- [x] Tests added
```

## 6. Final Validation

```bash
# One last check before pushing
bun run check

# Make sure you're on the right branch
git status

# Review your changes
git diff HEAD~1
```

## 7. Update Session Context

Edit `/memories/session/stims-context.md`:
- Task complete ✓
- Final commit hash
- PR link (if opened)

---

## Self-Review Red Flags

Stop and fix if you see:
- ❌ `bun run check` fails
- ❌ New `@ts-nocheck` or `// @ts-ignore`
- ❌ Tests don't pass locally
- ❌ Broken links in docs
- ❌ Commit message unclear
- ❌ No test for new behavior
- ❌ Architecture test fails

## Before Requesting Review

- [ ] All checks pass locally
- [ ] You've tested manually (visually if UI)
- [ ] Commit history is clean (no WIP commits)
- [ ] PR description is complete
- [ ] You can explain why each change was needed

---

**Files that trigger cross-link checks:**
- Any doc file in `docs/` (check `docs/DOCS_MAINTENANCE.md`)
- `README.md`, `AGENTS.md`, `CONTRIBUTING.md`
- `.github/copilot-instructions.md`
- `.agent/skills/` or `.agent/workflows/`

**See:**
- Full gate: `bun run check`
- Specific gates: `bun run check:architecture`, `bun run check:toys`, etc.
- Docs maintenance: `docs/DOCS_MAINTENANCE.md`
