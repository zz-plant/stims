# Metadata and Docs Expectations

## Commit and PR metadata

- Commit titles: sentence case, no trailing period.
- PR summaries must include:
  - short summary,
  - explicit list of tests run,
  - explicit list of docs touched/added.

Suggested PR body template:

```md
Summary
- <short summary>

Tests
- <command>

Docs
- <path or None>
```

## Documentation upkeep rules

When behavior, scripts, or structure changes:

1. Update the source-of-truth workflow docs under `docs/`.
2. Update the docs map in `docs/README.md` if files moved or were added.
3. Keep cross-links aligned across:
   - `README.md`
   - `CONTRIBUTING.md`
   - `AGENTS.md`
   - `docs/agents/README.md`

## Toy docs synchronization

When adding/removing/renaming toy slugs, update all related docs in the same change:

- `docs/TOY_DEVELOPMENT.md`
- `docs/TOY_SCRIPT_INDEX.md`
- `docs/toys.md`
