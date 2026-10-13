# Copilot instructions for Stims

Follow the root [`AGENTS.md`](../AGENTS.md). It holds the bootstrap, daily
commands, done criteria, boundaries, and commit and PR rules for every agent,
Copilot included.

## Copilot specifics

- **Prompt files**: `.github/prompts/*.prompt.md` run in Copilot Chat as
  `/fix-bug`, `/implement-feature`, `/refactor-module`, `/review-changes`,
  `/update-docs`, and `/update-test`. Each is a checklist that links back to the
  guide rather than restating it.
- **Skills**: the `.agent/skills/` playbooks are plain Markdown; open the one
  [`docs/agents/custom-capabilities.md`](../docs/agents/custom-capabilities.md)
  names for the task.
- **Coding-agent PRs**: the PR body must say how the change was verified (CI
  rejects one that does not); the [steward skill](../.claude/skills/steward/SKILL.md)
  explains CI's jobs and which bot comments are noise.
