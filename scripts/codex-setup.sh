#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/codex-setup.sh [options]

Bootstrap this repository for Codex or local contributor sessions.

Options:
  --frozen-lockfile   Use bun install --frozen-lockfile.
  --skip-install      Skip dependency installation.
  --skip-check        Skip all quality checks.
  --quick-check       Run bun run check:quick (default).
  --full-check        Run bun run check.
  -h, --help          Show this help message.
USAGE
}

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: '$1' is required but not installed or not on PATH." >&2
    exit 1
  fi
}

ensure_repo_root() {
  if [[ ! -f "package.json" || ! -f "bun.lock" ]]; then
    echo "Error: run this script from the repository root (missing package.json or bun.lock)." >&2
    exit 1
  fi
}

INSTALL_MODE="normal"
DO_INSTALL=1
DO_CHECK=1
CHECK_MODE="quick"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --frozen-lockfile)
      INSTALL_MODE="frozen"
      shift
      ;;
    --skip-install)
      DO_INSTALL=0
      shift
      ;;
    --skip-check)
      DO_CHECK=0
      shift
      ;;
    --quick-check)
      CHECK_MODE="quick"
      shift
      ;;
    --full-check)
      CHECK_MODE="full"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

ensure_repo_root
require_command bun

log "Starting Codex setup for stims"
log "Bun version: $(bun --version)"

if [[ "$DO_INSTALL" -eq 1 ]]; then
  if [[ "$INSTALL_MODE" == "frozen" ]]; then
    log "Installing dependencies with frozen lockfile"
    bun install --frozen-lockfile
  else
    log "Installing dependencies"
    bun install
  fi
else
  log "Skipping dependency installation"
fi

if [[ "$DO_CHECK" -eq 1 ]]; then
  if [[ "$CHECK_MODE" == "full" ]]; then
    log "Running full quality gate (bun run check)"
    bun run check
  else
    log "Running quick quality gate (bun run check:quick)"
    bun run check:quick
  fi
else
  log "Skipping quality checks"
fi

log "Codex setup complete"
