#!/bin/bash
set -uo pipefail

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

# CLAUDE_PROJECT_DIR is normally set by the harness, but the repo root is
# derivable from this script's own path — don't let a missing variable be the
# reason a remote session starts with no dependencies.
project_dir="${CLAUDE_PROJECT_DIR:-}"
if [ -z "$project_dir" ] || [ ! -f "$project_dir/package.json" ]; then
  project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
fi

cd "$project_dir" || {
  echo "SessionStart: could not enter the project directory ($project_dir); run 'bun run setup' manually." >&2
  exit 0
}

# --frozen-lockfile keeps the worktree clean at session start (a lockfile
# drift is a real signal, not something to silently rewrite). Checks are
# skipped for startup speed — sessions run `bun run check:quick` on demand.
# Playwright browsers are NOT downloaded here: the remote environment ships
# Chromium pre-installed via PLAYWRIGHT_BROWSERS_PATH. The setup script does
# link that build into the layout the pinned Playwright expects, which is what
# keeps lab:visual / ui:diff / ctl / mcp / e2e usable in a remote session.
if bash scripts/codex-setup.sh --frozen-lockfile --skip-check; then
  exit 0
fi

# A failed bootstrap must not take the session down with it: the agent can
# still read code, and the recovery command is more useful than a dead hook.
# The setup script has already printed the specific failure above.
cat >&2 <<'RECOVERY'

SessionStart: dependency bootstrap failed — node_modules may be absent or incomplete.
Before running tests, the quality gate, or any `bun run` script, recover with:
  bun run setup:codex --skip-check     # retries the install (non-frozen)
  bun run doctor                       # reports what is still missing
RECOVERY
exit 0
