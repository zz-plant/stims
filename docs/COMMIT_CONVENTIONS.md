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

`lefthook.yml` runs `scripts/check-commit-msg.ts` from the `commit-msg` hook. `bun install` installs the hooks through the postinstall script, and `bun run check` or `check:quick` reinstalls them if they have gone missing. CI runs the same checker over the PR's commits:

```bash
bun run check:commit-msg -- --range origin/main..HEAD --allow-long-subjects
```

The checker rejects a subject without one of the types in the table, and vague subjects such as "fixes", "wip" or "hopefully works". Over 72 characters, the hook warns but lets the commit through, and CI waives the limit with `--allow-long-subjects`; a range check without that flag fails on it. Case is not checked: lowercase is the house style the history follows. Git's own merge and revert subjects pass as written.

## What main keeps

This repo squash-merges, so `git log` on `main` holds one commit per PR, built by GitHub:

- **Subject**: the PR title with ` (#<number>)` appended. Keep the title a Conventional Commits subject of at most 64 characters with one type, so the subject fits 72. The "Validate PR title" job in `.github/workflows/pr-automation.yml` fails a title that breaks this; edit the title and the job re-runs, no push needed. Check one locally with `bun run check:commit-msg -- --pr-title "<title>"`. Before that job, 19 of 50 subjects on `main` ran past 72 and one carried two types; a PR that holds two changes is two PRs.
- **Body**: the branch's commit messages, not the PR description. A single-commit PR lands with that commit's body; a multi-commit PR lands as a `*` list of every commit, each with its trailers. So put the why in the commit body, wrapped at 72 columns, the way you would explain it in the PR's opening sentences: 8 of those 50 commits landed with only trailers because the explanation lived in the PR description alone. On a multi-commit PR, whoever merges can trim the squash message to what a reader of `git log` needs.

The PR description is for the reviewer: the evidence, the measurements and the follow-ups. Main keeps the title and the commit bodies.

## Pull requests

Use a title that describes the final change (see [What main keeps](#what-main-keeps)). Open the description with a sentence or two a reviewer could stop after, then the detail: the problem and resulting behaviour, the checks run with their outcomes, and docs touched or `None`. Call out skipped checks and unresolved limitations, and leave out what does not apply instead of marking it "n/a". A successful local gate does not establish a deployed result.

`bun run pr:body` scaffolds the description from the diff, and `bun run pr:body -- --check <file>` checks it; CI rejects an empty body or one that never says how the change was verified. The template's review prompts sit in its opening comment, so they guide the author without appearing in every PR.

Use [Contributing](../CONTRIBUTING.md) for branch and review workflow and [documentation maintenance](./DOCS_MAINTENANCE.md) for cross-links. The [July retrospective audit](./archive/COMMIT_AUDIT_2026-07.md) is preserved as history.
