#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/codex-session.sh [options]

Warm a high-throughput local agent session for this repository.

Profiles:
  fast     Warm fast local model role and start the dev server.
  review   Warm fast + quality local model roles, start the dev server,
           and start a background typecheck watcher.
  visual   Warm fast local model role and start the dev server for browser QA.
  full     Warm fast + quality local model roles, start the dev server,
           and start a background unit-test watcher.

Options:
  --profile <name>    Session profile: fast, review, visual, or full.
                      Default: fast.
  --port <port>       Dev server port. Default: 5173.
  --host <host>       Dev server host. Default: 127.0.0.1.
  --watch <mode>      Override watcher mode: none, typecheck, unit,
                      integration, or all.
  --skip-models       Skip local model warmup.
  --skip-dev-server   Skip dev server startup.
  --skip-watch        Skip watcher startup.
  --status            Print managed session status and exit.
  --stop              Stop managed background processes and exit.
  --print-plan        Print the selected plan before running it.
  -h, --help          Show this help message.
USAGE
}

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

warn() {
  echo "Warning: $*" >&2
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

on_error() {
  local line="$1"
  local command="$2"
  echo "Error: session setup failed at line ${line} while running: ${command}" >&2
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
    fail "could not resolve repository root from scripts/codex-session.sh (missing package.json or bun.lock)."
  fi

  echo "$repo_root"
}

process_is_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" >/dev/null 2>&1
}

read_pidfile() {
  local pidfile="$1"
  if [[ -f "$pidfile" ]]; then
    tr -d '[:space:]' <"$pidfile"
  fi
}

cleanup_pidfile_if_stale() {
  local pidfile="$1"
  local pid
  pid="$(read_pidfile "$pidfile")"

  if [[ -n "$pid" ]] && ! process_is_running "$pid"; then
    rm -f "$pidfile"
  fi
}

url_is_ready() {
  local url="$1"
  curl -fsS "$url" >/dev/null 2>&1
}

wait_for_url() {
  local url="$1"
  local timeout_seconds="${2:-30}"
  local waited=0

  while (( waited < timeout_seconds )); do
    if url_is_ready "$url"; then
      return 0
    fi
    sleep 1
    waited=$(( waited + 1 ))
  done

  return 1
}

start_managed_process() {
  local name="$1"
  local pidfile="$2"
  local logfile="$3"
  shift 3

  cleanup_pidfile_if_stale "$pidfile"

  local existing_pid
  existing_pid="$(read_pidfile "$pidfile")"
  if [[ -n "$existing_pid" ]] && process_is_running "$existing_pid"; then
    log "${name} already running (pid ${existing_pid})"
    return 0
  fi

  mkdir -p "$(dirname -- "$pidfile")"
  nohup "$@" >"$logfile" 2>&1 &
  local pid=$!
  echo "$pid" >"$pidfile"
  log "Started ${name} (pid ${pid}); log: ${logfile}"
}

stop_managed_process() {
  local name="$1"
  local pidfile="$2"

  cleanup_pidfile_if_stale "$pidfile"

  local pid
  pid="$(read_pidfile "$pidfile")"
  if [[ -z "$pid" ]]; then
    log "${name} is not running"
    return 0
  fi

  if ! process_is_running "$pid"; then
    rm -f "$pidfile"
    log "${name} is not running"
    return 0
  fi

  kill "$pid" >/dev/null 2>&1 || true
  sleep 1

  if process_is_running "$pid"; then
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi

  rm -f "$pidfile"
  log "Stopped ${name}"
}

print_managed_process_status() {
  local name="$1"
  local pidfile="$2"
  local logfile="$3"

  cleanup_pidfile_if_stale "$pidfile"

  local pid
  pid="$(read_pidfile "$pidfile")"
  if [[ -n "$pid" ]] && process_is_running "$pid"; then
    echo "- ${name}: running (pid ${pid})"
    echo "  log: ${logfile}"
    return 0
  fi

  echo "- ${name}: stopped"
  echo "  log: ${logfile}"
}

warm_local_models() {
  local roles=("$@")

  if [[ "${#roles[@]}" -eq 0 ]]; then
    return 0
  fi

  if command -v lmstudio-ensure-model >/dev/null 2>&1; then
    for role in "${roles[@]}"; do
      log "Ensuring LM Studio model role '${role}' is loaded"
      lmstudio-ensure-model "$role"
    done
    return 0
  fi

  if command -v lms-agent-stack >/dev/null 2>&1; then
    log "Warming LM Studio agent stack"
    lms-agent-stack
    return 0
  fi

  warn "LM Studio warmup helpers not found; skipping local model warmup."
}

PROFILE="fast"
DEV_PORT="5173"
DEV_HOST="127.0.0.1"
WATCH_MODE_OVERRIDE=""
DO_MODELS=1
DO_DEV_SERVER=1
DO_WATCH=1
PRINT_PLAN=0
STATUS_ONLY=0
STOP_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    --port)
      DEV_PORT="${2:-}"
      shift 2
      ;;
    --host)
      DEV_HOST="${2:-}"
      shift 2
      ;;
    --watch)
      WATCH_MODE_OVERRIDE="${2:-}"
      shift 2
      ;;
    --skip-models)
      DO_MODELS=0
      shift
      ;;
    --skip-dev-server)
      DO_DEV_SERVER=0
      shift
      ;;
    --skip-watch)
      DO_WATCH=0
      shift
      ;;
    --status)
      STATUS_ONLY=1
      shift
      ;;
    --stop)
      STOP_ONLY=1
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
      fail "unknown argument: $1"
      ;;
  esac
done

trap 'on_error "$LINENO" "$BASH_COMMAND"' ERR

case "$PROFILE" in
  fast)
    MODEL_ROLES=("fast")
    WATCH_MODE="none"
    ;;
  review)
    MODEL_ROLES=("fast" "quality")
    WATCH_MODE="typecheck"
    ;;
  visual)
    MODEL_ROLES=("fast")
    WATCH_MODE="none"
    ;;
  full)
    MODEL_ROLES=("fast" "quality")
    WATCH_MODE="unit"
    ;;
  *)
    fail "unknown profile '$PROFILE'. Expected fast, review, visual, or full."
    ;;
esac

if [[ -n "$WATCH_MODE_OVERRIDE" ]]; then
  WATCH_MODE="$WATCH_MODE_OVERRIDE"
fi

case "$WATCH_MODE" in
  none|typecheck|unit|integration|all)
    ;;
  *)
    fail "unknown watch mode '$WATCH_MODE'. Expected none, typecheck, unit, integration, or all."
    ;;
esac

REPO_ROOT="$(resolve_repo_root)"
SESSION_DIR="$REPO_ROOT/.codex/session"
DEV_PIDFILE="$SESSION_DIR/dev-server.pid"
DEV_LOGFILE="$SESSION_DIR/dev-server.log"

WATCH_NAME="watcher"
WATCH_COMMAND=()
WATCH_PIDFILE=""
WATCH_LOGFILE=""

case "$WATCH_MODE" in
  none)
    WATCH_NAME="watcher"
    WATCH_COMMAND=()
    WATCH_PIDFILE="$SESSION_DIR/watch-none.pid"
    WATCH_LOGFILE="$SESSION_DIR/watch-none.log"
    ;;
  typecheck)
    WATCH_NAME="typecheck watcher"
    WATCH_COMMAND=(bun run typecheck:watch)
    WATCH_PIDFILE="$SESSION_DIR/typecheck-watch.pid"
    WATCH_LOGFILE="$SESSION_DIR/typecheck-watch.log"
    ;;
  unit)
    WATCH_NAME="unit-test watcher"
    WATCH_COMMAND=(bun run scripts/run-tests.ts --profile unit --watch)
    WATCH_PIDFILE="$SESSION_DIR/unit-test-watch.pid"
    WATCH_LOGFILE="$SESSION_DIR/unit-test-watch.log"
    ;;
  integration)
    WATCH_NAME="integration-test watcher"
    WATCH_COMMAND=(bun run scripts/run-tests.ts --profile integration --watch)
    WATCH_PIDFILE="$SESSION_DIR/integration-test-watch.pid"
    WATCH_LOGFILE="$SESSION_DIR/integration-test-watch.log"
    ;;
  all)
    WATCH_NAME="test watcher"
    WATCH_COMMAND=(bun run scripts/run-tests.ts --watch)
    WATCH_PIDFILE="$SESSION_DIR/test-watch.pid"
    WATCH_LOGFILE="$SESSION_DIR/test-watch.log"
    ;;
esac

mkdir -p "$SESSION_DIR"
cd "$REPO_ROOT"

require_command bun
require_command curl

if [[ "$PRINT_PLAN" -eq 1 ]]; then
  log "Plan"
  echo "- Profile: ${PROFILE}"
  if [[ "$DO_MODELS" -eq 1 ]]; then
    echo "- Local models: ${MODEL_ROLES[*]}"
  else
    echo "- Local models: skipped"
  fi

  if [[ "$DO_DEV_SERVER" -eq 1 ]]; then
    echo "- Dev server: http://${DEV_HOST}:${DEV_PORT}/"
  else
    echo "- Dev server: skipped"
  fi

  if [[ "$DO_WATCH" -eq 1 && "$WATCH_MODE" != "none" ]]; then
    echo "- Watcher: ${WATCH_NAME}"
  else
    echo "- Watcher: skipped"
  fi
fi

if [[ "$STATUS_ONLY" -eq 1 ]]; then
  echo "Managed session status for ${REPO_ROOT}"
  print_managed_process_status "dev server" "$DEV_PIDFILE" "$DEV_LOGFILE"
  print_managed_process_status \
    "typecheck watcher" \
    "$SESSION_DIR/typecheck-watch.pid" \
    "$SESSION_DIR/typecheck-watch.log"
  print_managed_process_status \
    "unit-test watcher" \
    "$SESSION_DIR/unit-test-watch.pid" \
    "$SESSION_DIR/unit-test-watch.log"
  print_managed_process_status \
    "integration-test watcher" \
    "$SESSION_DIR/integration-test-watch.pid" \
    "$SESSION_DIR/integration-test-watch.log"
  print_managed_process_status \
    "test watcher" \
    "$SESSION_DIR/test-watch.pid" \
    "$SESSION_DIR/test-watch.log"
  echo "- Selected profile: ${PROFILE}"
  echo "- Selected watcher mode: ${WATCH_MODE}"

  if url_is_ready "http://${DEV_HOST}:${DEV_PORT}/"; then
    echo "- URL: reachable at http://${DEV_HOST}:${DEV_PORT}/"
  else
    echo "- URL: not reachable at http://${DEV_HOST}:${DEV_PORT}/"
  fi
  exit 0
fi

if [[ "$STOP_ONLY" -eq 1 ]]; then
  stop_managed_process "dev server" "$DEV_PIDFILE"
  stop_managed_process "typecheck watcher" "$SESSION_DIR/typecheck-watch.pid"
  stop_managed_process "unit-test watcher" "$SESSION_DIR/unit-test-watch.pid"
  stop_managed_process "integration-test watcher" "$SESSION_DIR/integration-test-watch.pid"
  stop_managed_process "test watcher" "$SESSION_DIR/test-watch.pid"
  exit 0
fi

log "Starting Codex session for stims"
log "Repository root: ${REPO_ROOT}"
log "Profile: ${PROFILE}"

if [[ "$DO_MODELS" -eq 1 ]]; then
  warm_local_models "${MODEL_ROLES[@]}"
else
  log "Skipping local model warmup"
fi

if [[ "$DO_DEV_SERVER" -eq 1 ]]; then
  if url_is_ready "http://${DEV_HOST}:${DEV_PORT}/"; then
    log "Dev server already reachable at http://${DEV_HOST}:${DEV_PORT}/"
  else
    start_managed_process \
      "dev server" \
      "$DEV_PIDFILE" \
      "$DEV_LOGFILE" \
      bun run dev -- --host "$DEV_HOST" --port "$DEV_PORT"

    if ! wait_for_url "http://${DEV_HOST}:${DEV_PORT}/" 30; then
      fail "dev server did not become reachable at http://${DEV_HOST}:${DEV_PORT}/ within 30 seconds. See ${DEV_LOGFILE}."
    fi

    log "Dev server ready at http://${DEV_HOST}:${DEV_PORT}/?agent=true"
  fi
else
  log "Skipping dev server startup"
fi

if [[ "$DO_WATCH" -eq 1 && "$WATCH_MODE" != "none" ]]; then
  start_managed_process \
    "$WATCH_NAME" \
    "$WATCH_PIDFILE" \
    "$WATCH_LOGFILE" \
    "${WATCH_COMMAND[@]}"
else
  log "Skipping watcher startup"
fi

log "Session ready"
echo "- Agent URL: http://${DEV_HOST}:${DEV_PORT}/?agent=true"
echo "- Session state: bun run session:codex -- --status"
echo "- Stop managed processes: bun run session:codex -- --stop"
