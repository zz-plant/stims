# Tooling and Quality Checks

## Bootstrap the repo state

When you are dropped into the repo without confidence about install state or recent drift, start with:

```bash
bun run setup:codex --status
bun run setup:codex --print-plan
bun run setup:codex
```

`setup:codex` is the repo bootstrap for agent sessions. By default it installs dependencies and runs `bun run check:quick`. Repeated runs skip `bun install` automatically when `node_modules` and the local manifest fingerprint already look current.

When you want to keep the dev server, local model roles, and a background watcher warm between edits, use:

```bash
bun run session:codex -- --profile review
```

Higher-throughput session profiles:

- `compat` for compatibility-focused watcher loops
- `integration` for browser-backed integration watcher loops
- `parity` for capture and perf runs with a warm dev server and local model roles

Useful controls:

```bash
bun run session:codex -- --status
bun run session:codex -- --stop
# If you started a non-default port, repeat it here:
bun run session:codex -- --port 4173 --stop
```

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

- For a warm long-lived session on higher-memory local machines, prefer:

  ```bash
  bun run session:codex -- --profile review
  ```

- For install/check bootstrap specifically, prefer:

  ```bash
  bun run setup:codex
  ```

- For task-to-model routing on machines with LM Studio helpers, prefer:

  ```bash
  bun run model:codex -- --mode auto --task "triage a preset crash" --no-exec
  ```

## Linting and formatting

- Biome is the formatter/linter of record.
- Use the package scripts rather than ad-hoc commands where possible.
- The shared Biome scripts cover the main code paths plus repo-root config and
  HTML surfaces that used to sit outside the quality gate.

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
Its independent checks run in parallel by default; add `-- --serial` when debugging a specific failing step.

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
- The pre-commit hook runs a staged-file Biome check so it does not rewrite files
  after they have already been staged.
- If wrappers are missing or stale, reinstall dependencies (or run `bun run prepare`) to regenerate them locally.

## Docs-only updates

For Markdown-only edits, you can skip typecheck/tests unless the change modifies commands, paths, or workflow-critical instructions that should be validated.

## Quick CLI reference for agents

Common commands to keep nearby while implementing:

### Development

```bash
# Warm long-lived agent session
bun run session:codex -- --profile review

# Route a task to the local LM Studio helper stack
bun run model:codex -- --mode auto --task "review a loader bug" --no-exec

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
