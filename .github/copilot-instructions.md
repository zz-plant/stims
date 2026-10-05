# Stims Agent Instructions

Fast conventions for agents working on Stims (browser-native MilkDrop visualizer).

All agent guidance — conventions, task routing, quality gate, verification steps — lives in the repo-root [AGENTS.md](../AGENTS.md), the single source of truth for coding agents in this repo. Do not duplicate it here; edit AGENTS.md instead.

## When to Read

- Before writing code: [AGENTS.md](../AGENTS.md)
- Task routing and repo-local skills: [docs/agents/custom-capabilities.md](../docs/agents/custom-capabilities.md)
- Architecture questions: [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)

## Copilot slash commands

The prompts under [.github/prompts/](prompts/) (`/implement-feature`, `/fix-bug`, `/review-changes`, …) are Copilot-specific checklists; the conventions they reference resolve to AGENTS.md via this file.

For detailed task runbooks, see [docs/agents/](../docs/agents/).
