# MCP stdio server guide

The repository includes a Model Context Protocol (MCP) stdio server at [`scripts/mcp-server.ts`](../scripts/mcp-server.ts). It exposes documentation, toy metadata, loader behavior, and development command references so MCP-compatible clients can retrieve structured information without scraping markdown.

## Starting the server

- Install dependencies (`bun install`).
- Run the stdio server from the repo root:
  ```bash
  bun run mcp
  ```
  MCP clients should launch the command above with the working directory set to the repository root so the server can read `README.md` and `assets/js/toys-data.js`. The server writes responses over stdio using the MCP protocol.

## Registered tools

All tools are registered on the `stim-webtoys-mcp` server name and use zod-based schemas for validation.

- **`list_docs`**
  - **Input:** none.
  - **Output:** `text` response with quick-start pointers, runtime notes, repository layout, and toy catalog references pulled from `README.md` with line ranges.
- **`get_toys`**
  - **Input:** optional `slug` (string) to fetch a single toy and optional `requiresWebGPU` (boolean) to filter by WebGPU requirements.
  - **Output:** `json` array of `{ slug, title, description, requiresWebGPU, url }` entries. Returns a helpful text message when no toys match the filters.
- **`describe_loader`**
  - **Input:** none.
  - **Output:** `text` summary of how the toy loader resolves entries and errors, including manifest resolution (`/.vite/manifest.json`), URL/history handling, WebGPU gating, and the recovery states shown when imports fail.
- **`dev_commands`**
  - **Input:** optional `scope` enum (`setup`, `dev`, `build`, `test`, `lint`) to narrow the result.
  - **Output:** `text` response containing the requested setup or workflow commands from `README.md`. Without a scope, the tool returns all development snippets.
- **`agent_workflow`**
  - **Input:** none.
  - **Output:** `text` list of best practices for MCP-driven development in this repository, including when to use other tools and how to keep context fresh.

## Inputs, outputs, and client expectations

- All tool calls follow MCP stdio conventions. Successful calls return a `content` array with either `text` or `json` entries.
- Validation errors surface when inputs don’t satisfy the schemas above (for example, passing a number for `slug`).
- `get_toys` reads from `assets/js/toys-data.js`; keep that file up to date so MCP clients surface accurate metadata.

## Troubleshooting tips

- **Manifest resolution:** The loader summary references `/.vite/manifest.json`; when discussing loader behavior with `describe_loader`, ensure a Vite dev server or build has produced the manifest so paths resolve correctly.
- **Slug filters:** If `get_toys` returns “No toys matched the requested filters,” double-check the slug in `assets/js/toys-data.js` or omit filters to retrieve the full catalog.
- **Client invocation:** MCP clients must launch `bun run mcp` in the repository root; running elsewhere can block access to `README.md`, the toy data file, or the Vite manifest.
