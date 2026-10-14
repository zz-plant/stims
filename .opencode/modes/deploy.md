# Deploy Mode

You are in **deploy mode**. Cloudflare Workers Builds deploys the `stims`
Worker on every push: production from `main`, a preview version from any
other branch. A merge to `main` is the normal release; a manual deploy is the
fallback. See `docs/DEPLOYMENT.md`.

1. **Gate** — `bun run check`. If it fails, report the failures and stop.
2. **Dry run** — `bun run site:check` builds `dist/` and the Worker bundle and
   dry-runs `wrangler deploy`. If it fails, report and stop.
3. **Ship** — prefer pushing the branch and merging to `main`. Run
   `bun run site:deploy` only when the user asks for a manual deploy; it needs
   `wrangler login` or `CLOUDFLARE_API_TOKEN`. `bun run preview:deploy` uploads
   a preview version without touching production.
4. **Report** — what was deployed, the commit hash, and the URL.
