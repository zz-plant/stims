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
  --skip-browsers     Skip linking a container's pre-installed Chromium into
                      the layout the pinned Playwright expects.
  --install-retries <n>
                      Retry a failed install up to n times with exponential
                      backoff (default: 3). Lockfile drift never retries.
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

saved_install_bun_version() {
  metadata_value "$(install_state_file)" "bun_version"
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

  if [[ "$saved_fingerprint" != "$CURRENT_MANIFEST_FINGERPRINT" ]]; then
    echo "stale"
    return 0
  fi

  # node_modules carries binaries built against the Bun that installed it
  # (sharp, resvg-wasm and friends). A Bun upgrade invalidates the tree even
  # though every manifest still matches, so the fingerprint alone is not
  # enough to call the install current.
  local saved_bun
  saved_bun="$(saved_install_bun_version || true)"

  if [[ -n "$saved_bun" && "$saved_bun" != "$CURRENT_BUN_VERSION" ]]; then
    echo "bun-changed"
    return 0
  fi

  echo "current"
}

install_state_detail() {
  case "$1" in
    missing) echo "node_modules is absent" ;;
    uncached) echo "no recorded install state; cannot tell whether node_modules matches the manifests" ;;
    stale) echo "package.json/bun.lock changed since the last recorded install" ;;
    bun-changed)
      echo "installed with Bun $(saved_install_bun_version || echo unknown), now running Bun $CURRENT_BUN_VERSION"
      ;;
    current) echo "node_modules matches the manifests and the running Bun" ;;
    *) echo "unknown" ;;
  esac
}

install_log_file() {
  echo "$(install_state_dir)/last-install.log"
}

# Bun's own wording when the lockfile and package.json disagree under
# --frozen-lockfile. Deterministic: retrying cannot fix it.
lockfile_drift_detected() {
  grep -qiE 'lockfile had changes|lockfile is frozen|frozen lockfile' "$1"
}

run_install() {
  local -a install_command=(bun install)
  if [[ "$INSTALL_MODE" == "frozen" ]]; then
    install_command+=(--frozen-lockfile)
  fi

  local log_file
  log_file="$(install_log_file)"
  mkdir -p "$(dirname -- "$log_file")"

  local attempt=1
  local delay=2
  local max_attempts=$((INSTALL_RETRIES + 1))

  while true; do
    if [[ "$attempt" -gt 1 ]]; then
      log "Retrying dependency installation (attempt ${attempt}/${max_attempts})"
    fi

    if "${install_command[@]}" 2>&1 | tee "$log_file"; then
      return 0
    fi

    if lockfile_drift_detected "$log_file"; then
      fail "$(cat <<DRIFT
bun.lock does not match package.json, so --frozen-lockfile refused to install.
This is dependency drift, not a flake, so it was not retried. To fix it:
  1. bun install            # updates bun.lock to match package.json
  2. git diff bun.lock      # confirm the change is the one you expect
  3. commit the lockfile alongside the package.json change
Full install output: ${log_file}
DRIFT
)"
    fi

    if [[ "$attempt" -ge "$max_attempts" ]]; then
      fail "dependency installation failed after ${attempt} attempt(s). Full output: ${log_file}"
    fi

    warn "Dependency installation failed; retrying in ${delay}s (attempt ${attempt}/${max_attempts})."
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
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
  echo "- Dependency install: $install_state ($(install_state_detail "$install_state"))"
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
INSTALL_RETRIES=3
DO_BROWSERS=1

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
    --skip-browsers)
      DO_BROWSERS=0
      shift
      ;;
    --install-retries)
      [[ $# -ge 2 ]] || fail "--install-retries requires a value."
      [[ "$2" =~ ^[0-9]+$ ]] || fail "--install-retries expects a non-negative integer (got '$2')."
      INSTALL_RETRIES="$2"
      shift 2
      ;;
    --install-retries=*)
      INSTALL_RETRIES="${1#*=}"
      [[ "$INSTALL_RETRIES" =~ ^[0-9]+$ ]] || fail "--install-retries expects a non-negative integer (got '$INSTALL_RETRIES')."
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

# --status and --print-plan are read by agents and by `bun run agent:status`;
# keep their output to the report itself rather than a setup banner.
if [[ "$STATUS_ONLY" -eq 1 ]]; then
  print_setup_status
  exit 0
fi

if [[ "$PRINT_PLAN" -eq 0 ]]; then
  log "Starting Codex setup for stims"
  log "Repository root: $REPO_ROOT"
  log "Bun version: $CURRENT_BUN_VERSION"
fi

if [[ "$PRINT_PLAN" -eq 1 ]]; then
  echo "Plan"
  if [[ "$DO_INSTALL" -eq 1 ]]; then
    if [[ "$FORCE_INSTALL" -eq 0 && "$CURRENT_INSTALL_STATE" == "current" ]]; then
      echo "- Install: skipped ($(install_state_detail current))"
    elif [[ "$INSTALL_MODE" == "frozen" ]]; then
      echo "- Install: bun install --frozen-lockfile ($(install_state_detail "$CURRENT_INSTALL_STATE"))"
    else
      echo "- Install: bun install ($(install_state_detail "$CURRENT_INSTALL_STATE"))"
    fi
  else
    echo "- Install: skipped"
  fi

  if [[ "$DO_BROWSERS" -eq 1 ]]; then
    echo "- Browsers: link pre-installed Chromium if the pinned revision is missing"
  else
    echo "- Browsers: skipped"
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
  else
    if [[ "$INSTALL_MODE" == "frozen" ]]; then
      log "Installing dependencies with frozen lockfile ($(install_state_detail "$CURRENT_INSTALL_STATE"))"
    else
      log "Installing dependencies ($(install_state_detail "$CURRENT_INSTALL_STATE"))"
    fi
    run_install
    write_install_state
  fi
else
  log "Skipping dependency installation"
fi

# Advisory: a container without a usable browser still runs every text-only
# instrument, so a failure here must not fail the bootstrap.
if [[ "$DO_BROWSERS" -eq 1 ]]; then
  if install_artifacts_present; then
    log "Linking pre-installed browsers"
    if ! bun run scripts/link-preinstalled-browsers.ts; then
      warn "browser linking failed; browser-backed tooling may be unavailable. Run 'bun run doctor' for the tier that still works."
    fi
  else
    log "Skipping browser linking; node_modules is absent"
  fi
else
  log "Skipping browser linking"
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
