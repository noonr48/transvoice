from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import hmac
import os


def _parse_cors_origins(value: str) -> tuple[str, ...]:
  raw = (value or '').strip()
  # Fail closed: a blank/empty origins list grants NO cross-origin access
  # rather than falling open to '*'. The wildcard must be requested explicitly.
  if raw == '*':
    return ('*',)
  origins = [item.strip() for item in raw.split(',') if item.strip()]
  return tuple(origins)


def token_matches(provided: str, expected: str) -> bool:
  """Constant-time token comparison. Returns True when auth is disabled
  (expected token empty)."""
  if not expected:
    return True
  return hmac.compare_digest(str(provided or ''), str(expected))


def http_authorized(authorization_header: str, expected_token: str) -> bool:
  """HTTP authorization decision: Bearer header only.

  The token is deliberately NOT accepted as a `?token=` query parameter on HTTP
  routes — query strings leak into access logs, proxies and browser history.
  Only the WebSocket upgrade (where browsers cannot set request headers) reads
  the token from the query string."""
  if not expected_token:
    return True
  header = authorization_header or ''
  provided = header[7:] if header.startswith('Bearer ') else ''
  return token_matches(provided, expected_token)

def _normalize_env_value(value: str | None) -> str:
  return value.strip() if isinstance(value, str) else ''


def _resolve_public_host(host: str) -> str:
  explicit = _normalize_env_value(os.getenv('VOICE_TRAINER_PUBLIC_HOST'))
  if explicit:
    return explicit

  normalized_host = _normalize_env_value(host)
  if normalized_host and normalized_host not in {'0.0.0.0', '::'}:
    return normalized_host

  return 'localhost'

def _resolve_public_ws_base_url() -> str:
  """
  Base URL (scheme + host + optional port) used to build absolute `streamUrl` values.

  When unset, the API returns a relative websocket path so callers can resolve it against
  whatever origin they used to reach the service (more robust behind proxies / tunnels).
  """
  explicit = _normalize_env_value(os.getenv('VOICE_TRAINER_PUBLIC_WS_BASE_URL'))
  if explicit:
    return explicit.rstrip('/')
  return ''


def _default_storage_root() -> Path:
  sloane_local_root = _normalize_env_value(os.getenv('SLOANE_LOCAL_ROOT'))
  if sloane_local_root:
    return Path(sloane_local_root) / 'voice'

  solane_root = _normalize_env_value(os.getenv('SOLANE_ROOT'))
  if solane_root:
    return Path(solane_root) / 'sloane-local' / 'voice'

  # When running from within the solane repo, default to <repo>/sloane-local/voice.
  try:
    solane_repo_root = Path(__file__).resolve().parents[2]
    if (solane_repo_root / 'sloane-local').exists():
      return solane_repo_root / 'sloane-local' / 'voice'
  except Exception:
    pass

  return Path.home() / '.sloane' / 'voice'


def _resolve_storage_root() -> Path:
  explicit = _normalize_env_value(os.getenv('VOICE_TRAINER_STORAGE_ROOT'))
  if explicit:
    return Path(explicit)
  return _default_storage_root()

def _resolve_auth_token() -> str:
  return _normalize_env_value(os.getenv('VOICE_TRAINER_AUTH_TOKEN'))

def _resolve_durable_writes() -> bool:
  value = _normalize_env_value(os.getenv('VOICE_TRAINER_DURABLE_WRITES'))
  if not value:
    return False
  return value.lower() in {'1', 'true', 'yes', 'on'}


@dataclass(frozen=True)
class Settings:
  host: str
  port: int
  public_host: str
  public_ws_base_url: str
  storage_root: Path
  cors_origins: tuple[str, ...]
  auth_token: str
  durable_writes: bool


DEFAULT_VOICE_TRAINER_CORS_ORIGINS = (
  'http://localhost:1420,'
  'http://127.0.0.1:1420,'
  'http://localhost:5173,'
  'http://127.0.0.1:5173,'
  'http://localhost:3001,'
  'http://127.0.0.1:3001'
)

_host = os.getenv('VOICE_TRAINER_HOST', '127.0.0.1')

settings = Settings(
  host=_host,
  port=int(os.getenv('VOICE_TRAINER_PORT', '8002')),
  public_host=_resolve_public_host(_host),
  public_ws_base_url=_resolve_public_ws_base_url(),
  storage_root=_resolve_storage_root(),
  cors_origins=_parse_cors_origins(os.getenv('VOICE_TRAINER_CORS_ORIGINS', DEFAULT_VOICE_TRAINER_CORS_ORIGINS)),
  auth_token=_resolve_auth_token(),
  durable_writes=_resolve_durable_writes(),
)
