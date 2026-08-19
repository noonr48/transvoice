#!/usr/bin/env bash
set -euo pipefail

probe_url="${1:-http://127.0.0.1:3021/health}"
attempts="${TRANSVOICE_READY_ATTEMPTS:-30}"

for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  if health_payload="$(/usr/bin/curl --fail --silent --show-error --max-time 1 "$probe_url" 2>/dev/null)"; then
    case "$health_payload" in
      *'"service":"voice-tutor-standalone"'*'"status":"online"'*) exit 0 ;;
    esac
  fi
  /usr/bin/sleep 1
done

printf '%s|ERROR|transvoice-gateway|S12:listener-ready|wait-for-transvoice-gateway.sh|not-connected|health probe did not become ready after %s attempts\n' \
  "$(date --iso-8601=seconds)" "$attempts" >&2
exit 1
