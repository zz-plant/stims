# Deployment Guide

The site is one Cloudflare Worker serving the built app; the MCP endpoint is an optional second Worker. Every command below is a `package.json` script.

## Choose your deployment track

| Track                                                            | Use when                                                                                  | Primary path                                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Track A (default): Site Worker via Cloudflare Workers Builds** | Nearly every release.                                                                     | Cloudflare Workers Builds runs `bun run site:build:gated` and `wrangler deploy` on every push — production from `main`, preview URLs from other branches. GitHub Actions only gates merges; it does not deploy. |
| **Track B (optional): MCP Worker transport**                     | You changed MCP HTTP/WebSocket transport behavior or Worker-only MCP deployment settings. | Track A flow for the site plus `bun run mcp:check` and `bun run mcp:deploy` when you need the remote MCP endpoint updated.                                                                                      |

To deploy only the site, follow Track A and skip Track B.

## Track A quick path (default production flow)

The site deploys as the `stims` Worker with static assets, configured in [`wrangler.site.jsonc`](../wrangler.site.jsonc). Cloudflare Workers Builds watches the GitHub repo and builds/deploys on push, so a release is:
1. Run the quality gate, which includes the README claim and generated-artifact checks:

   ```bash
   bun run check
   ```

2. Push the branch and open a pull request. Workers Builds publishes a preview URL for the branch (`wrangler versions upload`); CI runs the test gates in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) but does not deploy.
3. Check the production build locally and on that preview URL with the [release steps of the QA plan](./QA_PLAN.md#before-a-release).
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

`bun run site:build` (which `site:build:gated` runs after the fast tests) runs the Vite app build and the Pages Functions compiler concurrently because neither consumes the other's output. The Worker compiler writes to an isolated temporary directory; after both builds succeed, the script moves that bundle into `dist/_worker.js` and writes `dist/.assetsignore` so the compiled Worker and `.vite/` metadata are not uploaded as public static assets. `wrangler.site.jsonc` points `main` at that bundle, serves `dist/` as assets, and uses `assets.run_worker_first` so the OG-rewrite middleware still sees HTML navigations while pure asset paths skip the Worker.

Keep the orchestration in `scripts/build-site.mjs`. Running both compilers as a shell chain makes deploy builds unnecessarily serial, while writing both into `dist/` concurrently creates a race because Vite clears that directory at startup.

### One-time Workers Builds setup

Done in the Cloudflare dashboard (Workers & Pages → the `stims` Worker → Settings → Builds, or "Import a repository" if the Worker does not exist yet):
1. Connect the `zz-plant/stims` GitHub repository.
2. Build command: `bun run site:build:gated`. Deploy command: `bunx wrangler deploy --config wrangler.site.jsonc`. Non-production branch command: `bunx wrangler versions upload --config wrangler.site.jsonc`.

   `site:build:gated` runs `test:fast` (unit + compat) before the build. Workers Builds deploys on push and does not wait for GitHub Actions, so without a test step in the build itself a commit pushed straight to `main` reaches production whether or not CI is green. That is how the failing `check` run on `ad65ee2d` still shipped. A failing test now fails the build, and production keeps serving the previous version. Use the plain `bun run site:build` only if you deliberately want an ungated deploy path.
3. Production branch: `main`.
4. Enable **Build cache** under Settings → Build. Workers Builds then preserves Bun's package cache between builds; see [Cloudflare's build-caching guide](https://developers.cloudflare.com/workers/ci-cd/builds/build-caching/).

This setup is complete: the `toil.fyi` custom domain is attached to the `stims` Worker and the old Pages project is retired.

## Build the Site

Run the production build to emit optimized assets:

```bash
bun run build
```

The Vite build writes `dist/`, including `dist/.vite/manifest.json`, which maps sources to their hashed output files. Nothing at runtime reads the manifest, and the site Worker does not upload it (`site:build` lists `.vite` in `dist/.assetsignore`).

To skip the rebuild when `dist/` is already complete (for example, when deploying prebuilt artifacts), use the reuse flag; it treats `dist/index.html` plus the manifest as the sign of a finished build:

```bash
bun run build -- --reuse
```

### Artifact Layout

After `bun run build`, expect the following structure:
- `dist/`: HTML entry points and hashed JS/CSS assets under `dist/assets/`.
- `dist/.vite/manifest.json`: build metadata that `--reuse` checks for.

When deploying to static hosting, serve the contents of `dist/` directly and keep the asset paths as built.

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

If your platform supports immutable caching, enable it for `dist/assets/**`; keep HTML un-cached or lightly cached so updates propagate.
Cloudflare Workers static assets read caching rules from `public/_headers`, which Vite copies into `dist/_headers` at build time. The repo ships defaults that set long-term caching for `assets/*` and force revalidation for HTML and `.vite` metadata; adjust those if your host requires a different policy.

### Preset previews live in R2, not the bundle

`/milkdrop-presets/previews/*` is served by the site Worker from the `stims-static` R2 bucket (`functions/milkdrop-presets/previews/[[path]].ts`). The PNG files are generated artifacts: they are gitignored, excluded from the deploy bundle via `.assetsignore`, and published with:

```bash
BACKFILL_TOKEN=<token> bun run previews:sync
```

Run that after `scripts/generate-thumbnails.ts` regenerates previews; pass specific filenames to sync only what changed. The token is the `stims-embed-backfill` Worker secret. A non-Cloudflare static host would need the previews directory copied into its document root instead.

### Video link previews

The optional video preview path stores small GIF flipbooks and JPEG posters
in the existing `stims-static` R2 bucket. Cloudflare Media Transformations
converts each requested GIF to a cached MP4; no graphics browser runs on the
server. Enable Transformations for the `toil.fyi` zone before turning on
`VIDEO_PREVIEWS_ENABLED` in `wrangler.site.jsonc`. The flag defaults to `false`,
so ordinary image previews continue working until that service is ready.

Harvest the frames already rendered during thumbnail selection, then inspect
and prepare a publication without writing to R2:

```bash
bun run generate:previews -- --ids=shifter-curlique --force --flipbooks --workers=1 --port=5277
bun run previews:publish-video -- --ids=shifter-curlique --dry-run
```

The generated files live under ignored `output/flipbooks/`. Checkpoint timing
is approximate: the preview holds a sampled image until the next checkpoint.
The encoder analyzes the quantized frames across the loop boundary and refuses
clips with detected general or red flashes. This result describes the sampled
clip, not the preset at its normal rendering rate.

To publish the reviewed assets, use the same upload credential as PNG previews:

```bash
BACKFILL_TOKEN=<token> bun run previews:publish-video -- --ids=shifter-curlique
```

The publisher uploads the GIF, JPEG and record before updating the preset's
pointer. The homepage uses the preset named by `HOMEPAGE_VIDEO_PRESET`. Preset
pages with no published pointer retain their image metadata. Verify the public
GIF route supports GET, HEAD and byte ranges, then verify its
`/cdn-cgi/media/mode=video,width=320,height=180,fit=scale-down,audio=false/https://toil.fyi/api/flipbooks/<id>.gif`
URL returns playable MP4 before setting `VIDEO_PREVIEWS_ENABLED` to `true` and
deploying. Test the resulting link in the intended sharing apps; metadata does
not guarantee every app displays video.

The stage menu's **Create video link…** flow explicitly publishes four seconds
of small frames and the current preset code to `/api/flipbooks/`. It sends no
audio. The endpoint requires same-origin JSON and the `VIDEO_UPLOAD_LIMITER`
binding (three attempts per IP per minute); missing configuration fails closed.
Requests are bounded by actual streamed bytes, frame count, dimensions, source
size and duration. The resulting `/s/<id>` page includes an inert source payload
so the recipient opens the published source without fetching or executing code
from another site. It is `noindex,follow` and keeps its own sharing canonical.

Successful browser publications return a deletion token. The dialog offers
**Delete public link** while it retains that token; the HTTP equivalent is
`DELETE /api/flipbooks/<id>` with `Authorization: Bearer <deleteToken>`. Deletion
removes the record, GIF and poster. Previously downloaded or CDN-cached copies
cannot be recalled. To remove a curated preview, remove its preset pointer and
the three assets from R2 through the authenticated asset-management workflow.

### Preset embeddings backfill is on-demand

The same Worker owns the preset embeddings index (D1 + Vectorize) that powers "By look / By sound" matching. It has no scheduled trigger: after catalog content or visual descriptions change (`catalog:generate`, `generate:descriptions`), re-embed with:

```bash
BACKFILL_TOKEN=<token> bun run embed:backfill
```

It POSTs the Worker's authenticated backfill route until a run reports no work left (each run covers up to 100 presets). Redeploy the Worker after changing `scripts/embed-backfill-worker.ts`: `bun run embed:deploy`.


## Legacy Cloudflare Pages path (removed)

The site previously deployed as a Cloudflare Pages project with its own Wrangler TOML config, deploy helper script, and `pages:*` package scripts. That path was removed after the `toil.fyi` custom domain moved to the `stims` Worker; the manual fallback is now `bun run site:deploy` (see the Track A quick path above).

Manual deploy authentication notes:
- Local interactive deploys can use `bun run cf:whoami` plus Wrangler login state.
- Non-interactive deploys require `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Track B (optional): Cloudflare Worker (MCP) deployment

The MCP HTTP/WebSocket endpoint lives in [`scripts/mcp-worker.ts`](../scripts/mcp-worker.ts). It has its own Wrangler config in [`wrangler.mcp.jsonc`](../wrangler.mcp.jsonc), separate from the site config in [`wrangler.site.jsonc`](../wrangler.site.jsonc).

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
- The compatibility date and flags live in [`wrangler.mcp.jsonc`](../wrangler.mcp.jsonc); WebSocket support depends on them.
- No KV, Durable Objects, or secrets are required today; if you introduce bindings, add them to `wrangler.mcp.jsonc`.

## Preview-per-PR workflow

Workers Builds uploads a new version for every push to a non-production branch and publishes a preview URL for it (no production traffic shifts). The link is on the Workers Builds run in the Cloudflare dashboard and in the commit status it posts to GitHub; the Cloudflare bot also comments it on the PR. Step 3 of the quick path runs there; on the preview, also check that no asset returns 404 and the console stays clean.

## Release Checklist

- In the release PR, move the `[Unreleased]` entries of [`CHANGELOG.md`](../CHANGELOG.md) under a new `## [X.Y.Z] - date` heading, add a `## Release vX.Y.Z (date)` section with the highlights to [`RELEASE_NOTES.md`](./RELEASE_NOTES.md), and set `version` in `package.json` to `X.Y.Z`. `tests/unit/release-notes.test.ts` fails the PR if the version has no notes.
- Tag the merge commit after merging: `git tag vX.Y.Z <merge-sha> && git push origin vX.Y.Z`. The [Release workflow](../.github/workflows/release.yml) then publishes a GitHub Release with that version's `RELEASE_NOTES.md` section (`bun run release:notes -- vX.Y.Z` prints the same text locally). It refuses a tag that disagrees with `package.json` or has no notes. A bare tag without the workflow is not a Release; that is why v1.1.0–v1.3.0 never showed on the repo page.
- Can't push tags? Run the Release workflow from the Actions tab on `main` instead, with `commit` set to the merge commit (it defaults to the head of `main`). It tags that commit as `v<its package.json version>` and publishes the same notes. It refuses a commit that is not on `main`, or a tag that already points elsewhere.
- After deploy, run steps 1–5 of the [QA checklist](./QA_PLAN.md#manual-checklist) against [https://toil.fyi](https://toil.fyi) with one real audio input.
