#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/codex-model-route.sh [options]

Route repo tasks onto the local LM Studio helper stack when available.

Modes:
  auto     Use lmstudio-route when available, otherwise fall back to triage.
  triage   Prefer the fast local model role.
  review   Prefer the quality local model role.
  embed    Prefer the embedding local model role.

Options:
  --mode <name>       Routing mode: auto, triage, review, or embed.
                      Default: auto.
  --task <text>       Task description for auto routing.
  --print-plan        Print the selected helper command.
  --no-exec           Do not run the helper command; print it only.
  --status            Print helper availability and exit.
  -h, --help          Show this help message.
USAGE
}

fail() {
  echo "Error: $*" >&2
  exit 1
}

MODE="auto"
TASK=""
PRINT_PLAN=0
NO_EXEC=0
STATUS_ONLY=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --task)
      TASK="${2:-}"
      shift 2
      ;;
    --print-plan)
      PRINT_PLAN=1
      shift
      ;;
    --no-exec)
      NO_EXEC=1
      shift
      ;;
    --status)
      STATUS_ONLY=1
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

helper_exists() {
  command -v "$1" >/dev/null 2>&1
}

print_helper_status() {
  local helper="$1"
  if helper_exists "$helper"; then
    echo "- ${helper}: available"
  else
    echo "- ${helper}: unavailable"
  fi
}

if [[ "$STATUS_ONLY" -eq 1 ]]; then
  echo "LM Studio helper status"
  print_helper_status "lmstudio-route"
  print_helper_status "lmstudio-fast"
  print_helper_status "lmstudio-quality"
  print_helper_status "lmstudio-embed"
  print_helper_status "lmstudio-ensure-model"
  exit 0
fi

case "$MODE" in
  auto|triage|review|embed)
    ;;
  *)
    fail "unknown mode '$MODE'. Expected auto, triage, review, or embed."
    ;;
esac

SELECTED_HELPER=""
SELECTED_ARGS=()
SELECTED_DESCRIPTION=""

case "$MODE" in
  auto)
    if [[ -n "$TASK" ]] && helper_exists "lmstudio-route"; then
      SELECTED_HELPER="lmstudio-route"
      SELECTED_ARGS=("$TASK")
      SELECTED_DESCRIPTION="auto route from task description"
    else
      MODE="triage"
    fi
    ;;
esac

if [[ -z "$SELECTED_HELPER" ]]; then
  case "$MODE" in
    triage)
      if helper_exists "lmstudio-fast"; then
        SELECTED_HELPER="lmstudio-fast"
        SELECTED_DESCRIPTION="fast local triage role"
      else
        SELECTED_HELPER="lmstudio-ensure-model"
        SELECTED_ARGS=("fast")
        SELECTED_DESCRIPTION="ensure fast local model role"
      fi
      ;;
    review)
      if helper_exists "lmstudio-quality"; then
        SELECTED_HELPER="lmstudio-quality"
        SELECTED_DESCRIPTION="quality local review role"
      else
        SELECTED_HELPER="lmstudio-ensure-model"
        SELECTED_ARGS=("quality")
        SELECTED_DESCRIPTION="ensure quality local model role"
      fi
      ;;
    embed)
      if helper_exists "lmstudio-embed"; then
        SELECTED_HELPER="lmstudio-embed"
        SELECTED_DESCRIPTION="embedding local model role"
      else
        SELECTED_HELPER="lmstudio-ensure-model"
        SELECTED_ARGS=("embed")
        SELECTED_DESCRIPTION="ensure embedding local model role"
      fi
      ;;
  esac
fi

if [[ "$NO_EXEC" -eq 0 ]] && ! helper_exists "$SELECTED_HELPER"; then
  fail "required helper '$SELECTED_HELPER' is not available."
fi

PLAN_LINE="- Helper: ${SELECTED_HELPER} ${SELECTED_ARGS[*]}"
DESC_LINE="- Purpose: ${SELECTED_DESCRIPTION}"

if [[ "$PRINT_PLAN" -eq 1 || "$NO_EXEC" -eq 1 ]]; then
  echo "$PLAN_LINE"
  echo "$DESC_LINE"
fi

if [[ "$NO_EXEC" -eq 1 ]]; then
  exit 0
fi

"$SELECTED_HELPER" "${SELECTED_ARGS[@]}"
