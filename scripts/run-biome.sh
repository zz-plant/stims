#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: bash scripts/run-biome.sh <check|lint|format> [biome args...]" >&2
  exit 1
fi

command="$1"
shift

targets=(
  "assets"
  "scripts"
  "tests"
  "package.json"
  "tsconfig.json"
  "biome.json"
  "wrangler.mcp.jsonc"
  "vite.config.js"
  "index.html"
  "milkdrop/index.html"
  "performance/index.html"
  "public/manifest.json"
  "public/test-audio-controls-harness.html"
  ".vscode/settings.json"
  ".vscode/extensions.json"
  ".vscode/launch.json"
  ".vscode/tasks.json"
)

exec biome "$command" "${targets[@]}" --files-ignore-unknown=true "$@"
