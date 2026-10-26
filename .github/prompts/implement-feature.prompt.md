---

name: implement-feature
description: "Guide for implementing a new feature end-to-end: from requirement to tested code to PR-ready. Use when adding a new capability, UI element, or behavior to Stims."
---

# Implement a Feature

You're adding a new feature to Stims. Follow this flow to stay focused.

## 1. Clarify the Requirement

- [ ] User story or issue is clear (what does the feature do?)
- [ ] Acceptance criteria are defined (how do we know it works?)
- [ ] Which area is this? Pick the matching skill in [`docs/agents/custom-capabilities.md`](../../docs/agents/custom-capabilities.md)

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
# Visit: http://localhost:5173/?agent=true
```

Repeat until locally confident.

## 4. Pre-commit Checks

```bash
# Full suite
bun run check

# If it passes, you're ready
```

## 5. Commit, PR, and handoff

Commit and open the PR per [Commit conventions](../../docs/COMMIT_CONVENTIONS.md)
and the [steward skill](../../.claude/skills/steward/SKILL.md); link the issue.
The handoff lists changed files, checks run, remaining gaps, and the PR link.

---

**Need guidance?** See:
- Skill index: `docs/agents/custom-capabilities.md`
- Runtime changes: `.agent/skills/modify-visualizer-runtime/SKILL.md`
- Preset changes: `.agent/skills/modify-preset-workflow/SKILL.md`
- UI changes: `docs/agents/visual-testing.md`
