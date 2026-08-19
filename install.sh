#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_ROOT="/opt/sloane/voice-tutor"
ENV_PATH="/etc/sloane/voice-standalone.env"
PROXY="${VOICE_TUTOR_PROXY:-none}" # none, caddy, or nginx
SERVICE="${VOICE_TUTOR_SERVICE:-none}" # none, system, or user
SERVICE_NAME="voice-tutor-standalone.service"
SYSTEM_SERVICE_PATH="/etc/systemd/system/voice-tutor-standalone.service"
USER_SYSTEMD_DIR="${VOICE_TUTOR_USER_SYSTEMD_DIR:-$HOME/.config/systemd/user}"
CADDY_PATH="/etc/caddy/Caddyfile"
NGINX_AVAILABLE_PATH="/etc/nginx/sites-available/voice-tutor.conf"
NGINX_ENABLED_PATH="/etc/nginx/sites-enabled/voice-tutor.conf"
SYSTEM_USER="sloane-voice"
SYSTEM_GROUP="sloane-voice"

as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif "$@" >/dev/null 2>&1; then
    return
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "This install step needs root permissions and sudo is unavailable: $*" >&2
    exit 1
  fi
}

copy_tree() {
  local source="$1"
  local target="$2"
  as_root mkdir -p "$target"
  if command -v rsync >/dev/null 2>&1; then
    as_root rsync -a --delete "$source"/ "$target"/
  else
    as_root rm -rf "$target"
    as_root mkdir -p "$target"
    as_root cp -a "$source"/. "$target"/
  fi
}

install_env_if_missing() {
  as_root mkdir -p "$(dirname "$ENV_PATH")"
  if [ ! -f "$ENV_PATH" ]; then
    as_root cp "$SCRIPT_DIR/deployment/voice-standalone.env.example" "$ENV_PATH"
    echo "Installed env template: $ENV_PATH"
  else
    echo "Env file already exists, leaving unchanged: $ENV_PATH"
  fi
}

ensure_system_service_user() {
  if [ "$SERVICE" != "system" ]; then
    return
  fi
  if ! getent group "$SYSTEM_GROUP" >/dev/null 2>&1; then
    as_root groupadd --system "$SYSTEM_GROUP"
  fi
  if ! id -u "$SYSTEM_USER" >/dev/null 2>&1; then
    local nologin="/usr/sbin/nologin"
    if [ ! -x "$nologin" ] && [ -x "/sbin/nologin" ]; then
      nologin="/sbin/nologin"
    fi
    as_root useradd --system --no-create-home --home-dir /nonexistent --shell "$nologin" --gid "$SYSTEM_GROUP" "$SYSTEM_USER"
  fi
}

fix_env_permissions() {
  case "$SERVICE" in
    system)
      as_root chgrp "$SYSTEM_GROUP" "$ENV_PATH"
      as_root chmod 0640 "$ENV_PATH"
      ;;
    user)
      as_root chown "$(id -u):$(id -g)" "$ENV_PATH"
      as_root chmod 0600 "$ENV_PATH"
      ;;
  esac
}

validate_node_runtime() {
  if ! command -v node >/dev/null 2>&1; then
    echo "node is required to run the Voice Tutor standalone gateway." >&2
    exit 1
  fi
  node <<'NODE'
const [major] = process.versions.node.split('.').map(Number);
if (major < 20) {
  throw new Error(`Voice Tutor standalone gateway requires Node >=20; found ${process.versions.node}`);
}
if (typeof fetch !== 'function') {
  throw new Error('Voice Tutor standalone gateway requires global fetch.');
}
if (!globalThis.AbortSignal || typeof globalThis.AbortSignal.timeout !== 'function') {
  throw new Error('Voice Tutor standalone gateway requires AbortSignal.timeout.');
}
NODE
}

install_backend_runtime() {
  validate_node_runtime
  copy_tree "$SCRIPT_DIR/backend" "$INSTALL_ROOT/backend"
  copy_tree "$SCRIPT_DIR/shared" "$INSTALL_ROOT/shared"
  if [ "${VOICE_TUTOR_BACKEND_NPM_INSTALL:-1}" = "0" ]; then
    echo "Skipping backend npm install because VOICE_TUTOR_BACKEND_NPM_INSTALL=0."
    return
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm is required to install backend runtime dependencies." >&2
    exit 1
  fi
  as_root npm --prefix "$INSTALL_ROOT/backend" install --omit=dev --no-audit --no-fund
}

source_env_if_readable() {
  if [ -f "$ENV_PATH" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$ENV_PATH"
    set +a
  fi
}

ensure_state_root() {
  source_env_if_readable
  local state_root="${VOICE_STANDALONE_STATE_ROOT:-/var/lib/sloane/voice-standalone}"
  as_root mkdir -p "$state_root"
  if [ "$SERVICE" = "user" ]; then
    as_root chown -R "$(id -u):$(id -g)" "$state_root"
  elif [ "$SERVICE" = "system" ]; then
    as_root chown -R "$SYSTEM_USER:$SYSTEM_GROUP" "$state_root"
  fi
}

reload_service_if_available() {
  local service="$1"
  if command -v systemctl >/dev/null 2>&1; then
    as_root systemctl reload "$service" || as_root systemctl restart "$service"
  fi
}

check_gateway_health() {
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is unavailable; skipping gateway health check."
    return
  fi
  source_env_if_readable
  local host="${VOICE_STANDALONE_HOST:-127.0.0.1}"
  local port="${VOICE_STANDALONE_PORT:-3021}"
  if [ "$host" = "0.0.0.0" ]; then
    host="127.0.0.1"
  fi
  local base_url="http://$host:$port"
  for attempt in $(seq 1 30); do
    if curl -fsS "$base_url/voice/standalone/sessions?limit=1" >/dev/null 2>&1; then
      if [ "${VOICE_TUTOR_STRICT_DEPENDENCY_HEALTH:-0}" = "1" ]; then
        curl -fsS "$base_url/health" >/dev/null
        curl -fsS "$base_url/voice/health" >/dev/null
      fi
      echo "Voice Tutor standalone gateway is reachable at $base_url"
      return
    fi
    sleep 1
  done
  echo "Voice Tutor standalone gateway did not become reachable at $base_url" >&2
  exit 1
}

validate_backend_runtime() {
  validate_node_runtime
  if [ ! -f "$INSTALL_ROOT/backend/voice-standalone-server.js" ]; then
    echo "Missing installed backend runtime: $INSTALL_ROOT/backend/voice-standalone-server.js" >&2
    exit 1
  fi
  if [ ! -f "$ENV_PATH" ]; then
    echo "Missing env file: $ENV_PATH" >&2
    exit 1
  fi
  node --check "$INSTALL_ROOT/backend/voice-standalone-server.js" >/dev/null
  (cd "$INSTALL_ROOT/backend" && node -e "for (const name of ['cors','express','ws']) require(name)")
}

install_gateway_service() {
  validate_backend_runtime
  case "$SERVICE" in
    none)
      echo "Skipping gateway service install. Set VOICE_TUTOR_SERVICE=system or VOICE_TUTOR_SERVICE=user to install one."
      ;;
    system)
      if ! command -v systemctl >/dev/null 2>&1; then
        echo "systemctl is required for VOICE_TUTOR_SERVICE=system." >&2
        exit 1
      fi
      as_root mkdir -p "$(dirname "$SYSTEM_SERVICE_PATH")"
      as_root cp "$SCRIPT_DIR/deployment/systemd/system/voice-tutor-standalone.service" "$SYSTEM_SERVICE_PATH"
      as_root systemctl daemon-reload
      as_root systemctl enable --now "$SERVICE_NAME"
      check_gateway_health
      ;;
    user)
      if ! command -v systemctl >/dev/null 2>&1; then
        echo "systemctl is required for VOICE_TUTOR_SERVICE=user." >&2
        exit 1
      fi
      mkdir -p "$USER_SYSTEMD_DIR"
      cp "$SCRIPT_DIR/deployment/systemd/user/voice-tutor-standalone.service" "$USER_SYSTEMD_DIR/$SERVICE_NAME"
      systemctl --user daemon-reload
      systemctl --user enable --now "$SERVICE_NAME"
      check_gateway_health
      ;;
    *)
      echo "Unsupported VOICE_TUTOR_SERVICE=$SERVICE; expected none, system, or user." >&2
      exit 1
      ;;
  esac
}

install_proxy_config() {
  case "$PROXY" in
    none)
      echo "Skipping proxy config install. Set VOICE_TUTOR_PROXY=caddy or VOICE_TUTOR_PROXY=nginx to install one."
      ;;
    caddy)
      as_root mkdir -p "$(dirname "$CADDY_PATH")"
      as_root cp "$SCRIPT_DIR/deployment/caddy/Caddyfile" "$CADDY_PATH"
      if command -v caddy >/dev/null 2>&1; then
        as_root caddy validate --config "$CADDY_PATH"
      fi
      reload_service_if_available caddy
      ;;
    nginx)
      as_root mkdir -p "$(dirname "$NGINX_AVAILABLE_PATH")" "$(dirname "$NGINX_ENABLED_PATH")"
      as_root cp "$SCRIPT_DIR/deployment/nginx/voice-tutor.conf" "$NGINX_AVAILABLE_PATH"
      as_root ln -sf "$NGINX_AVAILABLE_PATH" "$NGINX_ENABLED_PATH"
      if command -v nginx >/dev/null 2>&1; then
        as_root nginx -t
      fi
      reload_service_if_available nginx
      ;;
    *)
      echo "Unsupported VOICE_TUTOR_PROXY=$PROXY; expected none, caddy, or nginx." >&2
      exit 1
      ;;
  esac
}

copy_tree "$SCRIPT_DIR/dist" "$INSTALL_ROOT/dist"
install_backend_runtime
copy_tree "$SCRIPT_DIR/scripts" "$INSTALL_ROOT/scripts"
copy_tree "$SCRIPT_DIR/deployment" "$INSTALL_ROOT/deployment"
install_env_if_missing
ensure_system_service_user
fix_env_permissions
ensure_state_root
install_gateway_service
install_proxy_config

echo "Voice Tutor frontend installed to $INSTALL_ROOT/dist"
echo "Voice Tutor backend installed to $INSTALL_ROOT/backend"
echo "Launcher: https://voice.example.com/voice-tutor.html"
echo "Backend URL: https://voice.example.com"
echo "Backend WebSocket URL: wss://voice.example.com"
echo "VoiceTrainer URL: https://voice.example.com/voice-trainer"
