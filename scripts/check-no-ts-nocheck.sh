#!/usr/bin/env bash
set -euo pipefail

matches=$(rg --line-number --no-heading '@ts-nocheck' assets scripts tests --glob '*.{js,ts}' || true)

if [[ -n "$matches" ]]; then
  echo "Found forbidden @ts-nocheck directives:"
  echo "$matches"
  echo
  echo "Remove @ts-nocheck and resolve the underlying type issues."
  exit 1
fi

echo "No @ts-nocheck directives found in assets/, scripts/, or tests/."
