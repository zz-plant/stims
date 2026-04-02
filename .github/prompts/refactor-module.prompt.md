---
name: refactor-module
description: "Guide for refactoring a module: from analysis to clean code to verified tests. Use when improving code structure, removing duplication, or improving maintainability."
---

# Refactor a Module

You're refactoring code to improve structure/clarity. Stay focused with this flow.

## 1. Define the Refactor Scope

- [ ] Which module/file(s) are you refactoring?
- [ ] What are you improving? (duplication, clarity, performance, tests, types)
- [ ] Existing tests still pass? (baseline)

```bash
# Get baseline
bun run test tests/path/to/spec.test.ts
```

## 2. Identify Test Coverage

- [ ] Which tests cover this module?
- [ ] Are they comprehensive?
- [ ] Do you need to add tests before refactoring?

**Rule**: Refactor with tests in place, not after.

## 3. Refactor Incrementally

- [ ] Make small changes (one responsibility per commit)
- [ ] Run tests after each change:

```bash
bun run check:quick
bun run test tests/path/to/spec.test.ts
```

- [ ] Don't wait until the end to validate

## 4. Validate Structure

```bash
# Check architecture boundaries
bun run check:architecture

# Check types still pass
bun run check:quick
```

## 5. Full Validation

```bash
bun run check
```

## 6. Document the Refactor

In the commit/PR, explain:
- What changed and why
- No functional behavior changed (if true)
- Tests still passing
- Performance impact (if any)

## 7. Update Session Context

Edit `/memories/session/stims-context.md`:
- Module refactored
- New structure/pattern
- Test coverage confirmed
- Files touched

---

**Anti-patterns to avoid:**
- Refactor + behavior change in same PR (split it)
- Refactor without tests in place
- Large refactors without incremental validation

**See also:**
- Code conventions: `.github/copilot-instructions.md`
- Architecture: `docs/ARCHITECTURE.md`
- Testing: `.agent/skills/verify-visualizer-work/SKILL.md`
