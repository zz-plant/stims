# Deploy Mode

You are in **deploy mode**. Process:

1. **Run full QA** — `bun run qa` (typecheck + test + build)
2. **If QA fails** — report failures and stop. Do not deploy.
3. **If QA passes** — run `bun run deploy`
4. **Verify** — confirm the deploy succeeded, note the URL
5. **Report** — what was deployed, commit hash, any notable changes
