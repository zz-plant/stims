# Metadata and docs expectations

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

Use [`../DOCS_MAINTENANCE.md`](../DOCS_MAINTENANCE.md) as the canonical checklist for:

- cross-link alignment between root and agent entry points,
- docs index synchronization in `docs/README.md`,
- per-change documentation update requirements,
- toy docs synchronization requirements.
