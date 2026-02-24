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
  --print-plan        Print the selected install/check plan before running.
  -h, --help          Show this help message.
USAGE
}

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

warn() {
  echo "Warning: $*" >&2
}

on_error() {
  local line="$1"
  local command="$2"
  echo "Error: setup failed at line ${line} while running: ${command}" >&2
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "'$1' is required but not installed or not on PATH."
  fi
}

resolve_repo_root() {
  local script_dir
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  local repo_root
  repo_root="$(cd -- "$script_dir/.." && pwd)"

  if [[ ! -f "$repo_root/package.json" || ! -f "$repo_root/bun.lock" ]]; then
    fail "could not resolve repository root from scripts/codex-setup.sh (missing package.json or bun.lock)."
  fi

  echo "$repo_root"
}

validate_bun_version() {
  local bun_version
  bun_version="$(bun --version)"
  local bun_major bun_minor
  bun_major="${bun_version%%.*}"
  local remainder
  remainder="${bun_version#*.}"
  bun_minor="${remainder%%.*}"

  if [[ -z "$bun_major" || -z "$bun_minor" ]]; then
    fail "unable to parse Bun version '$bun_version'."
  fi

  if (( bun_major < 1 || (bun_major == 1 && bun_minor < 3) )); then
    warn "Bun >=1.3.0 is recommended by package engines (found $bun_version)."
  fi
}

INSTALL_MODE="normal"
DO_INSTALL=1
DO_CHECK=1
CHECK_MODE="quick"
PRINT_PLAN=0

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
    --print-plan)
      PRINT_PLAN=1
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

trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR

if [[ "$DO_CHECK" -eq 0 && "$CHECK_MODE" == "full" ]]; then
  fail "--full-check cannot be combined with --skip-check."
fi

REPO_ROOT="$(resolve_repo_root)"
cd "$REPO_ROOT"

require_command bun
validate_bun_version

log "Starting Codex setup for stims"
log "Repository root: $REPO_ROOT"
log "Bun version: $(bun --version)"

if [[ "$PRINT_PLAN" -eq 1 ]]; then
  log "Plan"
  if [[ "$DO_INSTALL" -eq 1 ]]; then
    if [[ "$INSTALL_MODE" == "frozen" ]]; then
      echo "- Install: bun install --frozen-lockfile"
    else
      echo "- Install: bun install"
    fi
  else
    echo "- Install: skipped"
  fi

  if [[ "$DO_CHECK" -eq 1 ]]; then
    if [[ "$CHECK_MODE" == "full" ]]; then
      echo "- Checks: bun run check"
    else
      echo "- Checks: bun run check:quick"
    fi
  else
    echo "- Checks: skipped"
  fi
fi

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
