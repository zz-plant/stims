# Tech stack capability research (2026-02)

This note captures **newer capabilities** available across the core stack used in this repo, with a focus on practical upgrade opportunities.

## Snapshot: current vs latest

Data gathered from `package.json` plus `npm view <pkg> version` on 2026-02-06.

| Stack element | Current in repo | Latest seen | Upgrade signal |
| --- | --- | --- | --- |
| Bun | 1.3.8 (`packageManager`) | 1.3.8 | Upgraded and aligned across package metadata + docs/deploy tooling |
| Three.js | 0.182.0 | 0.182.0 | Already current |
| Vite | 6.3.5 | 7.3.1 | New major with platform/runtime defaults changes |
| TypeScript | 5.9.3 | 5.9.3 | Already current |
| Biome | 2.3.11 | 2.3.14 | Minor upgrade available |
| MCP SDK | 1.25.2 | 1.26.0 | Minor SDK upgrade available |
| Wrangler | 4.58.0 | 4.63.0 | Minor Cloudflare tooling upgrade available |
| Zod | 4.3.5 | 4.3.6 | Patch update available |

## New capability themes worth evaluating

### Bun 1.3 line

Official Bun 1.3 release notes highlight expanded capabilities in:

- Full-stack runtime features
- Bundler/build workflow
- Package management
- Testing and debugging
- APIs/standards and security

Reference: <https://bun.sh/blog/bun-v1.3>

### Vite 7 line

Vite 7 announcement highlights capability shifts in:

- Node.js support policy updates
- Default browser target (Baseline Widely Available)
- Vitest and Environment API updates
- Migration guidance for major-version adoption

Reference: <https://vite.dev/blog/announcing-vite7>

### TypeScript 5.9 line

TypeScript 5.9 announcement calls out capabilities including:

- Updated/minimal `tsc --init`
- `import defer` support
- `--module node20`
- Expanded DOM API type descriptions

Reference: <https://devblogs.microsoft.com/typescript/announcing-typescript-5-9/>

### Biome 2.3 line

Biome 2.3 notes include:

- Improved ecosystem support (Vue/Svelte/Astro)
- New ignore syntax
- Tailwind v4 support
- Additional lint rule and CLI selector improvements

Reference: <https://biomejs.dev/blog/biome-v2-3/>

## Completed near-term upgrade actions

1. ✅ **Upgraded low-risk minors/patches**
   - `@biomejs/biome` 2.3.11 → 2.3.14
   - `@modelcontextprotocol/sdk` 1.25.2 → 1.26.0
   - `wrangler` 4.58.0 → 4.63.0
   - `zod` 4.3.5 → 4.3.6
2. ✅ **Completed Bun 1.3.x + Vite 7.x upgrade spike**
   - Bun package manager target updated to 1.3.8
   - Vite updated from 6.3.5 → 7.3.1
   - Quality gates validated with `bun run check`
3. ✅ **Kept Three.js and TypeScript pinned as-is**
   - Both remain at latest seen versions in this scan.


## Completed mid-term upgrade actions

1. ✅ **Aligned Bun runtime baseline repo-wide**
   - Updated `.bun-version` to `1.3.8`
   - Raised `engines.bun` to `>=1.3.0`
   - Updated contributor/deployment docs from Bun 1.2 guidance to Bun 1.3 guidance
2. ✅ **Validated the upgraded toolchain in workflow commands**
   - `bun run dev:check`
   - `bun run build`
   - `bun run check`

## Commands used for this scan

```bash
npm view bun version
npm view three version
npm view vite version
npm view typescript version
npm view @biomejs/biome version
npm view @modelcontextprotocol/sdk version
npm view zod version
npm view wrangler version
```
