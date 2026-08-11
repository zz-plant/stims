#!/bin/bash
set -euo pipefail

# SessionStart hook for Claude Code on the web: pre-install dependencies so
# tests, linters, and the quality gate work from the first command. The
# container snapshot is cached after this completes, so subsequent sessions
# resume with node_modules already warm and the install is skipped entirely
# (scripts/codex-setup.sh fingerprints package.json/bun.lock and no-ops when
# they match).
#
# Local sessions manage their own setup (`bun run setup:codex`) — only run
# remotely.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# --frozen-lockfile keeps the worktree clean at session start (a lockfile
# drift is a real signal, not something to silently rewrite). Checks are
# skipped for startup speed — sessions run `bun run check:quick` on demand.
# Playwright browsers are NOT installed here: the remote environment ships
# Chromium pre-installed via PLAYWRIGHT_BROWSERS_PATH.
bash scripts/codex-setup.sh --frozen-lockfile --skip-check
