# Deployment Guide

This guide covers how to build the Stim Webtoys Library, validate the production bundle locally, and ship the site and MCP Worker to production targets. Commands reference the scripts in `package.json` so you can copy/paste without drift.

## Build the Site

Run the production build to emit optimized assets:

```bash
bun run build
```

The Vite build outputs to `dist/` and also writes a `.vite/manifest.json` file. Keep the manifest alongside the hashed assets—it powers any server-side integrations or debug tooling that map back to the compiled files.

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

## Cloudflare Pages Configuration

Cloudflare Pages reads the build command from the project settings in the dashboard, so keep `wrangler.toml` limited to the shared metadata (`name`, `compatibility_date`, and `pages_build_output_dir`). Do **not** add a `[build]` table—Pages rejects it and will surface a configuration validation error. Configure the build command (for example, `bun run build`) directly in Pages, or rely on `CF_PAGES=1` with the existing install script to generate `dist/` during install.

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

Flags and bindings to keep in mind:

- `--name` should match or override the `name` in `wrangler.toml` if you need a different environment-specific Worker name.
- `--compatibility-date` should stay aligned with `wrangler.toml` (`2024-10-20`) to ensure the MCP server runs with the intended platform APIs.
- No KV, Durable Objects, or secrets are required for the current worker; it only needs standard Worker APIs plus WebSocket support enabled by the compatibility date.

## Release Checklist

- Update [`CHANGELOG.md`](../CHANGELOG.md) with user-facing notes for the release.
- Tag the version in Git after merging (e.g., `git tag vX.Y.Z && git push origin --tags`).
- Smoke test the production URL at [https://no.toil.fyi](https://no.toil.fyi) after deploy (basic load, a few toys, and audio input checks).
