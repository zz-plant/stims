# Deployment Guide

This guide covers how to build Stims, validate the production bundle locally, and ship it to Cloudflare. Stims now ships a single MilkDrop-led visualizer product, and the deployment workflow below applies to that surface. Commands reference the scripts in `package.json` so you can copy/paste without drift.

## Choose your deployment track

| Track | Use when | Primary path |
| --- | --- | --- |
| **Track A (default): Site Worker via Cloudflare Workers Builds** | Nearly all toy/site releases. | Cloudflare Workers Builds runs `bun run site:build` and `wrangler deploy` on every push — production from `main`, preview URLs from other branches. GitHub Actions only gates merges; it no longer deploys. |
| **Track B (optional): MCP Worker transport** | You changed MCP HTTP/WebSocket transport behavior or Worker-only MCP deployment settings. | Track A flow for the site plus `bun run mcp:check` and `bun run mcp:deploy` when you need the remote MCP endpoint updated. |

If you only need to deploy the toy site, follow Track A and skip the Worker sections.

## Track A quick path (default production flow)

The site deploys as the `stims` Worker with static assets, configured in [`wrangler.site.jsonc`](../wrangler.site.jsonc). Cloudflare Workers Builds watches the GitHub repo and builds/deploys on push, so a release is:

1. Run the quality gate:

   ```bash
   bun run check
   ```

2. Confirm manifest and generated artifacts remain aligned:

   ```bash
   bun run check:toys
   ```

3. Push the branch and open a pull request. Workers Builds publishes a preview URL for the branch (`wrangler versions upload`); CI runs the test gates in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) but does not deploy.
4. Merge to `main` after the preview is good. Workers Builds builds `main` and runs `wrangler deploy` to production.

To validate or ship the same thing from your machine:

```bash
# Build dist/ + compile functions/ into dist/_worker.js, then dry-run the deploy
bun run site:check

# Same build, deployed for real (needs wrangler login or CLOUDFLARE_API_TOKEN)
bun run site:deploy

# Upload a preview version without touching production traffic
bun run site:preview

# Run the Worker + assets locally under workerd
bun run site:dev
```

### How the Worker build works

`bun run site:build` runs the Vite build, then `wrangler pages functions build --outdir=dist/_worker.js` to compile the `functions/` directory (middleware + `/api/*` routes) into a single Worker module, then writes `dist/.assetsignore` so the compiled Worker and `.vite/` metadata are not uploaded as public static assets. `wrangler.site.jsonc` points `main` at that bundle, serves `dist/` as assets, and mirrors `public/_routes.json` in `assets.run_worker_first` so the OG-rewrite middleware still sees HTML navigations while pure asset paths skip the Worker.

### One-time Workers Builds setup

Done in the Cloudflare dashboard (Workers & Pages → the `stims` Worker → Settings → Builds, or "Import a repository" if the Worker does not exist yet):

1. Connect the `zz-plant/stims` GitHub repository.
2. Build command: `bun run site:build`. Deploy command: `bunx wrangler deploy --config wrangler.site.jsonc`. Non-production branch command: `bunx wrangler versions upload --config wrangler.site.jsonc`.
3. Production branch: `main`.
4. After the first successful production deploy, move the `toil.fyi` custom domain from the Pages project to the Worker, then disable the Pages project's deployments.

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

## Legacy Cloudflare Pages path (until cutover completes)

The `stims` Pages project still exists and `toil.fyi` points at it until the Workers Builds cutover in Track A finishes. Its Wrangler config stays checked in at [`wrangler.toml`](../wrangler.toml); do not delete that file or the `pages:*` scripts until the custom domain has moved to the Worker.

The checked-in Pages config intentionally omits the optional `$schema` header because Cloudflare Pages builders can lag the latest local Wrangler parser and reject otherwise valid config when they encounter it.

### Manual Pages CLI fallback flows

Use these only to hotfix production while it still runs on Pages:

```bash
# Build and serve locally with Wrangler Pages dev
bun run pages:dev

# Build and deploy a preview branch to Cloudflare Pages
bun run pages:deploy:preview

# Build and deploy production assets to Cloudflare Pages
bun run pages:deploy:production
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

- Worker script bundled by Wrangler (appears as `stims-mcp` in the dashboard; `stims` is the site Worker).
- Preview URL surfaced by `wrangler dev` for local testing and a production URL after `wrangler deploy`.
- Compatibility date pinned to `2024-10-20` so WebSocket support is enabled for the MCP server.
- No KV, Durable Objects, or secrets are required today; if you introduce bindings, add them to `wrangler.mcp.jsonc`.

## Preview-per-PR workflow

Workers Builds uploads a new version for every push to a non-production branch and publishes a preview URL for it (no production traffic shifts). Use that URL to validate the production bundle before merging:

1. Open the preview link from the Workers Builds run in the Cloudflare dashboard (or the commit status it posts back to GitHub).
2. Confirm that all static assets load without 404s and that console logs remain clean.
3. Smoke-test a representative sample of HTML entry points (see below) to ensure routing and asset resolution work in the CDN environment.

## Validate workspace routes before merge

The project now treats `/` as the canonical workspace route and `/milkdrop/` as the compatibility alias. Validate representative routes locally and on the PR preview:

1. Run `bun run build` followed by `bun run preview` and open representative routes manually (for example, `http://localhost:4173/`, `http://localhost:4173/?preset=eos-glowsticks-v2-03-music`, and `http://localhost:4173/milkdrop/?audio=demo`).
2. Repeat the checks against the branch’s Workers Builds preview URL to ensure CDN caching and hashed asset references behave the same as local preview.
3. If any route relies on audio or interaction-specific features, perform at least one interaction test (mic input, pointer/touch) to confirm runtime permissions and event handling.

## Release Checklist

- Update [`CHANGELOG.md`](../CHANGELOG.md) with user-facing notes for the release.
- Tag the version in Git after merging (e.g., `git tag vX.Y.Z && git push origin --tags`).
- Smoke test the production URL at [https://toil.fyi](https://toil.fyi) after deploy (basic load, a few toys, and audio input checks).
