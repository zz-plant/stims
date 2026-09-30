---
name: steward
description: "Repo-specific conventions for opening, watching and driving a Stims pull request to green: what CI's shapes mean, which bot comments are noise, how to restart a branch after a squash-merge, and how to verify Worker changes on the branch preview. Use when you open or watch a PR here."
---

# Steward: driving a Stims PR

Everything here was observed on real PRs in this repo. It sits below the
generic PR rules: it covers conventions and traps specific to Stims.

## Before you push

- `bun run check:quick` runs in the pre-commit hook (about 20–55 s). Inside a
  Claude Code session its output is quiet: one line per passing step and a
  `✅ Quality gate passed` summary. `--verbose` restores the full text.
- Commit subjects are Conventional Commits, at most 72 characters (the hook
  warns above that).
- Write the PR body with `bun run pr:body` (scaffold from the diff) and check
  it with `bun run pr:body -- --check <file>` before opening. CI rejects an empty
  body or one that never says how the change was verified.
- New tests must be able to fail: revert the change, watch the test go red.
  Use `bun run test -- --no-bail` to see every failure in one run. Do not
  add source-text greps (`check:test-source-greps` blocks them).
- Do not `pkill -f <name>`: the pattern also matches your own shell command
  line and kills it. Kill by pid.

## Reading CI

- Jobs: Changed paths, Commit messages, Quality gate, Gate test suite,
  Parity corpus, four browser e2e jobs (engine-mount runs as two: its preset
  switch test has its own runner), then the **CI Status** aggregate.
- **CI Status goes red on a superseded run.** The aggregate counts a
  *cancelled* job as failed, and a new push cancels the previous run. If the
  red check is on an older commit than the PR head, read its log: when the
  Quality gate line says `success` and the test jobs say `cancelled`, it is not a
  real failure. Wait for the run on the current head; do not re-push or re-run.
- **Visual evidence (manual)** shows `skipped` on ordinary PRs; that is normal.

## Bot comments

- **Cloudflare Workers** comments announce a preview deploy for each commit
  and are edited in place. They are not findings.
- **The Codex connector** posts inline review comments with a `P1`/`P2`
  badge: those are real findings, so answer them. A comment saying its usage
  limit is reached is not a finding and means no automated review will arrive.
- A finding about a *measurement* usually means the benchmark did not match how
  the code runs (a warmed average for a once-per-transition path). Re-measure the
  way it actually runs (cold call, p95, max) and narrow the claim to what the
  data shows.

## Verifying Worker and function changes

The Cloudflare bot's **Branch Preview URL** serves the PR's code. For anything
under `functions/`, curl it and check status, content-type, size and
`Cache-Control` for a real case and a bad-input case. Unit tests alone did not
show the real headers. Post the result on the PR.

## GPU-less sessions

Cloud sessions usually render with SwiftShader (`bun run doctor` says so).
Correctness tools (`lab:visual`, `lab:replay`, `lab:nan-sweep`) work; frame
times do not describe real hardware, and `lab:profile` / `profile:frame` now
warn. Do not draw performance conclusions here; use `bun run preview:deploy`
or ask for a hardware run.

## After a squash-merge

This repo squash-merges, so the branch's own commits are not reachable from
`main`. Reset the branch with `bun run branch:restart` (it refuses uncommitted
or unpushed work, repoints the upstream, and prints the exact
`--force-with-lease` push). Push only once you have new commits, and open a
new PR for them; never reuse the merged one.

## Generated files

`bun run generate:seo` rewrites tracked icons and sitemaps. Verify with
`bun run generate:seo -- --check` (or `check:seo`) and do not commit
incidental output. `output/`, `screenshots/` and `.playwright-cli/` are
scratch: keep them out of commits.
