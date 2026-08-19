#!/usr/bin/env bash
# VoxCPM TTS service starter.
# - Binds 127.0.0.1:8020
# - Pins CUDA_VISIBLE_DEVICES=1 (use GPU index 1 as cuda:0 inside the process)
# - Uses the local .venv next to this script
# - uvicorn with --workers 1 (semaphore inside the app already serialises synthesis)
# - Logs to runtime-cache/voxcpm-tts.log
# - Forwards SIGTERM/SIGINT to uvicorn for clean shutdown

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$SERVICE_DIR"

VENV_PY="$SERVICE_DIR/.venv/bin/uvicorn"
if [[ ! -x "$VENV_PY" ]]; then
  echo "ERROR: uvicorn not found at $VENV_PY" >&2
  echo "       Did you create the virtualenv in $SERVICE_DIR/.venv ?" >&2
  exit 1
fi

LOG_DIR="$SERVICE_DIR/runtime-cache"
LOG_FILE="$LOG_DIR/voxcpm-tts.log"
mkdir -p "$LOG_DIR"

HOST="127.0.0.1"
PORT="8020"
WORKERS="1"
GPU_INDEX="1"

PID_FILE="$LOG_DIR/voxcpm-tts.pid"

# Stale-pid guard: if a pid file points at a dead process, clean it up.
if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "${OLD_PID:-}" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "ERROR: VoxCPM TTS already running (pid=$OLD_PID, log=$LOG_FILE)" >&2
    exit 1
  fi
  rm -f "$PID_FILE"
fi

echo "============================================================"
echo " VoxCPM TTS Service"
echo "   Host:    $HOST"
echo "   Port:    $PORT"
echo "   GPU:     CUDA_VISIBLE_DEVICES=$GPU_INDEX"
echo "   Workers: $WORKERS"
echo "   Venv:    $SERVICE_DIR/.venv"
echo "   Log:     $LOG_FILE"
echo "   PidFile: $PID_FILE"
echo "============================================================"

export CUDA_VISIBLE_DEVICES="$GPU_INDEX"

# Launch uvicorn in the background of this shell so we can trap signals
# and forward a clean SIGTERM to it.
"$VENV_PY" app.main:app \
  --host "$HOST" \
  --port "$PORT" \
  --workers "$WORKERS" \
  --no-access-log \
  >>"$LOG_FILE" 2>&1 &

UVICORN_PID=$!
echo "$UVICORN_PID" >"$PID_FILE"
echo "Started uvicorn (pid=$UVICORN_PID). Tailing $LOG_FILE ..."

cleanup() {
  local sig="${1:-TERM}"
  if kill -0 "$UVICORN_PID" 2>/dev/null; then
    echo "Received $sig, forwarding SIGTERM to uvicorn (pid=$UVICORN_PID) ..."
    kill -TERM "$UVICORN_PID" 2>/dev/null || true
    # Give uvicorn a moment to flush, then SIGKILL if it lingers.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$UVICORN_PID" 2>/dev/null || break
      sleep 0.5
    done
    if kill -0 "$UVICORN_PID" 2>/dev/null; then
      echo "uvicorn did not exit, sending SIGKILL"
      kill -KILL "$UVICORN_PID" 2>/dev/null || true
    fi
  fi
  rm -f "$PID_FILE"
  exit 0
}

trap 'cleanup TERM' SIGTERM
trap 'cleanup INT'  SIGINT
trap 'cleanup HUP'   SIGHUP

# Wait for uvicorn to exit. `wait` is interrupted by the trap, which
# forwards the signal and re-exits with status 0.
wait "$UVICORN_PID"
STATUS=$?
rm -f "$PID_FILE"
exit "$STATUS"
