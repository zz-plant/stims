#!/usr/bin/env bash
set -euo pipefail

shopt -s nullglob

usage() {
  cat <<'USAGE'
Usage: scripts/codex-session.sh [options]

Warm a high-throughput local agent session for this repository.

Profiles:
  fast     Warm fast local model role and start the dev server.
  review   Warm fast + quality local model roles, start the dev server,
           and start a background typecheck watcher.
  compat   Warm fast + quality local model roles, start the dev server,
           and start a background compatibility watcher.
  integration Warm fast + quality local model roles, start the dev server,
           and start a background integration watcher.
  parity   Warm fast + quality local model roles, start the dev server,
           and leave the session ready for parity and perf capture runs.
  visual   Warm fast local model role and start the dev server for browser QA.
  full     Warm fast + quality local model roles, start the dev server,
           and start a background unit-test watcher.

Options:
  --profile <name>    Session profile: fast, review, compat, integration,
                      parity, visual, or full. Default: fast.
  --port <port>       Dev server port. Default: 5173.
  --host <host>       Dev server host. Default: 127.0.0.1.
  --watch <mode>      Override watcher mode: none, typecheck, unit, compat,
                      integration, or all.
  --skip-models       Skip local model warmup.
  --skip-dev-server   Skip dev server startup.
  --skip-watch        Skip watcher startup.
  --status            Print managed session status and exit.
  --stop              Stop managed background processes for the selected
                      host/port and exit.
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

sanitize_session_key() {
  local host="$1"
  local port="$2"
  local combined="${host}-${port}"
  echo "${combined//[^A-Za-z0-9._-]/_}"
}

session_url() {
  local host="$1"
  local port="$2"
  echo "http://${host}:${port}/"
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

cleanup_session_dir_if_empty() {
  local session_dir="$1"
  if [[ -d "$session_dir" ]] && [[ -z "$(ls -A "$session_dir")" ]]; then
    rmdir "$session_dir" >/dev/null 2>&1 || true
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

write_session_metadata() {
  local metadata_file="$1"
  shift

  mkdir -p "$(dirname -- "$metadata_file")"
  : >"$metadata_file"

  while [[ $# -gt 1 ]]; do
    local key="$1"
    local value="$2"
    printf '%s=%s\n' "$key" "$value" >>"$metadata_file"
    shift 2
  done
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

print_session_status_from_metadata() {
  local metadata_file="$1"
  local session_dir
  session_dir="$(dirname -- "$metadata_file")"

  local metadata_key metadata_host metadata_port metadata_profile metadata_watch_mode
  local metadata_url metadata_dev_pidfile metadata_dev_logfile metadata_watch_name
  local metadata_watch_pidfile metadata_watch_logfile metadata_dev_managed
  local metadata_watcher_managed metadata_model_roles

  metadata_key="$(metadata_value "$metadata_file" "session_key")"
  metadata_host="$(metadata_value "$metadata_file" "host")"
  metadata_port="$(metadata_value "$metadata_file" "port")"
  metadata_profile="$(metadata_value "$metadata_file" "profile")"
  metadata_watch_mode="$(metadata_value "$metadata_file" "watch_mode")"
  metadata_url="$(metadata_value "$metadata_file" "url")"
  metadata_dev_pidfile="$(metadata_value "$metadata_file" "dev_pidfile")"
  metadata_dev_logfile="$(metadata_value "$metadata_file" "dev_logfile")"
  metadata_dev_managed="$(metadata_value "$metadata_file" "dev_server_managed")"
  metadata_watch_name="$(metadata_value "$metadata_file" "watch_name")"
  metadata_watch_pidfile="$(metadata_value "$metadata_file" "watch_pidfile")"
  metadata_watch_logfile="$(metadata_value "$metadata_file" "watch_logfile")"
  metadata_watcher_managed="$(metadata_value "$metadata_file" "watcher_managed")"
  metadata_model_roles="$(metadata_value "$metadata_file" "model_roles")"

  echo "Session: ${metadata_host}:${metadata_port}"
  echo "- Key: ${metadata_key}"
  echo "- Profile: ${metadata_profile}"
  echo "- Watcher mode: ${metadata_watch_mode}"
  echo "- Local model roles: ${metadata_model_roles:-none}"

  if [[ "$metadata_dev_managed" == "true" ]]; then
    print_managed_process_status "dev server" "$metadata_dev_pidfile" "$metadata_dev_logfile"
  else
    echo "- dev server: external or unmanaged"
    echo "  log: ${metadata_dev_logfile}"
  fi

  if [[ "$metadata_watch_mode" == "none" ]]; then
    echo "- watcher: disabled"
  elif [[ "$metadata_watcher_managed" == "true" ]]; then
    print_managed_process_status "${metadata_watch_name}" "$metadata_watch_pidfile" "$metadata_watch_logfile"
  else
    echo "- ${metadata_watch_name}: stopped"
    echo "  log: ${metadata_watch_logfile}"
  fi

  if url_is_ready "$metadata_url"; then
    echo "- URL: reachable at ${metadata_url}"
  else
    echo "- URL: not reachable at ${metadata_url}"
  fi

  echo "- Session dir: ${session_dir}"
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
  compat)
    MODEL_ROLES=("fast" "quality")
    WATCH_MODE="compat"
    ;;
  integration)
    MODEL_ROLES=("fast" "quality")
    WATCH_MODE="integration"
    ;;
  parity)
    MODEL_ROLES=("fast" "quality")
    WATCH_MODE="none"
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
    fail "unknown profile '$PROFILE'. Expected fast, review, compat, integration, parity, visual, or full."
    ;;
esac

if [[ -n "$WATCH_MODE_OVERRIDE" ]]; then
  WATCH_MODE="$WATCH_MODE_OVERRIDE"
fi

case "$WATCH_MODE" in
  none|typecheck|unit|compat|integration|all)
    ;;
  *)
    fail "unknown watch mode '$WATCH_MODE'. Expected none, typecheck, unit, compat, integration, or all."
    ;;
esac

REPO_ROOT="$(resolve_repo_root)"
SESSION_ROOT_DIR="${CODEX_SESSION_DIR:-$REPO_ROOT/.codex/session}"
SESSION_KEY="$(sanitize_session_key "$DEV_HOST" "$DEV_PORT")"
SESSION_DIR="$SESSION_ROOT_DIR/$SESSION_KEY"
SESSION_METADATA_FILE="$SESSION_DIR/session.meta"
DEV_URL="$(session_url "$DEV_HOST" "$DEV_PORT")"
DEV_PIDFILE="$SESSION_DIR/dev-server.pid"
DEV_LOGFILE="$SESSION_DIR/dev-server.log"

WATCH_NAME="watcher"
WATCH_COMMAND=()
WATCH_PIDFILE="$SESSION_DIR/watcher.pid"
WATCH_LOGFILE="$SESSION_DIR/watcher.log"

case "$WATCH_MODE" in
  none)
    WATCH_NAME="watcher"
    WATCH_COMMAND=()
    ;;
  typecheck)
    WATCH_NAME="typecheck watcher"
    WATCH_COMMAND=(bun run typecheck:watch)
    WATCH_PIDFILE="$SESSION_DIR/typecheck-watch.pid"
    WATCH_LOGFILE="$SESSION_DIR/typecheck-watch.log"
    ;;
  compat)
    WATCH_NAME="compatibility watcher"
    WATCH_COMMAND=(bun run scripts/run-tests.ts --profile compat --watch)
    WATCH_PIDFILE="$SESSION_DIR/compat-watch.pid"
    WATCH_LOGFILE="$SESSION_DIR/compat-watch.log"
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
    echo "- Dev server: ${DEV_URL}"
  else
    echo "- Dev server: skipped"
  fi

  if [[ "$DO_WATCH" -eq 1 && "$WATCH_MODE" != "none" ]]; then
    echo "- Watcher: ${WATCH_NAME}"
  else
    echo "- Watcher: skipped"
  fi
  exit 0
fi

if [[ "$STATUS_ONLY" -eq 1 ]]; then
  local_sessions=("$SESSION_ROOT_DIR"/*/session.meta)
  echo "Managed session status for ${REPO_ROOT}"

  if [[ "${#local_sessions[@]}" -eq 0 ]]; then
    echo "No managed sessions were found in ${SESSION_ROOT_DIR}."
    exit 0
  fi

  for metadata_file in "${local_sessions[@]}"; do
    print_session_status_from_metadata "$metadata_file"
    echo
  done

  exit 0
fi

if [[ "$STOP_ONLY" -eq 1 ]]; then
  if [[ ! -f "$SESSION_METADATA_FILE" ]]; then
    echo "No managed session metadata found for ${DEV_HOST}:${DEV_PORT}."
    exit 0
  fi

  if [[ "$(metadata_value "$SESSION_METADATA_FILE" "dev_server_managed")" == "true" ]]; then
    stop_managed_process "dev server" "$(metadata_value "$SESSION_METADATA_FILE" "dev_pidfile")"
  fi

  if [[ "$(metadata_value "$SESSION_METADATA_FILE" "watcher_managed")" == "true" ]]; then
    stop_managed_process \
      "$(metadata_value "$SESSION_METADATA_FILE" "watch_name")" \
      "$(metadata_value "$SESSION_METADATA_FILE" "watch_pidfile")"
  fi

  rm -f "$SESSION_METADATA_FILE"
  cleanup_session_dir_if_empty "$SESSION_DIR"
  log "Stopped managed session for ${DEV_HOST}:${DEV_PORT}"
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

DEV_SERVER_MANAGED="false"
WATCHER_MANAGED="false"

if [[ "$DO_DEV_SERVER" -eq 1 ]]; then
  if url_is_ready "$DEV_URL"; then
    log "Dev server already reachable at ${DEV_URL}"
  else
    start_managed_process \
      "dev server" \
      "$DEV_PIDFILE" \
      "$DEV_LOGFILE" \
      bun run dev -- --host "$DEV_HOST" --port "$DEV_PORT"

    if ! wait_for_url "$DEV_URL" 30; then
      fail "dev server did not become reachable at ${DEV_URL} within 30 seconds. See ${DEV_LOGFILE}."
    fi

    DEV_SERVER_MANAGED="true"
    log "Dev server ready at ${DEV_URL}?agent=true"
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
  WATCHER_MANAGED="true"
else
  log "Skipping watcher startup"
fi

write_session_metadata \
  "$SESSION_METADATA_FILE" \
  session_key "$SESSION_KEY" \
  host "$DEV_HOST" \
  port "$DEV_PORT" \
  profile "$PROFILE" \
  watch_mode "$WATCH_MODE" \
  model_roles "$(IFS=,; echo "${MODEL_ROLES[*]}")" \
  url "$DEV_URL" \
  dev_server_managed "$DEV_SERVER_MANAGED" \
  dev_pidfile "$DEV_PIDFILE" \
  dev_logfile "$DEV_LOGFILE" \
  watcher_managed "$WATCHER_MANAGED" \
  watch_name "$WATCH_NAME" \
  watch_pidfile "$WATCH_PIDFILE" \
  watch_logfile "$WATCH_LOGFILE"

log "Session ready"
echo "- Agent URL: ${DEV_URL}?agent=true"
echo "- Session state: bun run session:codex -- --status"
echo "- Stop managed processes: bun run session:codex -- --port ${DEV_PORT} --stop"
