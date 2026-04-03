# Deployment Guide

This guide covers how to build Stims, validate the production bundle locally, and ship it to Cloudflare. Stims now ships a single MilkDrop-led visualizer product, and the deployment workflow below applies to that surface. Commands reference the scripts in `package.json` so you can copy/paste without drift.

## Choose your deployment track

| Track | Use when | Primary path |
| --- | --- | --- |
| **Track A (default): Static site on Cloudflare Pages** | Nearly all toy/site releases. | GitHub Actions builds `dist/` once, uploads it directly to Pages for PR previews and `main` production, and keeps the local Wrangler scripts as fallback/hotfix tools. |
| **Track B (optional): MCP Worker transport** | You changed MCP HTTP/WebSocket transport behavior or Worker-only MCP deployment settings. | Track A flow for the site plus `bun run mcp:check` and `bun run mcp:deploy` when you need the remote MCP endpoint updated. |

If you only need to deploy the toy site, follow Track A and skip the Worker sections.

## Track A quick path (default production flow)

The default production path is now repo-owned GitHub Actions direct upload instead of relying on the Cloudflare dashboard build:

1. Run the quality gate:

   ```bash
   bun run check
   ```

2. Confirm manifest and generated artifacts remain aligned:

   ```bash
   bun run check:toys
   ```

3. Build production assets:

   ```bash
   bun run build
   ```

4. Sanity-check locally:

   ```bash
   bun run preview
   ```

5. Push the branch and open or update a pull request. The `Deploy Pages preview` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) will upload the checked build artifact to Cloudflare Pages.
6. Merge to `main` after the preview is good. The `Deploy Pages production` job in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) will upload that branch’s checked build artifact to the production Pages project.

Use the manual Wrangler deploy scripts later in this guide only when you need to bypass GitHub Actions, redeploy an existing `dist/`, or ship from a local/alternative CI environment.

## Build the Site

Run the production build to emit optimized assets:

```bash
bun run build
```

The Vite build outputs to `dist/` and also writes a `.vite/manifest.json` file. Keep the manifest alongside the hashed assets—it powers any server-side integrations or debug tooling that map back to the compiled files.

If you already have a valid `dist/` folder and want to skip the rebuild (for example, when deploying prebuilt artifacts), use the reuse flag:

```bash
bun run build -- --reuse
```

### Artifact Layout

After `bun run build`, expect the following structure:

- `dist/`: HTML entry points and hashed JS/CSS assets under `dist/assets/`.
- `dist/.vite/manifest.json`: Vite manifest mapping original sources to their output filenames.

When deploying to static hosting, serve the contents of `dist/` directly. Do not strip the `.vite` directory or rename the asset paths.

## Verify Locally

Use the same scripts defined in `package.json` to validate the production output:

- Preview the build with Vite’s preview server (binds to all interfaces):

  ```bash
  bun run preview
  ```

- Serve the built assets with the Bun helper if you want a minimal static server:

  ```bash
  bun run serve:dist
  ```

Both commands expect a fresh `bun run build` and read from `dist/`.

## Prime-time preflight checks

Track A quick path above is the default release preflight. Use this section as the same checklist reference before production deploys:

1. `bun run check`
2. `bun run check:toys`
3. `bun run build`
4. `bun run preview`

If any step fails, fix the issue and restart from step 1 so downstream checks reflect the final state.

## Static Hosting Expectations

Any static host should point its document root to the `dist/` directory and preserve the following:

- `dist/index.html` (and other HTML entry points).
- `dist/assets/**` for hashed JS/CSS.
- `dist/.vite/manifest.json` for asset lookups.

If your platform supports immutable caching, enable it for `dist/assets/**`; keep HTML un-cached or lightly cached so updates propagate.
Cloudflare Pages can read caching rules from `public/_headers`, which Vite copies into `dist/_headers` at build time. The repo ships defaults that set long-term caching for `assets/*` and force revalidation for HTML and `.vite` metadata; adjust those if your host requires a different policy.

## Cloudflare Pages Configuration

The repository now checks in the Pages Wrangler config in [`wrangler.toml`](../wrangler.toml). That file is the source of truth for Pages settings that Wrangler manages for this project, including the checked-in compatibility dates and placement settings. Keep the production branch aligned with the repo, but do not rely on the dashboard alone for Pages runtime/config drift.

If you intentionally change Pages configuration in the dashboard, pull the generated config back into the repo before you merge the next deployable change:

```bash
bunx wrangler pages download config stims --force
```

Review the resulting diff before committing it. This prevents the repo from silently drifting away from the live Pages project configuration.

The checked-in config intentionally omits the optional `$schema` header because Cloudflare Pages builders can lag the latest local Wrangler parser and reject otherwise valid config when they encounter it.

### GitHub Actions direct upload

The default Pages deploy path lives in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml):

- `quality` builds and validates the production `dist/` bundle once.
- The workflow archives that checked bundle and reuses it for Pages deploys, so preview and production uploads do not rebuild with different dependency state.
- `deploy_preview` uploads PR builds with `bun run pages:deploy:preview:reuse`.
- `deploy_production` uploads `main` with `bun run pages:deploy:production:reuse` after both the quality and integration jobs pass.

One-time setup for the direct-upload path:

1. Add `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` as GitHub Actions secrets.
2. Use a Cloudflare API token with `Account / Cloudflare Pages / Edit`.
3. Once GitHub Actions deploys are confirmed working, disable automatic production deployments in the Cloudflare Pages Git integration settings to avoid duplicate production deploys.

If those secrets are absent, the deploy jobs skip cleanly and the repo falls back to manual/local Wrangler deploys.

### Manual Pages CLI fallback flows

Use the dedicated scripts when you intentionally need a manual deploy. They run the same repo-owned Wrangler config as the CI flow, attach commit metadata automatically, and make preview vs production explicit:

```bash
# Build and serve locally with Wrangler Pages dev
bun run pages:dev

# Build and deploy a preview branch to Cloudflare Pages
bun run pages:deploy:preview

# Build and deploy production assets to Cloudflare Pages
bun run pages:deploy:production
```

If you are deploying an existing build output (for example, after a CI build artifact is restored), use the reuse variant to skip rebuilding:

```bash
bun run pages:deploy:preview:reuse

bun run pages:deploy:production:reuse
```

Manual deploy authentication notes:

- Local interactive deploys can use `bun run cf:whoami` plus Wrangler login state.
- Non-interactive deploys require `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Expected artifacts for the deploy commands:

- `dist/` with the HTML entry points and hashed assets under `dist/assets/`.
- `dist/.vite/manifest.json` co-located with the assets (required for debugging and any server-side asset lookups).
- A Wrangler-generated preview URL during `pages:dev`, a branch preview URL during `pages:deploy:preview`, and a production deployment URL during `pages:deploy:production` (visible in the command output and the Cloudflare dashboard).

## Track B (optional): Cloudflare Worker (MCP) deployment

The MCP HTTP/WebSocket endpoint lives in [`scripts/mcp-worker.ts`](../scripts/mcp-worker.ts). It now has its own Wrangler config in [`wrangler.mcp.jsonc`](../wrangler.mcp.jsonc), separate from the Pages config in [`wrangler.toml`](../wrangler.toml).

Common commands (Bun-first):

- Validate the Worker deploy config before shipping:

  ```bash
  bun run mcp:check
  ```

- Run locally with live reload and the configured compatibility date:

  ```bash
  bun run mcp:dev
  ```

- Deploy to Cloudflare Workers:

  ```bash
  bun run mcp:deploy
  ```

Expected artifacts and checkpoints:

- Worker script bundled by Wrangler (appears as `stims` or the overridden `--name` in the dashboard).
- Preview URL surfaced by `wrangler dev` for local testing and a production URL after `wrangler deploy`.
- Compatibility date pinned to `2024-10-20` so WebSocket support is enabled for the MCP server.
- No KV, Durable Objects, or secrets are required today; if you introduce bindings, add them to `wrangler.mcp.jsonc`.

## Preview-per-PR workflow

Cloudflare Pages issues a unique preview deployment for each pull request when the GitHub Actions preview job runs. Every push to the PR rebuilds `dist/`, uploads a fresh preview bundle, and publishes a new preview URL. Use that URL to validate the production bundle before merging:

1. Open the Pages preview link from the `Deploy Pages preview` job logs or the Cloudflare dashboard.
2. Confirm that all static assets load without 404s and that console logs remain clean.
3. Smoke-test a representative sample of HTML entry points (see below) to ensure routing and asset resolution work in the CDN environment.

## Validate shell routes before merge

The project now treats `/` as the editorial homepage and `/milkdrop/` as the immersive-first playback route. Validate representative routes locally and on the PR preview:

1. Run `bun run build` followed by `bun run preview` and open representative routes manually (for example, `http://localhost:4173/` and `http://localhost:4173/milkdrop/`).
2. Repeat the checks against the PR’s Cloudflare Pages preview URL to ensure CDN caching and hashed asset references behave the same as local preview.
3. If any route relies on audio or interaction-specific features, perform at least one interaction test (mic input, pointer/touch) to confirm runtime permissions and event handling.

## Release Checklist

- Update [`CHANGELOG.md`](../CHANGELOG.md) with user-facing notes for the release.
- Tag the version in Git after merging (e.g., `git tag vX.Y.Z && git push origin --tags`).
- Smoke test the production URL at [https://no.toil.fyi](https://no.toil.fyi) after deploy (basic load, a few toys, and audio input checks).
