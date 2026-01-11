# MCP stdio server guide

The repository includes a Model Context Protocol (MCP) stdio server at [`scripts/mcp-server.ts`](../scripts/mcp-server.ts) and a Cloudflare Worker transport at [`scripts/mcp-worker.ts`](../scripts/mcp-worker.ts). Both expose documentation, toy metadata, loader behavior, and development command references so MCP-compatible clients can retrieve structured information without scraping markdown.

## Starting the server

- Install dependencies (`bun install`).
- Run the stdio server from the repo root:
  ```bash
  bun run mcp
  ```
  MCP clients should launch the command above with the working directory set to the repository root so the server can read `README.md`, `assets/js/toys-data.js`, and the Biome-enforced quality markers. The server writes responses over stdio using the MCP protocol.

## Registered tools

All tools are registered on the `stim-webtoys-mcp` server name and use zod-based schemas for validation.

- **`list_docs`**
  - **Input:** none.
  - **Output:** `text` response with quick-start pointers, runtime notes, repository layout, and toy catalog references pulled from `README.md` with line ranges.
- **`get_toys`**
  - **Input:** optional `slug` (string) to fetch a single toy and optional `requiresWebGPU` (boolean) to filter by WebGPU requirements.
  - **Output:** `json` array of `{ slug, title, description, requiresWebGPU, controls, module, type, allowWebGLFallback, url }` entries. Returns a helpful text message when no toys match the filters. Optional fields default to sensible fallbacks when missing from `assets/js/toys-data.js`.
- **`read_doc_section`**
  - **Input:** required `file` enum (e.g., `README.md`, `docs/MCP_SERVER.md`) and optional `heading` string.
  - **Output:** `text` response containing the full markdown file when no heading is provided, or the matching section beginning at the requested heading. Returns a friendly error when the file or heading cannot be found.
- **`describe_loader`**
  - **Input:** none.
  - **Output:** `text` summary of how the toy loader resolves entries and errors, including manifest resolution (`/.vite/manifest.json`), URL/history handling, WebGPU gating, and the recovery states shown when imports fail.
- **`dev_commands`**
  - **Input:** optional `scope` enum (`setup`, `dev`, `build`, `test`, `lint`) to narrow the result.
  - **Output:** `text` response containing the requested setup or workflow commands from `README.md`. Without a scope, the tool returns all development snippets including **Biome** and Bun references.

## Inputs, outputs, and client expectations

- All tool calls follow MCP stdio conventions. Successful calls return a `content` array with either `text` or `json` entries.
- Validation errors surface when inputs don’t satisfy the schemas above (for example, passing a number for `slug`).
- `get_toys` reads from `assets/js/toys-data.js`; keep that file up to date so MCP clients surface accurate metadata.

## Troubleshooting tips

- **Manifest resolution:** The loader summary references `/.vite/manifest.json`; when discussing loader behavior with `describe_loader`, ensure a Vite dev server or build has produced the manifest so paths resolve correctly.
- **Slug filters:** If `get_toys` returns “No toys matched the requested filters,” double-check the slug in `assets/js/toys-data.js` or omit filters to retrieve the full catalog.
- **Client invocation:** MCP clients must launch `bun run mcp` in the repository root; running elsewhere can block access to `README.md`, the toy data file, or the Vite manifest.

## Cloudflare Worker deployment

[`scripts/mcp-worker.ts`](../scripts/mcp-worker.ts) serves the same tools over Streamable HTTP (POST requests for JSON-RPC, GET + `text/event-stream` for streaming responses) and WebSocket upgrades on the `/mcp` route. The worker bundles markdown and toy metadata at build time via `?raw` imports, so it does not rely on file system access in production.

- **Schema validation:** Uses `CfWorkerJsonSchemaValidator` from `@modelcontextprotocol/sdk/validation/cfworker` (peer dependency: `@cfworker/json-schema`).
- **Bindings:** No KV, D1, or other bindings are required.

### `wrangler.toml` example

The Worker uses the repository’s pinned compatibility date (`2024-10-20`) to keep WebSocket support consistent with `wrangler.toml` and the deployment snippets in `docs/DEPLOYMENT.md`.

```toml
name = "stim-webtoys-mcp"
main = "scripts/mcp-worker.ts"
compatibility_date = "2024-10-20"
workers_dev = true
compatibility_flags = ["nodejs_compat"]
```

### Deploying

1. Install dependencies (`bun install`), ensuring `@cfworker/json-schema` is available for the Worker build.
2. Deploy with Wrangler:
   ```bash
   bunx wrangler deploy scripts/mcp-worker.ts --name stims --compatibility-date=2024-10-20
   ```
3. Local preview (Worker fetch + WebSocket support):
   ```bash
   bunx wrangler dev scripts/mcp-worker.ts --name stims --compatibility-date=2024-10-20
   ```

### Client endpoints

- **HTTP/SSE:** `https://<worker-name>.<account>.workers.dev/mcp` (or your mapped custom domain) handles POST requests for JSON-RPC and GET requests with `Accept: text/event-stream` for streaming responses. CORS headers are set to `*` for interoperability.
- **WebSocket:** `wss://<worker-name>.<account>.workers.dev/mcp` accepts WebSocket upgrades for clients that prefer a persistent connection.
