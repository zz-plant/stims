---

name: update-test
description: "Add or repair behavioral tests using the repo's Bun runner and browser harness."
---

# Add or update tests

## Choose the environment

Use `bun:test` for root and package suites. Place root tests under `tests/unit`, `tests/compat`, `tests/corpus`, or `tests/e2e`; find an existing test for the same owner before creating a new fixture. Package tests belong in that package's `tests/` directory and use its own Bun configuration.

| Need                                             | Environment                      |
| ------------------------------------------------ | -------------------------------- |
| Pure logic or a simulated DOM                    | Unit suite with the root preload |
| Compatibility semantics                          | Compatibility or corpus suite    |
| Real layout, permissions, GPU, or audio behavior | Playwright browser harness       |
| Standalone library behavior                      | Package suite                    |

## Write a behavioral contract

- Import `describe`, `expect`, and `test` from `bun:test`.
- Assert the observable result, numeric semantics, or AST/IR structure.
- Cover meaningful boundary and failure cases without mirroring the implementation.
- Use injected dependencies for isolation; avoid adding cache-busting imports.
- Use existing browser helpers and startup waits for real-browser tests. A DOM simulation is not browser proof.

For a complete local example, read `tests/unit/frontend-url-state.test.ts`. For browser setup, read `tests/e2e/agent-integration.test.ts` and [browser automation](../../docs/agents/browser-automation.md).

## Run and report

```bash
bun run test -- tests/unit/frontend-url-state.test.ts
bun run test:unit
bun run test:compat
bun run check
```

Choose the profile matching your change. `bun run test` defaults to unit + compatibility; `bun run check` adds corpus and package checks. Run affected browser tests explicitly when the change needs browser evidence. Use `--watch` for iteration and `--no-bail` to see failures across files.

Report what ran, what skipped, and any unresolved gap. See [Testing](../../docs/TESTING.md) for all profiles and CI behavior.
