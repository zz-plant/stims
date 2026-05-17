---
name: review-deploy-tooling
description: "Review changes to CI, wrangler config, build scripts, Cloudflare deploy, or tooling. Use when a PR touches .github/workflows/ci.yml, wrangler.toml, scripts/build.mjs, scripts/deploy-cloudflare.mjs, or package.json scripts."
---

# Review Deploy and Tooling Changes

Use this skill when reviewing or authoring changes to `.github/workflows/ci.yml`, `wrangler.toml`, `scripts/build.mjs`, `scripts/deploy-cloudflare.mjs`, `package.json` scripts, or any CI/deploy setup.

## Why this exists

~16% of fix commits (125 sampled) are deploy/tooling: CI config, wrangler, build scripts, and deploy pipeline — the #3 category. This skill prevents those regressions.

## Pre-merge checklist

### 1. Build must succeed

- [ ] `bun run build` passes
- [ ] `bun run preview` serves the built output without errors
- [ ] If changing wrangler config, verify `wrangler.toml` is still valid

### 2. CI workflow integrity

- [ ] If changing `.github/workflows/ci.yml`, verify all jobs still reference the correct build/publish commands
- [ ] No hardcoded secrets or tokens in workflow files

### 3. Package scripts stay intact

- [ ] `bun run check:quick` still passes
- [ ] No removal of scripts that are referenced by CI, docs, or agent workflows

### 4. Deploy path verified

- [ ] If touching deploy scripts, trace the full path from build → upload → publish
- [ ] Cloudflare Pages project name and branch config unchanged unless intentional

## What to reject in review

- Direct edits to CI workflow that skip lint/test/build steps
- Removal of `wrangler.toml` without replacement
- Hardcoded API tokens or secrets in any file
- `package.json` script changes that break `bun run check`

## Related skills

- [`review-renderer-fallback`](../review-renderer-fallback/SKILL.md) — when the change involves runtime capability checks that depend on build config
- [`ship-visualizer-change`](../ship-visualizer-change/SKILL.md) — for the full end-to-end implementation + deploy workflow
