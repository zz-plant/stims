#!/usr/bin/env bash
set -euo pipefail

# grep, not ripgrep: the GitHub runner has no `rg`, and the `|| true` below
# turned that into a silent pass — the guard reported success while checking
# nothing. grep is in every environment this runs in.
matches=$(grep -rn --include='*.js' --include='*.ts' '@ts-nocheck' src scripts tests || true)

if [[ -n "$matches" ]]; then
  echo "Found forbidden @ts-nocheck directives:"
  echo "$matches"
  echo
  echo "Remove @ts-nocheck and resolve the underlying type issues."
  exit 1
fi

echo "No @ts-nocheck directives found in src/, scripts/, or tests/."
