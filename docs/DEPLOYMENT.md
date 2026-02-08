# Deployment Guide

This guide covers how to build the Stim Webtoys Library, validate the production bundle locally, and ship the site and MCP Worker to production targets. Commands reference the scripts in `package.json` so you can copy/paste without drift.

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

## Static Hosting Expectations

Any static host should point its document root to the `dist/` directory and preserve the following:

- `dist/index.html` (and other HTML entry points).
- `dist/assets/**` for hashed JS/CSS.
- `dist/.vite/manifest.json` for asset lookups.

If your platform supports immutable caching, enable it for `dist/assets/**`; keep HTML un-cached or lightly cached so updates propagate.
Cloudflare Pages can read caching rules from `public/_headers`, which Vite copies into `dist/_headers` at build time. The repo ships defaults that set long-term caching for `assets/*` and force revalidation for HTML and `.vite` metadata; adjust those if your host requires a different policy.

## Cloudflare Pages Configuration

Cloudflare Pages reads the build command from the project settings in the dashboard, so keep `wrangler.toml` limited to the shared metadata (`name`, `compatibility_date`, and `pages_build_output_dir`). Do **not** add a `[build]` table—Pages rejects it and will surface a configuration validation error. Configure the build command (for example, `bun run build`) directly in Pages, or rely on `CF_PAGES=1` with the existing install script to generate `dist/` during install. If the install step already populated `dist/` (the repo’s build script checks for this), the subsequent build command will no-op on Pages to avoid a second Vite build.

Pages builders occasionally default to older Bun versions, which causes `bun install` to fail against the `bun.lock` that tracks Bun `1.3.8`. This repository includes a `.bun-version` file that Cloudflare Pages automatically detects, ensuring the install step always runs with a compatible runtime. If you need to override this, you can set the `BUN_VERSION=1.3.8` environment variable.

> **Install step:** Make sure devDependencies are present so `vite` exists at build time. In Cloudflare Pages, set the install command to `bun install` and set `BUN_INSTALL_DEV=true` to mirror local installs.

### Pages CLI flows

Use the dedicated scripts to avoid drift between local and CI deployments:

```bash
# Build and serve locally with wrangler pages dev
bun run pages:dev

# Build and deploy static assets to Cloudflare Pages
bun run pages:deploy
```

If you are deploying an existing build output (for example, after a CI build artifact is restored), use the reuse variant to skip rebuilding:

```bash
bun run pages:deploy:reuse
```

Expected artifacts for both commands:

- `dist/` with the HTML entry points and hashed assets under `dist/assets/`.
- `dist/.vite/manifest.json` co-located with the assets (required for debugging and any server-side asset lookups).
- A Wrangler-generated preview URL during `pages:dev` and a production deployment URL during `pages:deploy` (visible in the command output and the Cloudflare dashboard).

## Cloudflare Worker (MCP) Deployment

The MCP HTTP/WebSocket endpoint lives in [`scripts/mcp-worker.ts`](../scripts/mcp-worker.ts). Deploy it with Wrangler using the existing [`wrangler.toml`](../wrangler.toml) (name, compatibility date, and Pages output dir are already defined).

Common commands (Bun-first):

- Run locally with live reload and the configured compatibility date:

  ```bash
  bunx wrangler dev scripts/mcp-worker.ts --name stims --compatibility-date=2024-10-20
  ```

- Deploy to Cloudflare Workers:

  ```bash
  bunx wrangler deploy scripts/mcp-worker.ts --name stims --compatibility-date=2024-10-20
  ```

Expected artifacts and checkpoints:

- Worker script bundled by Wrangler (appears as `stims` or the overridden `--name` in the dashboard).
- Preview URL surfaced by `wrangler dev` for local testing and a production URL after `wrangler deploy`.
- Compatibility date pinned to `2024-10-20` so WebSocket support is enabled for the MCP server.
- No KV, Durable Objects, or secrets are required; if you introduce bindings, add them to the deploy commands and `wrangler.toml`.

## Preview-per-PR workflow

Cloudflare Pages issues a unique preview deployment for each pull request. Every push to the PR rebuilds `dist/` and publishes a new preview URL. Use that URL to validate the production bundle before merging:

1. Open the Pages preview link from the PR status or Cloudflare dashboard.
2. Confirm that all static assets load without 404s and that console logs remain clean.
3. Smoke-test a representative sample of HTML entry points (see below) to ensure routing and asset resolution work in the CDN environment.

## Validate multiple HTML entry points before merge

The project ships several standalone HTML entry points (e.g., `index.html`, `legible.html`, `multi.html`, `symph.html`, `toy.html`). Validate them locally and on the PR preview:

1. Run `bun run build` followed by `bun run preview` and open each entry point path manually (for example, `http://localhost:4173/legible.html`).
2. Repeat the checks against the PR’s Cloudflare Pages preview URL to ensure CDN caching and hashed asset references behave the same as local preview.
3. If any entry point relies on audio or interaction-specific features, perform at least one interaction test (mic input, pointer/touch) to confirm runtime permissions and event handling.

## Release Checklist

- Update [`CHANGELOG.md`](../CHANGELOG.md) with user-facing notes for the release.
- Tag the version in Git after merging (e.g., `git tag vX.Y.Z && git push origin --tags`).
- Smoke test the production URL at [https://no.toil.fyi](https://no.toil.fyi) after deploy (basic load, a few toys, and audio input checks).
