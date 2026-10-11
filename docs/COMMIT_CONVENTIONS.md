# Commit conventions

Use Conventional Commits with a descriptive, sentence-case summary and no trailing period. Keep the subject within 72 characters.

```text
docs: Update contributor setup
fix(editor): Restore shared source after startup
feat(audio): Add a supported input source
```

An optional body explains the problem and resulting behavior. Reference an issue when the change addresses it; use a closing keyword only when the implementation completes that issue.

| Type | Use |
| --- | --- |
| `feat` | New behavior |
| `fix` | Correct a bug |
| `perf` | Improve measured performance |
| `refactor` | Restructure code without changing behavior |
| `test` | Add or repair tests |
| `docs` | Documentation |
| `style` | Formatting without a behavior change |
| `chore`, `build`, `ci` | Maintenance, build, or CI work |
| `revert`, `hotfix` | Reversion or urgent correction |

## Enforcement

`lefthook.yml` runs `scripts/check-commit-msg.ts` from the `commit-msg` hook. `bun install` installs hooks through the postinstall script. CI also checks the PR's commit range; Git-generated merge and revert subjects have explicit handling. No additional commitlint dependency is required.

```bash
bun run check:commit-msg -- --range origin/main..HEAD
```

The checker rejects missing type prefixes and vague subjects such as "fixed". See its source for accepted types and range-mode options.

## Pull requests

Use a title that describes the final change. Include the problem and resulting behavior, explicit checks run with their outcomes, and docs touched or `None`. Call out skipped checks and unresolved limitations. A successful local gate does not establish a deployed result.

Use [Contributing](../CONTRIBUTING.md) for branch and review workflow and [documentation maintenance](./DOCS_MAINTENANCE.md) for cross-links. The [July retrospective audit](./archive/COMMIT_AUDIT_2026-07.md) is preserved as history.
