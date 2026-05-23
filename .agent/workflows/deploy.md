---
description: Deploy to Cloudflare Pages
---

# Deploy Workflow

1. Run full quality gate:

   ```bash
   bun run check
   ```

2. Build production assets:

   ```bash
   bun run build
   ```

3. Deploy via CI (preferred) or manually:

   ```bash
   bun run pages:deploy
   ```
