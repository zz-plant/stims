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

This runs Biome checks, TypeScript typechecking, and tests.

Useful fast path while iterating:

```bash
bun run check:quick
```

## Task-specific checks

- Toy registration/docs consistency:

  ```bash
  bun run check:toys
  ```

- Generated SEO artifacts validation:

  ```bash
  bun run check:seo
  ```

- Targeted test execution:

  ```bash
  bun run test tests/path/to/spec.test.ts
  ```

## Docs-only updates

For Markdown-only edits, you can skip typecheck/tests unless the change modifies commands, paths, or workflow-critical instructions that should be validated.
