---
description: Deploy the site Worker to Cloudflare
---

# Deploy Workflow

1. Run full quality gate:

   ```bash
   bun run check
   ```

2. Validate the Worker build and config:

   ```bash
   bun run site:check
   ```

3. Deploy via Cloudflare Workers Builds (preferred — push to `main` and it builds and deploys automatically) or manually:

   ```bash
   bun run site:deploy
   ```
