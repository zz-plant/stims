# auth.md

Stims (toil.fyi) has no authentication. There are no accounts, no OAuth flows,
no API keys, and no registration step: no page or endpoint on this host expects
a credential, and a 401 is never the correct response to expect here. If a
guide told you to sign in to this site, it is out of date.

## What an agent can use without credentials

- `/llms.txt` — curated site index for agents; `/llms-full.txt` — the full
  document, including every URL flag and the embed protocol.
- `/.well-known/api-catalog` — RFC 9727 linkset of this host's machine-readable
  resources.
- `/openapi.json` — request and response contracts for the HTTP API under
  `/api/*`.
- `/.well-known/agent-skills/index.json` — Agent Skills for driving and
  embedding the visualizer.
- `?agent=true` appended to any page URL keeps rendering while the tab reports
  itself hidden and exposes `window.__stims_agent`.
- `/.well-known/mcp/server-card.json` — the MCP server card. The MCP server
  itself is not hosted on this origin: it runs over stdio from a clone of
  https://github.com/zz-plant/stims (see
  https://github.com/zz-plant/stims/blob/main/docs/MCP_SERVER.md).

## Limits

The model-backed routes under `/api/*` are optional and depend on the
deployment's model configuration; playback and editing never need them. Per-IP
rate limits apply to video upload and the model-backed routes. If a request
fails, the response body explains why; retrying with credentials will not help,
because there is no higher tier than anonymous.
