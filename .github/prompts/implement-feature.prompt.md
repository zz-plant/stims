---
name: implement-feature
description: "Guide for implementing a new feature end-to-end: from requirement to tested code to PR-ready. Use when adding a new capability, UI element, or behavior to Stims."
---

# Implement a Feature

You're adding a new feature to Stims. Follow this flow to stay focused.

## 1. Clarify the Requirement

- [ ] User story or issue is clear (what does the feature do?)
- [ ] Acceptance criteria are defined (how do we know it works?)
- [ ] Which area is this? Check **Task Router** in `.github/copilot-instructions.md`

## 2. Plan Implementation

- [ ] Pick the right task skill: runtime vs. preset vs. UI?
- [ ] Identify which files need changes
- [ ] Identify which test file(s) to add
- [ ] Check for similar patterns in the codebase

## 3. Implement with Quick Feedback

Run this loop:

```bash
# 1. Edit code
# 2. Quick validation
bun run check:quick

# 3. Targeted tests
bun run test tests/path/to/new.test.ts

# 4. Visual check (if UI-related)
bun run dev
# Visit: http://localhost:5173/milkdrop/?agent=true
```

Repeat until locally confident.

## 4. Pre-commit Checks

```bash
# Full suite
bun run check

# If it passes, you're ready
```

## 5. Update Task Context

Edit `/memories/session/stims-context.md`:
- List files changed
- List tests added
- Note any gotchas

## 6. Commit & PR

- Commit message: Sentence case, no period (e.g., "Add preset search filtering")
- PR: Include what changed, which tests passed, and link to the issue

---

**Need guidance?** See:
- Task Router: `.github/copilot-instructions.md` → Task Routing section
- Runtime changes: `.agent/skills/modify-visualizer-runtime/SKILL.md`
- Preset changes: `.agent/skills/modify-preset-workflow/SKILL.md`
- UI changes: `docs/agents/visual-testing.md`
