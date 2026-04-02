---
name: update-test
description: "Guide for adding or fixing tests: from understanding test patterns to validation. Use when writing unit tests, integration tests, or updating test fixtures."
---

# Update or Add Tests

You're adding or fixing tests. Follow this flow.

## 1. Understand the Test Pattern

- [ ] Is this a unit test (no browser), integration test (Playwright), or compat test?
- [ ] Find a similar existing test as a template

```bash
# For code in assets/js/milkdrop/foo.ts
# Look for: tests/milkdrop/foo.test.ts

# List tests by type
bun run test:unit      # Quick unit tests
bun run test:integration  # Browser-based (slower)
```

## 2. Determine Test Type

| Test Type | When to use | Speed | Example |
|-----------|------------|-------|---------|
| Unit | Pure functions, no DOM | <100ms each | compilation, parsing |
| Integration | Browser behavior, UI, interaction | <2s each | preset loading, audio detection |
| Compat | MilkDrop parity, compatibility | <5s each | preset rendering match |

## 3. Write or Fix the Test

- [ ] Test file path matches code file path (e.g., `foo.ts` → `tests/foo.test.ts`)
- [ ] Test name is descriptive (e.g., "should parse preset metadata correctly")
- [ ] Use `describe()` to group related tests
- [ ] Use `it()` or `test()` for individual cases

### Quick template:

```typescript
import { describe, it, expect } from "vitest";
import { functionUnderTest } from "../assets/js/path/to/code";

describe("functionUnderTest", () => {
  it("should do the right thing", () => {
    const result = functionUnderTest(input);
    expect(result).toBe(expected);
  });
});
```

## 4. Run the Test

```bash
# Try just this test file
bun run test tests/path/to/test.test.ts

# If it fails, read the error message carefully
# Update code or test as needed
```

## 5. Expand Test Coverage

Add cases for:
- [ ] Happy path (common case)
- [ ] Edge cases (empty input, null, etc.)
- [ ] Error cases (should throw)

## 6. Run Related Tests

```bash
# Your test + related tests in same area
bun run test tests/milkdrop/**

# Or run all of one type
bun run test:unit
bun run test:integration
```

## 7. Full Validation

```bash
bun run check
```

## 8. Update Session Context

Edit `/memories/session/stims-context.md`:
- Test file path
- What it covers
- Coverage gaps (if any)

---

**Test naming conventions:**
- Describe the behavior: "should load preset correctly"
- Not the implementation: "should call fetch"
- Use "it" (not "test") for readability

**Debugging test failures:**
```bash
# Run in watch mode
bun run test:watch tests/path/to/test.test.ts

# Run with verbose output
bun run test tests/path/to/test.test.ts --reporter=verbose
```

**See also:**
- Vitest docs: https://vitest.dev/
- Existing tests: `tests/` directory
- Integration test examples: `tests/milkdrop/` with Playwright
