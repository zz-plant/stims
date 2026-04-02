---
name: fix-bug
description: "Guide for diagnosing and fixing a bug end-to-end: from reproduction to test to verification. Use when addressing reported issues or regressions."
---

# Fix a Bug

You have a bug to fix. Follow this flow to debug systematically.

## 1. Reproduce and Understand

- [ ] Bug is reproducible (use `?agent=true` URL if visual)
- [ ] Understand: Is this runtime behavior, preset loading, or UI?
- [ ] Check console/DevTools for errors
- [ ] Identify: Which system is affected? (core, milkdrop, bootstrap, etc.)

## 2. Write a Failing Test

Before fixing, write a test that **reproduces the bug**:

```bash
# Add test to tests/path/to/spec.test.ts
# It should fail initially

bun run test tests/path/to/spec.test.ts
```

The test failing confirms you've reproduced the issue.

## 3. Fix the Bug

- [ ] Edit the relevant source file (check Task Router if unsure)
- [ ] Keep changes minimal and focused
- [ ] Verify the test now passes:

```bash
bun run test tests/path/to/spec.test.ts
```

## 4. Verify No Regressions

```bash
# Quick check
bun run check:quick

# Test the area you modified
bun run test:integration  # if runtime/behavior
bun run test:compat       # if preset-related

# Visual verification (if UI-related)
bun run dev
# Test at: http://localhost:5173/milkdrop/?agent=true
```

## 5. Full Validation

```bash
bun run check
```

## 6. Update Session Context

Edit `/memories/session/stims-context.md`:
- Root cause identified
- Files changed
- Test file path
- Reproduction steps verified

## 7. Commit & PR

- Commit message: Sentence case (e.g., "Fix preset loading race condition")
- Include: root cause in description, step to reproduce, verification in the PR

---

**Getting stuck?** See:
- Runtime issues: `.agent/skills/verify-visualizer-work/SKILL.md` → Testing section
- Visual issues: `docs/agents/visual-testing.md` → Troubleshooting
- Architecture: `docs/ARCHITECTURE.md`
