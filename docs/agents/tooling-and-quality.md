# Tooling and Quality Checks

## Package manager and script execution

- Use **Bun** for installs and scripts.
- When dependency manifests change and lockfile updates are expected, run:

  ```bash
  bun install
  ```

- For reproducible installs that must not modify the lockfile (for example CI), run:

  ```bash
  bun install --frozen-lockfile
  ```

- Run project scripts with:

  ```bash
  bun run <script>
  ```

## Linting and formatting

- Biome is the formatter/linter of record.
- Use the package scripts rather than ad-hoc commands where possible.

## Required gates for JS/TS changes

Run before commit:

```bash
bun run check
```

This runs a no-`@ts-nocheck` guard, Biome checks, toy/docs drift validation, SEO surface checks, the architecture boundary guard, TypeScript typechecking, and tests.

Useful fast path while iterating:

```bash
bun run check:quick
```

`check:quick` also includes the no-`@ts-nocheck` guard.
It also verifies that `public/milkdrop-presets/catalog.json` stays synced with `assets/data/milkdrop-parity/measured-results.json`.

## Task-specific checks

- Toy registration/docs consistency:

  ```bash
  bun run check:toys
  ```

- Architecture dependency boundaries:

  ```bash
  bun run check:architecture
  ```

- SEO surface integrity:

  ```bash
  bun run check:seo
  ```

- Targeted test execution:

  ```bash
  bun run test tests/path/to/spec.test.ts
  ```

- Unit-only test sweep:

  ```bash
  bun run test:unit
  ```

- Browser-backed integration sweep:

  ```bash
  bun run test:integration
  ```

## Husky hook bootstrap and generated wrappers

- Husky hooks are bootstrapped through the `prepare` script in `package.json`:

  ```bash
  bun run prepare
  ```

  In normal development this runs automatically during `bun install`.
- `.husky/*` files (for example, `.husky/pre-commit`) are the user-maintained hook sources and should be committed.
- `.husky/_/*` shim wrappers are generated artifacts from `husky install`; do not hand-edit or commit them.
- If wrappers are missing or stale, reinstall dependencies (or run `bun run prepare`) to regenerate them locally.

## Docs-only updates

For Markdown-only edits, you can skip typecheck/tests unless the change modifies commands, paths, or workflow-critical instructions that should be validated.

## Quick CLI reference for agents

Common commands to keep nearby while implementing:

### Development

```bash
# Start the dev server
bun run dev

# Specifically test the MilkDrop visualizer
bun run play:toy milkdrop
```

### During implementation (iterate-test-verify loop)

```bash
# Fast syntax/type/lint check (use frequently)
bun run check:quick

# Run a specific test file while developing
bun run test tests/path/to/spec.test.ts

# Run all unit tests
bun run test:unit

# Run integration tests (for runtime/behavior changes)
bun run test:integration

# Run compatibility tests (for preset/editor changes)
bun run test:compat
```

### Before committing

```bash
# Full quality gate (syntax, types, tests, architecture, SEO, toy manifest)
bun run check
```

### Task-specific checks

```bash
# Architecture boundary violations
bun run check:architecture

# Toy manifest drift
bun run check:toys

# SEO surface issues
bun run check:seo
```

### Formatting and linting

```bash
# Check for lint/format issues
bun run lint

# Auto-fix lint/format issues
bun run lint:fix

# Format code
bun run format
```

For more details, see [`.agent/skills/verify-visualizer-work/SKILL.md`](../../.agent/skills/verify-visualizer-work/SKILL.md).
