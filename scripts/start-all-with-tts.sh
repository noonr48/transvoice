#!/usr/bin/env bash
# Convenience starter: brings up the VoxCPM TTS service and the
# transvoice-app gateway together, waits for both to be healthy,
# and prints the PIDs of each process.
#
# Usage:
#   ./scripts/start-all-with-tts.sh
#
# Stopping the stack: kill the printed PIDs (or use stop-all.sh if present).

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TTS_DIR="$REPO_DIR/services/voxcpm-tts"
TTS_START="$TTS_DIR/scripts/start.sh"
TTS_LOG="$TTS_DIR/runtime-cache/voxcpm-tts.log"
TTS_PID_FILE="$TTS_DIR/runtime-cache/voxcpm-tts.pid"
TTS_URL="http://127.0.0.1:8020"

GATEWAY_LOG="$REPO_DIR/runtime-cache/transvoice-gateway.log"
GATEWAY_PID_FILE="$REPO_DIR/runtime-cache/transvoice-gateway.pid"
mkdir -p "$REPO_DIR/runtime-cache"

# Read gateway port from .env (default 3021) so the health check is correct
# even if the operator changed VOICE_STANDALONE_PORT.
GATEWAY_HOST="127.0.0.1"
GATEWAY_PORT="3021"
if [[ -f "$REPO_DIR/.env" ]]; then
  if grep -qE '^[[:space:]]*VOICE_STANDALONE_HOST=' "$REPO_DIR/.env"; then
    GATEWAY_HOST="$(grep -E '^[[:space:]]*VOICE_STANDALONE_HOST=' "$REPO_DIR/.env" \
      | head -n1 | cut -d= -f2- | tr -d '\"'\''[:space:]')"
  fi
  if grep -qE '^[[:space:]]*VOICE_STANDALONE_PORT=' "$REPO_DIR/.env"; then
    GATEWAY_PORT="$(grep -E '^[[:space:]]*VOICE_STANDALONE_PORT=' "$REPO_DIR/.env" \
      | head -n1 | cut -d= -f2- | tr -d '\"'\''[:space:]')"
  fi
fi
GATEWAY_URL="http://${GATEWAY_HOST}:${GATEWAY_PORT}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

wait_for_http() {
  local url="$1"
  local want_body="${2:-}"
  local label="$3"
  local timeout_s="${4:-120}"
  local start_ts elapsed

  start_ts="$(date +%s)"
  while true; do
    elapsed=$(( $(date +%s) - start_ts ))
    if (( elapsed >= timeout_s )); then
      echo "ERROR: $label did not become healthy within ${timeout_s}s (last url=$url)" >&2
      return 1
    fi

    local body
    local code
    body="$(curl --silent --max-time 3 --show-error -o - -w '\n%{http_code}' "$url" 2>/dev/null || true)"
    code="$(printf '%s' "$body" | tail -n1)"
    body="$(printf '%s' "$body" | sed '$d')"

    if [[ -n "$want_body" ]]; then
      if [[ "$code" == "200" ]] && printf '%s' "$body" | grep -q -- "$want_body"; then
        echo "  [$label] healthy after ${elapsed}s (code=$code)"
        return 0
      fi
    else
      if [[ "$code" == "200" ]]; then
        echo "  [$label] healthy after ${elapsed}s (code=$code)"
        return 0
      fi
    fi

    sleep 1
  done
}

pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

# ---------------------------------------------------------------------------
# 1) TTS service
# ---------------------------------------------------------------------------

echo "==> Starting VoxCPM TTS service ..."
if [[ ! -x "$TTS_START" ]]; then
  echo "ERROR: $TTS_START is missing or not executable" >&2
  exit 1
fi

# If a previous run left a pid file pointing at a live process, reuse it.
if [[ -f "$TTS_PID_FILE" ]] && pid_alive "$(cat "$TTS_PID_FILE" 2>/dev/null || true)"; then
  TTS_PID="$(cat "$TTS_PID_FILE")"
  echo "  Reusing existing TTS process (pid=$TTS_PID)"
else
  rm -f "$TTS_PID_FILE"
  "$TTS_START" </dev/null >>"$TTS_LOG" 2>&1 &
  TTS_PID=$!
  # The TTS starter writes its own pid file, but capture the immediate
  # shell pid for diagnostics in case startup hangs.
  echo "  Spawned TTS starter (wrapper pid=$TTS_PID). Waiting for /ready ..."
fi

wait_for_http "$TTS_URL/ready" '"ready":true' "voxcpm-tts" 180
TTS_READY_PID="$(cat "$TTS_PID_FILE" 2>/dev/null || echo "$TTS_PID")"

# ---------------------------------------------------------------------------
# 2) transvoice-app gateway
# ---------------------------------------------------------------------------

echo "==> Starting transvoice-app gateway on $GATEWAY_URL ..."
if [[ -f "$GATEWAY_PID_FILE" ]] && pid_alive "$(cat "$GATEWAY_PID_FILE" 2>/dev/null || true)"; then
  GW_PID="$(cat "$GATEWAY_PID_FILE")"
  echo "  Reusing existing gateway process (pid=$GW_PID)"
else
  rm -f "$GATEWAY_PID_FILE"
  (
    cd "$REPO_DIR"
    nohup node server.js >>"$GATEWAY_LOG" 2>&1 &
    echo $! >"$GATEWAY_PID_FILE"
  )
  GW_PID="$(cat "$GATEWAY_PID_FILE")"
  echo "  Spawned gateway (pid=$GW_PID). Waiting for /voice/speech/status ..."
fi

# /voice/speech/status returns 200 when the runtime is ready. We accept
# any 200 — body content varies across versions.
wait_for_http "$GATEWAY_URL/voice/speech/status" "" "transvoice-gateway" 60

# ---------------------------------------------------------------------------
# 3) Report
# ---------------------------------------------------------------------------

cat <<EOF

============================================================
 Stack is up
   VoxCPM TTS     pid=$TTS_READY_PID  $TTS_URL
   TransVoice GW  pid=$GW_PID  $GATEWAY_URL
============================================================
 Logs:
   tail -f $TTS_LOG
   tail -f $GATEWAY_LOG
 Stop:
   kill $GW_PID $TTS_READY_PID
============================================================
EOF
