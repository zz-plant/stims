# MCP Server Guide

The repository includes an MCP stdio server at `scripts/mcp-server.ts` and a Cloudflare Worker transport at `scripts/mcp-worker.ts`. The stdio server (`bun run mcp`) is the primary path — it has access to all tools including headless browser automation.

## Tool Categories

### Documentation & Commands (Worker + Stdio)

| Tool | Input | Output |
|------|-------|--------|
| `list_docs` | none | Quick-start, runtime, and repo layout pointers from README.md |
| `read_doc_section` | `file` (enum), optional `heading` | Markdown file or section content |
| `search_docs` | `query`, optional `file`, optional `limit` | Matching sections with excerpts |
| `dev_commands` | optional `scope` (setup/dev/build/test/lint) | Relevant commands from README.md |
| `describe_loader` | none | How the toy loader resolves entries and errors |
| `list_agent_capabilities` | optional `kind` (skill/workflow) | Available agent workflows and skills |
| `read_agent_capability` | `kind`, `name` | Full skill/workflow instructions |
| `get_toys` | optional `slug`, `requiresWebGPU` | Toy metadata (controls, module, type) |
| `launch_toy` | `slug`, optional `port` | Instructions for launching and observing a toy |
| `get_toy_audio_reactivity_guide` | optional `slug` | How toys respond to audio frequencies |

### Preset Catalog (Worker + Stdio)

All tools fetch the live catalog from `https://toil.fyi/milkdrop-presets/catalog.json` — no local server needed.

| Tool | Input | Output |
|------|-------|--------|
| `list_presets` | optional `filter`, `limit` (1-50) | Preset summaries (id, title, author, tags, fidelity, certification) |
| `search_presets` | `query`, optional `limit` | Matching presets with matched field (title/author/tags) |
| `get_preset_info` | `presetId` | Full preset metadata (file path, tags, certification, supports) |
| `describe_preset` | `presetId` | Human-readable description — style, collections, fidelity, launch URL |
| `open_preset_url` | `presetId`, optional `baseUrl` | URL to load the preset in agent mode |

### Agent Session (Stdio-only, requires Playwright)

These tools manage a persistent headless browser session so you can interact with a running visualizer across multiple calls. **Start here for any visual interaction.**

**Workflow:**
1. `start_agent_session` → get a `sessionId`
2. Use session tools to inspect, capture, tweak, and switch
3. `session_close` when done

| Tool | Input | Output |
|------|-------|--------|
| `start_agent_session` | optional `presetId`, `headless` | Session ID — the visualizer opens in a persistent browser |
| `session_get_state` | `sessionId` | Current state: preset title, author, audio energy (0-1), backend, canvas size |
| `session_capture_frame` | `sessionId`, optional `waitMs` | Path to captured screenshot |
| `session_describe_frame` | `sessionId`, optional `waitMs` | Preset info + screenshot path (no pixel analysis — use a vision model) |
| `session_switch_preset` | `sessionId`, `presetId`, optional `waitMs` | Confirmation when new preset is rendered |
| `session_tweak` | `sessionId`, `tweak` (natural language), optional `amount` | Applies the change via the inspector panel |
| `session_apply_source` | `sessionId`, `source` (.milk code) | Applies modified preset source to the running visualizer |
| `session_get_preset_source` | `presetId` or `sessionId` | Raw .milk source code from disk |
| `session_get_inspector_values` | `sessionId` | All visible field names and current values from the inspector panel |
| `session_compare` | `sessionId`, optional `settleMs`, `label` | Before/after screenshot pair |
| `session_watch` | `sessionId`, optional `durationMs`, `intervalMs` | Timelapse frames + state snapshots over time |
| `session_vibe` | `vibe` (natural language description), optional `durationMs` | Searches all 43 presets by keyword relevance, returns screenshots of top 3 matches |
| `session_close` | `sessionId` | Releases browser resources |

**Natural language tweaks supported by `session_tweak`:**
- Colors: "more blue", "more red", "more green", "warmer", "cooler"
- Brightness: "brighter", "darker"
- Motion: "more warp", "less warp", "more zoom", "faster", "slower"
- Quality: "more saturation", "more contrast", "more decay" (trails)
- Each maps to the appropriate MilkDrop field via the inspector panel

### Automation (Stdio-only)

| Tool | Input | Output |
|------|-------|--------|
| `run_quality_gate` | optional `scope`, `timeoutMs` | Structured pass/fail output |
| `capture_toy_screenshot` | `slug`, optional `duration` | Screenshot path + audio/error summary |
| `capture_preset` | `presetId`, optional `duration` | Opens visualizer with preset, returns screenshot |
| `preview_gallery` | optional `query`, `count` (1-6), `duration` | Screenshots of multiple presets in sequence |
| `test_toy_interactivity` | `slug` | Pass/fail with audio and error details |
| `get_toy_health` | `slug` | HEALTHY/UNHEALTHY status |

## Agent Workflow Examples

### Browse and learn about presets:
```
list_presets → search_presets("ambient") → describe_preset("best-match") → open_preset_url
```

### See what a preset looks like:
```
start_agent_session(presetId="shifter-snakeskin") → session_capture_frame → session_close
```

### Vibe coding loop (describe → see → tweak → compare):
```
start_agent_session → session_vibe("dark purple storm")
→ session_get_preset_source("best-match")
→ session_tweak("more blue and increase warp")
→ session_compare
→ session_tweak("brighter")
→ session_compare
→ session_close
```

### Inspect and modify a running visualizer:
```
start_agent_session → session_get_state
→ session_get_inspector_values
→ session_tweak("faster motion")
→ session_describe_frame
→ session_compare
→ session_close
```

## Starting the Server

```bash
bun run mcp
```

The server connects over stdio. MCP clients should launch this command from the repo root.

## Worker Deployment (Alternative Transport)

The Cloudflare Worker at `scripts/mcp-worker.ts` serves the Worker-compatible tools (documentation + preset catalog) over HTTP/SSE and WebSocket. It does not support session tools or automation.

See `wrangler.mcp.jsonc` for configuration.
