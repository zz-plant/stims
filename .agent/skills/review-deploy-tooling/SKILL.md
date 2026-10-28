---

name: review-deploy-tooling
description: "Review changes to CI, wrangler config, build scripts, Cloudflare deploy, or tooling. Use when a PR touches .github/workflows/ci.yml, wrangler.site.jsonc, scripts/build.mjs, or package.json scripts."
---

# Review Deploy and Tooling Changes

Use this skill when reviewing or authoring changes to `.github/workflows/ci.yml`, `wrangler.site.jsonc`, `scripts/build.mjs`, `package.json` scripts, or any CI/deploy setup.

## Why this exists

**25% of fix commits — the #2 category**, up from ~16% at the previous audit, which ranked it #3. Deploy and tooling: CI config, wrangler, build scripts, the deploy pipeline, and the growing set of guard/measurement scripts. Measured 2026-08-27 over the last 400 commits (134 fix/revert), one category per commit by dominant file share; re-run it with [`audit-recurring-fixes`](../audit-recurring-fixes/SKILL.md) rather than trusting this number.

## Pre-merge checklist

### 1. Build must succeed

- [ ] `bun run build` passes
- [ ] `bun run preview` serves the built output without errors
- [ ] If changing wrangler config, verify it is still valid (`bun run site:check` for `wrangler.site.jsonc`)

### 2. CI workflow integrity

- [ ] If changing `.github/workflows/ci.yml`, verify all jobs still reference the correct build/publish commands
- [ ] No hardcoded secrets or tokens in workflow files

### 3. Package scripts stay intact

- [ ] `bun run check:quick` still passes
- [ ] No removal of scripts that are referenced by CI, docs, or agent skills

### 4. Deploy path verified

- [ ] If touching deploy scripts, trace the full path from build → upload → publish
- [ ] Cloudflare Worker name (`stims`) and Workers Builds branch config unchanged unless intentional

## Shipping the site

Cloudflare Workers Builds deploys the `stims` Worker on push: production from
`main`, a preview version from every other branch. GitHub Actions only gates
merges. A release is therefore:
1. `bun run check`
2. `bun run site:check` — builds `dist/` and the Worker bundle, then dry-runs
   `wrangler deploy` against `wrangler.site.jsonc`
3. Push and merge; Workers Builds does the rest

`bun run site:deploy` is the manual fallback and needs `wrangler login` or
`CLOUDFLARE_API_TOKEN`. `bun run preview:deploy` uploads a preview version
without touching production. [Deployment](../../../docs/DEPLOYMENT.md) covers
the Workers Builds setup and the MCP Worker.

## What to reject in review

- Direct edits to CI workflow that skip lint/test/build steps
- Removal of `wrangler.site.jsonc` without replacement
- Hardcoded API tokens or secrets in any file
- `package.json` script changes that break `bun run check`

## Related skills

- [`review-renderer-fallback`](../review-renderer-fallback/SKILL.md) — when the change involves runtime capability checks that depend on build config
- [`ship-visualizer-change`](../ship-visualizer-change/SKILL.md) — for the full end-to-end implementation + deploy workflow
