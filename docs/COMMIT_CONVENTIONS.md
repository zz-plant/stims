# Commit conventions

Use Conventional Commits: `type(scope): summary`, with the scope optional and `!` before the colon for a breaking change. Write the summary in lowercase after the colon, with no trailing period, and keep the subject within 72 characters.

```text
docs: update contributor setup
fix(editor): restore shared source after startup
refactor(mcp)!: retire toy tools, fold audio guide into presets
```

An optional body explains the problem and resulting behavior. Reference an issue when the change addresses it; use a closing keyword only when the implementation completes that issue.

| Type                   | Use                                        |
| ---------------------- | ------------------------------------------ |
| `feat`                 | New behavior                               |
| `fix`                  | Correct a bug                              |
| `perf`                 | Improve measured performance               |
| `refactor`             | Restructure code without changing behavior |
| `test`                 | Add or repair tests                        |
| `docs`                 | Documentation                              |
| `style`                | Formatting without a behavior change       |
| `chore`, `build`, `ci` | Maintenance, build, or CI work             |
| `revert`, `hotfix`     | Reversion or urgent correction             |

## Enforcement

`lefthook.yml` runs `scripts/check-commit-msg.ts` from the `commit-msg` hook, and `bun install` installs the hooks through the postinstall script. CI runs the same checker over the PR's commits:

```bash
bun run check:commit-msg -- --range origin/main..HEAD --allow-long-subjects
```

The checker rejects a subject without one of the types in the table, and vague subjects such as "fixes", "wip" or "hopefully works". Over 72 characters, the hook warns but lets the commit through, and CI waives the limit with `--allow-long-subjects`; a range check without that flag fails on it. Case is not checked: lowercase is the house style the history follows. Git's own merge and revert subjects pass as written.

## Pull requests

Use a title that describes the final change. Include the problem and resulting behavior, explicit checks run with their outcomes, and docs touched or `None`. Call out skipped checks and unresolved limitations. A successful local gate does not establish a deployed result.

`bun run pr:body` scaffolds the description from the diff, and `bun run pr:body -- --check <file>` checks it; CI rejects an empty body or one that never says how the change was verified.

Use [Contributing](../CONTRIBUTING.md) for branch and review workflow and [documentation maintenance](./DOCS_MAINTENANCE.md) for cross-links. The [July retrospective audit](./archive/COMMIT_AUDIT_2026-07.md) is preserved as history.
