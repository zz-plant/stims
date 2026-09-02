# Tech Stack Modernization — September 2026

A ranked audit of what could level up the Stims toolchain and third-party
stack, grounded in a full usage map of every dependency plus the state of
each ecosystem as of 2026-09-02. Each entry records what was **done in the
accompanying PR** and what remains. It supersedes the archived
`docs/archive/TECH_STACK_CAPABILITY_RESEARCH_2026-02.md`.

The short version: the stack was already current on the axes that matter
(Vite 8 on Rolldown, React 19.2, three r185, Biome 2.5, Playwright 1.62,
`bun test --parallel`). The remaining leverage is in four places — the
TypeScript compiler, the MCP protocol revision, a few tools that have been
superseded, and platform APIs the code already half-reaches for.

## Baseline

`src/` is 452 files / ~122k LOC, and the overwhelming majority is first-party
engine code (compiler, three-tier EEL2 VM, GLSL and WGSL codegen, runtime)
that no third-party library replaces. The load-bearing dependencies are
three.js (47 files, including a 3,789-line TSL feedback manager) and React
(68 files, hooks-only). Every other runtime dependency is lazy, chunk-isolated,
and behind a seam.

| Dependency | Before | Now / latest | Verdict |
| --- | --- | --- | --- |
| TypeScript | 6.0.3 (`ignoreDeprecations: "6.0"`) | **7.0.2** — Go-native compiler, stable 2026-07-08 | **Landed.** Cold typecheck 33.6s → 3.0s, warm 3.9s → 0.9s |
| MCP SDK | `@modelcontextprotocol/sdk` 1.30.0 | **`@modelcontextprotocol/server` 2.0.0** — spec 2026-07-28 | **Landed.** stdio + Worker, both eras served |
| esbuild (direct) | 0.28.1, one call site | Rolldown `build()` (already Vite's bundler) | Tier 2 — ported and reverted; browser gate flaked 3/14 vs 4/5 (details in §7) |
| Vite | 8.0.16, `rollupOptions` | 8.2.2, `rolldownOptions` | **Landed** (rename). `codeSplitting` deferred with measurements below |
| husky | 9.1.7 | **lefthook** 2.1.12 | **Landed.** Same two hooks, one YAML |
| dependency-cruiser + diff-scoped `check:unused-exports` | 18.2 | **knip** 6.34 added as `check:dead-code` | **Landed.** 1 dead file, 1 unused devDep, 1 unlisted dep fixed |
| Bun | 1.3.14 | 1.4.0 (2026-08-20) | Tier 2 — two weeks old |
| React | 19.2.8 | React Compiler 1.0 via Oxc port | Tier 2 — needs UI QA |
| three | 0.185.1 | r186; Chrome 146 WebGPU Compatibility Mode | Tier 2 — gating only |
| Cloudflare | wrangler 4.123, Workers static assets, Pages-Functions bundle | `@cloudflare/vite-plugin` 1.51 | Tier 2 |
| Biome | 2.5.8 | Oxlint type-aware as an add-on | Keep |
| meyda, comlink, CodeMirror 6, `@tanstack/react-virtual`, `browser-fs-access`, zod 4, Playwright | current | no compelling successor | Keep (reasons below) |

Measurement method: `bun run typecheck` timed cold (tsbuildinfo removed) and
warm; `bun run build` chunk names and byte sizes compared against a saved
baseline; `bun run check:dead-code` output triaged by hand.

## Tier 1 — landed in this PR

### 1. TypeScript 7 (Go-native compiler)
**Area:** developer loop / CI. The single biggest wall-clock win available:
the checker is a structurally identical port, so there is no new type system
to migrate to, only removed options. This repo's `tsconfig.json` already
used `moduleResolution: "bundler"` and `esModuleInterop: true`, so the only
change was deleting `ignoreDeprecations`.

| | TS 6.0.3 | TS 7.0.2 |
| --- | --- | --- |
| Cold `bun run typecheck` | 33.6s | 3.0s |
| Warm (incremental) | 3.9s | 0.9s |

The `bun --bun ./node_modules/typescript/bin/tsc` invocation is unchanged;
TS 7 ships a `bin/tsc` shim that launches the native binary. The language
service (editor) side is still in progress upstream, so IDEs keep using their
bundled TypeScript until they opt in.
**Done:** `typescript@7.0.2`, `ignoreDeprecations` removed.
**Remains:** nothing. Watch for `@types/*` packages that still emit
TS-6-only syntax; none in this tree did.

### 2. MCP SDK v2 (spec 2026-07-28)
**Area:** agent tooling. The monolithic SDK split into
`@modelcontextprotocol/server` and `/client`; the new revision is stateless
by default (no session affinity — any Worker isolate can answer any
request), adds `Mcp-Method`/`Mcp-Name` routing headers, and keeps
`McpServer`/`registerTool` intact, so the ~50 tool registrations in
`scripts/mcp-shared.ts` did not change.
**Done:**
- `scripts/mcp-server.ts` — `server.connect(new StdioServerTransport())` →
  `serveStdio(() => server)`. The entry owns the transport and the protocol
  era: a 2025-era client is pinned to the instance exactly as before, a
  2026-07-28 client gets the modern envelope. Smoke-tested with a 2025-06-18
  `initialize`/`tools/list` handshake: 50 tools listed.
- `scripts/mcp-worker.ts` — the sessionful
  `WebStandardStreamableHTTPServerTransport` is replaced by
  `createMcpHandler(factory)`, which builds one fresh `McpServer` per request
  and serves legacy clients through the SDK's stateless fallback. Nothing was
  ever stored on the old session, so this loses no behaviour. The hand-rolled
  WebSocket `Transport` is unchanged; `Transport`/`JSONRPCMessage` now import
  from `@modelcontextprotocol/server`. `bun run mcp:check` bundles clean.
- `@cfworker/json-schema` stays a devDependency: v2 lists it only as its own
  devDependency but resolves it at runtime from the cf-worker validator.
**Remains:** the Worker still answers 2025-era `GET`/`DELETE` session
operations with 405 by design; if a client needs sessionful legacy serving,
route with `isLegacyRequest` in front of a `legacy: 'reject'` handler.

### 3. Vite 8.2 and the `rolldownOptions` rename
**Area:** build. `build.rollupOptions` → `build.rolldownOptions` in both
Vite configs. Vite 8.2.2 also merged two single-module chunks
(`collection-intent`, `youtube-controller`) into their importers on its own:
112 chunks instead of 114, total JS 4,067 kB → 4,065 kB, entry `index`
unchanged at 127.6 kB, Vite-reported build time 4.0s → 1.9s.

**Deferred, with evidence — `codeSplitting.groups`.** Vite 8 deprecates the
function form of `manualChunks` in favour of Rolldown's `codeSplitting`, but
the two are not equivalent for this graph:

| Variant | Chunks | Entry `index` | `vendor-three` | `vendor-three-webgpu` |
| --- | --- | --- | --- | --- |
| `manualChunks` function (kept) | 112 | 127.6 kB | 617 kB | 648 kB |
| groups, recursive capture (default) | 112 | 127.6 kB | 370 kB | 894 kB |
| groups, `includeDependenciesRecursively: false` | 81 | 291.4 kB | 617 kB | 648 kB |

Recursive capture lets the webgpu group swallow ~250 kB of three's core, so
the WebGL path would fetch the WebGPU chunk. Turning capture off is rejected
by Rolldown under `preserveEntrySignatures: 'strict'`; the only allowed
combination (`'allow-extension'`) lets the entry absorb 33 shared chunks and
doubles the eager `index` chunk. The function form still reproduces the
intended split byte-for-byte, so it stays, with the reasoning in the config
comment. Revisit when Rolldown offers non-recursive groups under `'strict'`.

### 4. lefthook replaces husky
**Area:** contributor hygiene. lefthook is a single Go binary with parallel
hooks and one YAML file; no Node on `PATH` and no `.husky/_` shim directory.
The two hooks are unchanged in substance: `pre-commit` still delegates to
`.githooks/pre-commit` (format staged files, `check:quick`, strict cache
bounds) and `commit-msg` still runs `scripts/check-commit-msg.ts`.
**Done:** `lefthook.yml`, install wired into `scripts/postinstall.mjs`
(skipped under `CI` or `LEFTHOOK=0`), `scripts/check-ci-config.ts` now
asserts the lefthook config exists, `.github/CODEOWNERS` updated. Note for
existing clones: husky leaves `core.hooksPath` pointing at its shim, so
`lefthook install` refuses until `git config --unset-all --local
core.hooksPath` is run; `bun install` prints that instruction.

### 5. knip as `check:dead-code`
**Area:** dead code / dependency hygiene. `check:unused-exports` is
deliberately diff-scoped and grep-based; dependency-cruiser models edges but
only flags orphans. knip finds unused files, exports, dependencies,
devDependencies, unlisted dependencies, and unlisted binaries in one ~2s run
and understands Vite, Playwright, and Bun entries.
**Done:** `knip.jsonc` (entries for the three HTML shells, the UI harness,
`?worker`/`?worklet` modules, every script, function, and test), wired into
the full `bun run check` gate. First run findings and their disposition:
- Deleted the 199-line `gpu-timestamp-instrumentation` helper under
  `src/js/milkdrop/renderer-helpers/` — no importer anywhere; the shipped
  profiler is `src/js/core/webgpu-timestamp-profiler.ts`.
- Removed `axe-core` from devDependencies (only `@axe-core/playwright` is
  imported, and it depends on `axe-core` itself).
- Declared `postcss`, which `scripts/prune-dead-css.mjs` imports but nothing
  listed (it resolved by accident before the isolated linker).
- 118 unused exports and 70 unused exported types are reported as warnings,
  not failures: the codebase exports test seams (`reset*ForTests`) and
  public-surface barrels on purpose. Trim them opportunistically.
`check:unused-exports` and dependency-cruiser (`no-circular`,
`no-prod-to-tests`) stay; knip does not replace the circular-import rule.

## Tier 2 — next, needs QA before landing

### 6. React Compiler via the Oxc port
`@vitejs/plugin-react` 6 already runs JSX and Fast Refresh through Oxc;
`react({ compiler: true })` adds `oxc-transform-react`, a Rust port of the
React Compiler (>10× faster than the Babel plugin). The UI has 79 `memo` and
50 `useMemo` sites that would become redundant, and 225 `useEffect` sites
the compiler's lint would audit. Behavioural change to every component, so it
needs the `ui:diff` screenshot suite and a manual pass over the panels that
subscribe through `useSyncExternalStore` (11 components). Start with
`compilationMode: 'annotation'` on the browse grid and settings sheet.

### 7. esbuild → Rolldown for the AudioWorklet bundle (ported, then reverted)
The only direct use of `esbuild` is the `audio-worklet-transform` plugin in
`vite.config.js`, which inlines
`src/js/utils/audio/frequency-analyser-processor.ts` and its DSP imports into
an import-free string for `AudioWorkletGlobalScope`. Rolldown's programmatic
`build()` produces an equivalent bundle (zero `import`/`export` statements,
same processor registered, parses as a classic script, ~4% smaller) and
would retire the last non-Vite toolchain. It was ported, then reverted
before merge, because the browser-backed corpus gate became unstable on the
development container:

| Worklet bundler in the dev server | `bun run test:corpus` passes |
| --- | --- |
| esbuild (per request, as shipped) | 4 of 5 runs (incl. 2 of 2 on `main`) |
| Rolldown, per request | 2 of 11 |
| Rolldown, pre-built at server start | 1 of 3 |

The failing test is `tests/corpus/preset-flash-risk.test.ts`, which drives a
real Chromium against a test-spawned dev server while the rest of the corpus
profile saturates every core; the symptom is "Target page, context or
browser has been closed" mid-sample, or a 60s timeout. It passes in
isolation on every run with either bundler and passes against a pre-warmed
server, so the code is fine and the trigger is load. The esbuild run also
failed once, so the test is flaky regardless — but Rolldown made it fail
far more often, and moving the build out of the request path did not help.
Root cause is unknown (a plausible suspect is Rolldown's native thread pool
running inside the Bun-hosted Vite process while the test workers own every
core). To retry: port the plugin again, serialise the two browser-backed
corpus tests or give them a dedicated worker, and measure ten runs before
trusting it.

### 8. Bun 1.4
Released 2026-08-20. Directly relevant here: `Bun.Image` (decode/resize/encode
PNG/WebP/JPEG, "faster than sharp") could replace `sharp` across 15 scripts
and 6 tests in the parity and preview pipeline; `Bun.WebView` (headless
system WebKit on macOS, or an installed Chromium) is a cheaper screenshot
path for `stims-ctl` than a Playwright launch; `bun test --isolate` and
`--shard` map onto the serial e2e category in `scripts/run-tests.ts`. Bump
`.bun-version`, `mise.toml`, `packageManager`, and `engines.bun` together;
the CI cache keys on `bun.lock`, so the first run after the bump is cold.
Try `Bun.Image` in `scripts/generate-thumbnails.ts` first — it is the
hottest sharp call site and has a golden-output test.

### 9. `@cloudflare/vite-plugin` for the site Worker
`scripts/build-site.mjs` runs `vite build` and `wrangler pages functions
build` concurrently and stitches `dist/_worker.js` by hand, because the site
Worker was born as a Pages project. The Cloudflare Vite plugin (1.51) runs
the Worker inside workerd during `vite dev`, builds client and Worker in one
graph, and handles `.wasm` imports natively, which would retire
`scripts/sync-resvg-wasm.mjs` and the dual-runtime shim in
`src/types/wasm-modules.d.ts`. Cloudflare has folded every Pages feature into
Workers static assets; Pages Functions bundling is the last Pages-era piece
here. Also worth a look once on the plugin: Workflows for the 15-minute embed
backfill cron (`wrangler.cron.jsonc`) and Browser Rendering's REST
`/screenshot` for OG cards, which would remove resvg entirely.

### 10. three r186 and WebGPU Compatibility Mode
three.js is not swappable — the backend seam in
`src/js/milkdrop/renderer-types.ts` abstracts WebGL vs WebGPU, not three —
and staying on the latest release remains the right call. Two upstream
changes matter: r186 continues the TSL-first direction, and Chrome 146
shipped WebGPU Compatibility Mode (WebGPU over OpenGL ES 3.1, including
Android WebView), while Safari 26 and Firefox 141+ ship WebGPU by default.
`src/js/core/renderer-capabilities.ts` should request the compat adapter
(`featureLevel: 'compatibility'`) before falling back to WebGL2 — with the
guard that the timestamp profiler and the compute VM stay disabled on it.

## Tier 3 — architectural

### 11. One shader IR for GLSL and TSL
`src/js/milkdrop/feedback-manager-webgpu-tsl.ts` (3,789 LOC) hand-mirrors
the GLSL composite pass in `src/js/milkdrop/feedback-manager-shared.ts`
(3,030 LOC). `docs/WEBGPU_ARCHITECTURAL_REVAMP.md` workstream 2 already
proposes a declarative composite IR; TSL can emit GLSL, so emitting TSL once
and letting three generate both backends is the named candidate. This is
the biggest maintenance sink in the renderer and no dependency swap touches it.

### 12. Worker-thread renderer over OffscreenCanvas
`src/js/core/renderer-worker-protocol.ts` is a complete 11-message protocol
(with a `SharedArrayBuffer` audio ring) that nothing in `src/` imports;
`src/js/core/renderer-capabilities.ts` detects `transferControlToOffscreen`
but never uses it. The prototype was removed at commit `29afa912`. With React
on the main thread and the frame loop in a worker, UI work (the browse grid,
CodeMirror) stops competing with the render budget. Prerequisite: the
`?agent=true` hidden-tab rendering path must keep working from a worker.

### 13. WebCodecs export
Video export uses `MediaRecorder` (`src/js/utils/media/canvas-video-exporter.ts`);
`VideoFrame` is already used for capture but there is no `VideoEncoder`.
The roadmap's "creator-grade export" (deterministic pacing, 4K, AV-sync
verification) is exactly what WebCodecs gives: encode frames from the virtual
time source at a fixed cadence instead of whatever the realtime recorder
sampled.

### 14. Fold meyda into the AudioWorklet
`meyda` serves only the AnalyserNode fallback path, computing four scalars
(RMS, spectral centroid, flatness, rolloff) every fourth frame on the main
thread. The primary path is already a hand-written AudioWorklet
(`src/js/utils/audio/frequency-analyser-processor.ts`). Porting those four
features into the worklet deletes the `vendor-meyda` chunk and the last
main-thread FFT. Web Audio 1.1's configurable render quantum (targeted for
Q4 2026) will matter for the same worklet.

### 15. Oxlint type-aware pass
Biome 2's own type inference catches roughly three in four floating-promise
cases in published comparisons; Oxlint's type-aware mode uses the real
TypeScript checker (now native, see §1) and is 5–10× faster than ESLint. Biome stays the formatter and
primary linter; an Oxlint `no-floating-promises` pass in `check` full mode
would be additive.

## Keep as-is, and why

- **CodeMirror 6** — three files, own vendor chunk, custom EEL2
  `StreamLanguage` derived from the compiler's builtin docs. Monaco is
  2–5 MB for no gain.
- **comlink** — three API calls behind an interface with a main-thread
  fallback; the "alternatives" (minlink, kkrpc) are the same 1 kB idea.
- **`browser-fs-access`** — Firefox and Safari still ship no
  `showOpenFilePicker`; the fallback is the whole point, and the module is
  already a textbook adapter (`src/js/milkdrop/file-access.ts`).
- **`@tanstack/react-virtual`** — five options across two components;
  virtua/react-virtuoso only win on reverse scrolling, which the grid does
  not do.
- **zod 4** — tooling-only (MCP tool schemas), and MCP v2 requires zod ^4.
  Valibot's smaller bundle is irrelevant off the client path.
- **Biome** — one tool for lint and format, fastest editor integration;
  see §15 for the type-aware add-on.
- **Playwright 1.62** — current; used as a library under `bun test`, not
  as a runner, which is the right shape for the parity captures. Vitest
  Browser Mode would add a runner the repo deliberately does not have.
- **`@strudel/web`** — gated behind `?strudel=1` in its own chunk; the
  `AudioNode.prototype.connect` monkey-patch in
  `src/js/frontend/strudel-audio-bridge.ts` is the cost of an upstream
  API gap, not a dependency choice.

## Sources

- Vite 8 / Rolldown / Oxc: [Vite 8 announcement](https://vite.dev/blog/announcing-vite8),
  [migration guide](https://vite.dev/guide/migration),
  [Rolldown `codeSplitting`](https://rolldown.rs/reference/OutputOptions.codeSplitting)
- TypeScript 7: [typescript-go](https://github.com/microsoft/typescript-go),
  [TypeScript 6.0 deprecation list](https://github.com/microsoft/TypeScript/issues/54500)
- MCP: [2026-07-28 specification](https://blog.modelcontextprotocol.io/posts/2026-07-28/),
  [TypeScript SDK v2 migration](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md),
  [Cloudflare Agents SDK 0.20 changelog](https://developers.cloudflare.com/changelog/post/2026-07-27-agents-sdk-v0.20.0-mcp-sdk-v2/)
- React Compiler on Oxc: [`@vitejs/plugin-react`](https://www.npmjs.com/package/@vitejs/plugin-react),
  [vite-plugin-react #1419](https://github.com/vitejs/vite-plugin-react/pull/1419)
- Bun 1.4: [release notes](https://bun.com/blog/bun-v1.4)
- three.js / WebGPU: [r185 release](https://github.com/mrdoob/three.js/releases/tag/r185),
  [WebGPU Compatibility Mode intent to ship](https://groups.google.com/a/chromium.org/g/blink-dev/c/N3RlLGCOTJ4),
  [gpuweb implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- Cloudflare: [Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/),
  [Pages → Workers migration](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
- Tooling: [knip](https://knip.dev/), [lefthook](https://github.com/evilmartians/lefthook),
  [Biome vs Oxlint](https://jsmanifest.com/biome-oxlint-comparison-2026)
- Audio: [Web Audio WG TPAC 2025 update](https://www.w3.org/2025/11/TPAC/demo-audio-wg-update.html),
  [Essentia.js](https://transactions.ismir.net/articles/10.5334/tismir.111)
- File System Access: [MDN `showOpenFilePicker`](https://developer.mozilla.org/en-US/docs/Web/API/Window/showOpenFilePicker)
