#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/codex-setup.sh [options]

Bootstrap this repository for Codex or local contributor sessions.

Options:
  --frozen-lockfile   Use bun install --frozen-lockfile.
  --force-install     Run dependency installation even if local install state looks current.
  --skip-install      Skip dependency installation.
  --skip-check        Skip all quality checks.
  --quick-check       Run bun run check:quick (default).
  --full-check        Run bun run check.
  --status            Print local setup status and exit.
  --print-plan        Print the selected install/check plan and exit.
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

metadata_value() {
  local metadata_file="$1"
  local key="$2"

  if [[ ! -f "$metadata_file" ]]; then
    return 1
  fi

  awk -F= -v key="$key" '$1 == key { print substr($0, index($0, "=") + 1); exit }' "$metadata_file"
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

install_state_dir() {
  echo "$REPO_ROOT/.codex/setup"
}

install_state_file() {
  echo "$(install_state_dir)/install-state.meta"
}

manifest_fingerprint() {
  {
    local rel
    for rel in package.json bun.lock bunfig.toml .bun-version; do
      if [[ -f "$rel" ]]; then
        printf '%s ' "$rel"
        cksum "$rel"
      fi
    done
  } | cksum | awk '{print $1 ":" $2}'
}

install_artifacts_present() {
  [[ -d "$REPO_ROOT/node_modules" ]]
}

saved_install_fingerprint() {
  metadata_value "$(install_state_file)" "fingerprint"
}

install_state_label() {
  if ! install_artifacts_present; then
    echo "missing"
    return 0
  fi

  local saved_fingerprint
  saved_fingerprint="$(saved_install_fingerprint || true)"

  if [[ -z "$saved_fingerprint" ]]; then
    echo "uncached"
    return 0
  fi

  if [[ "$saved_fingerprint" == "$CURRENT_MANIFEST_FINGERPRINT" ]]; then
    echo "current"
    return 0
  fi

  echo "stale"
}

write_install_state() {
  local state_file
  state_file="$(install_state_file)"
  mkdir -p "$(dirname -- "$state_file")"
  cat >"$state_file" <<EOF
fingerprint=$CURRENT_MANIFEST_FINGERPRINT
bun_version=$CURRENT_BUN_VERSION
installed_at=$(date '+%Y-%m-%dT%H:%M:%S%z')
EOF
}

helper_status() {
  if command -v "$1" >/dev/null 2>&1; then
    echo "available"
  else
    echo "unavailable"
  fi
}

print_setup_status() {
  local install_state
  install_state="$(install_state_label)"

  echo "Local setup status for stims"
  echo "- Repository root: $REPO_ROOT"
  echo "- Bun version: $CURRENT_BUN_VERSION"
  echo "- node_modules: $(if install_artifacts_present; then echo present; else echo missing; fi)"
  echo "- Dependency install: $install_state"
  echo "- Install cache file: $(if [[ -f "$(install_state_file)" ]]; then echo present; else echo missing; fi)"
  echo "- Local model routing helper: $(helper_status lmstudio-route)"
  echo "- Local model warmup helper: $(helper_status lmstudio-ensure-model)"
  echo "- LM Studio agent stack helper: $(helper_status lms-agent-stack)"

  case "$install_state" in
    current)
      echo "- Suggested next step: bun run dev"
      ;;
    *)
      echo "- Suggested next step: bun run setup"
      ;;
  esac
}

INSTALL_MODE="normal"
DO_INSTALL=1
DO_CHECK=1
CHECK_MODE="quick"
FORCE_INSTALL=0
PRINT_PLAN=0
STATUS_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --frozen-lockfile)
      INSTALL_MODE="frozen"
      shift
      ;;
    --force-install)
      FORCE_INSTALL=1
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
    --status)
      STATUS_ONLY=1
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
CURRENT_BUN_VERSION="$(bun --version)"
CURRENT_MANIFEST_FINGERPRINT="$(manifest_fingerprint)"
CURRENT_INSTALL_STATE="$(install_state_label)"

log "Starting Codex setup for stims"
log "Repository root: $REPO_ROOT"
log "Bun version: $CURRENT_BUN_VERSION"

if [[ "$STATUS_ONLY" -eq 1 ]]; then
  print_setup_status
  exit 0
fi

if [[ "$PRINT_PLAN" -eq 1 ]]; then
  log "Plan"
  if [[ "$DO_INSTALL" -eq 1 ]]; then
    if [[ "$FORCE_INSTALL" -eq 0 && "$CURRENT_INSTALL_STATE" == "current" ]]; then
      echo "- Install: skipped (node_modules and manifest fingerprint are current)"
    elif [[ "$INSTALL_MODE" == "frozen" ]]; then
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

  exit 0
fi

if [[ "$DO_INSTALL" -eq 1 ]]; then
  if [[ "$FORCE_INSTALL" -eq 0 && "$CURRENT_INSTALL_STATE" == "current" ]]; then
    log "Skipping dependency installation; node_modules and manifest fingerprint are current"
  elif [[ "$INSTALL_MODE" == "frozen" ]]; then
    log "Installing dependencies with frozen lockfile"
    bun install --frozen-lockfile
    write_install_state
  else
    log "Installing dependencies"
    bun install
    write_install_state
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
