#!/usr/bin/env bash
set -euo pipefail
BASE_URL="${1:-https://toil.fyi}"
if ! command -v curl >/dev/null 2>&1; then echo "curl is required" >&2; exit 1; fi
endpoints=("/" "/milkdrop/")
failures=0; dns_failures=0
for endpoint in "${endpoints[@]}"; do
  url="${BASE_URL%/}${endpoint}"
  headers_file="$(mktemp)"; body_file="$(mktemp)"; curl_status=0
  curl -sS -D "$headers_file" "$url" -o "$body_file" || curl_status=$?
  status_line="$(awk '/^HTTP\// {line=$0} END {print line}' "$headers_file")"
  status_code="$(awk '{print $2}' <<<"$status_line")"
  echo "[$endpoint] ${status_line:-HTTP status unavailable}"
  if [[ "$curl_status" -eq 6 ]]; then
    echo "  ❌ DNS resolution failed."
    dns_failures=$((dns_failures + 1)); failures=$((failures + 1))
  elif grep -qi '^cf-mitigated:\s*challenge' "$headers_file"; then
    echo "  ❌ Cloudflare managed challenge is enabled for this endpoint."
    failures=$((failures + 1))
  elif [[ "$status_code" == "403" ]] && grep -qi 'Just a moment' "$body_file"; then
    echo "  ❌ Received Cloudflare challenge interstitial body."
    failures=$((failures + 1))
  elif [[ -z "${status_code:-}" ]] || [[ "$status_code" -ge 400 ]]; then
    echo "  ❌ Non-success response (${status_code:-unknown})."
    failures=$((failures + 1))
  else
    echo "  ✅ Reachable."
  fi
  rm -f "$headers_file" "$body_file"
done
if (( failures > 0 )); then
  if (( dns_failures > 0 )) && (( failures == dns_failures )) && [[ "${STRICT_DNS_FAILURES:-0}" != "1" ]]; then
    echo "\nProduction edge checks completed with DNS warnings."; exit 0
  fi
  echo "\n❌ Production edge checks found failures."; exit 1
fi
echo "\nAll production edge checks passed."
