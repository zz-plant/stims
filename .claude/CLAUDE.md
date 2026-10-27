# Stims for Claude Code

@../AGENTS.md

## Claude Code specifics

- **Skills**: Claude Code auto-loads `.claude/skills/steward` (PR and CI
  conventions). The `.agent/skills/` playbooks are not loaded or exposed as
  slash commands; open the one [`docs/agents/custom-capabilities.md`](../docs/agents/custom-capabilities.md) names.
- **Quiet gate**: inside a session (`CLAUDECODE=1`) `check:quick` and `check`
  print one line per passing step and a summary; `--verbose` (or
  `STIMS_QUIET=0`) restores full output, and a failing step always prints in full.
- **Browser pane**: its tabs always report `document.hidden`, so load every
  page with `?agent=true` or the canvas stays black. `.claude/launch.json`
  defines the `preview_start` servers: `stims-dev` (`bun run dev`, port 5173,
  moves to a free port when taken), fixed-port `stims-dev-5991` and
  `stims-dev-scratch` (5992), and `stims-prod-preview` (5993) for a built `dist/`.
- **MCP and the live channel**: `.mcp.json` registers the `stims` MCP server
  (`bun run mcp`); its session tools drive a browser of their own. To act on
  the tab the user is watching, use `bun run live` and read `scratch/live/`
  (the [live channel](../docs/agents/browser-automation.md#on-the-tab-you-are-watching-the-live-channel)).
- **Web sessions**: on Claude Code on the web (`CLAUDE_CODE_REMOTE=true`) the
  `SessionStart` hook in `.claude/hooks/session-start.sh` installs dependencies
  from the frozen lockfile and skips the checks; local sessions run
  `bun run setup:codex` themselves.
