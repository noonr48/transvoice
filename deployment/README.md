# Voice Tutor Standalone Deployment

## Goal

Expose the standalone Voice Tutor frontend through HTTPS and route live backend
traffic through the same origin. This is the safest browser shape for Android,
Windows, Linux, and remote desktops because microphone capture requires a secure
context and VoiceTrainer streaming needs WSS.

## Recommended Topology

```text
browser / PWA
  https://voice.example.com/voice-tutor.html
          │
          ├─ static files from /opt/sloane/voice-tutor/dist
          └─ HTTPS/WSS reverse proxy
                  │
                  └─ 127.0.0.1:3021 voice-standalone-server.js
                            ├─ 127.0.0.1:8002 VoiceTrainer
                            └─ 127.0.0.1:8019/v1 GGUF model server
```

In the launcher, use:

- Backend URL: `https://voice.example.com`
- Backend WebSocket URL: `wss://voice.example.com`
- VoiceTrainer URL: `https://voice.example.com/voice-trainer`

The launcher's `Use Same-Origin Proxy` button fills these values from the page
origin. `Copy Launch Link` then creates a portable URL for another device.

## Build Frontend Assets

From `sloane-ui`:

```bash
pnpm run voice:template:check
pnpm build
pnpm run voice:deploy:prepare -- --domain voice.example.com --email admin@example.com
pnpm run voice:deploy:rehearse
pnpm run voice:deploy:service-smoke
```

The deploy preparer creates `dist/voice-tutor-deploy/` with:

- `dist/` static frontend assets.
- `backend/voice-standalone-server.js` plus its minimal runtime dependency
  closure and `backend/package.json`;
- `shared/contracts/` files required by the standalone gateway;
- rendered `deployment/caddy/Caddyfile`;
- rendered `deployment/nginx/voice-tutor.conf`;
- rendered `deployment/systemd/system/voice-tutor-standalone.service`;
- rendered `deployment/systemd/user/voice-tutor-standalone.service`;
- rendered `deployment/voice-standalone.env.example`;
- `install.sh`, which installs assets, backend runtime, env, optional systemd
  service, and optional proxy config;
- `manifest.json` with SHA-256 file receipts.

Install the bundle on the target host:

```bash
cd dist/voice-tutor-deploy
VOICE_TUTOR_PROXY=none ./install.sh
```

Host paths are rendered at bundle-preparation time, not install time. Use
`--install-root`, `--env-path`, `--state-root`, `--system-service-path`,
`--caddy-path`, and the Nginx path flags when preparing the bundle if the target
host should not use the defaults.

Use `VOICE_TUTOR_PROXY=caddy` or `VOICE_TUTOR_PROXY=nginx` when you want the
installer to place and reload one of the rendered proxy configs. The default is
`none` so the first install cannot overwrite a live proxy unexpectedly.

Use `VOICE_TUTOR_SERVICE=user` to install the standalone gateway as a user
systemd service, or `VOICE_TUTOR_SERVICE=system` to install the rendered system
unit. The default is `none` so installing the bundle cannot unexpectedly start
or replace a live gateway:

```bash
VOICE_TUTOR_SERVICE=user VOICE_TUTOR_PROXY=none ./install.sh
VOICE_TUTOR_SERVICE=system VOICE_TUTOR_PROXY=caddy ./install.sh
```

The installer requires Node 20 or newer and runs `npm install --omit=dev` inside
the installed minimal backend runtime by default. Set
`VOICE_TUTOR_BACKEND_NPM_INSTALL=0` only when dependencies are already present
under the prepared install root's `backend/` directory.

`pnpm run voice:deploy:service-smoke` is the local user-systemd gate. It creates
a temporary deploy bundle with a random gateway port, installs it with
`VOICE_TUTOR_SERVICE=user`, checks the generated service responds, then disables
and removes the temporary unit.

## Standalone Gateway

Use `voice-standalone.env.example` as the production env shape. Keep the gateway,
VoiceTrainer, and GGUF model bound to loopback unless you have a separate network
security layer.

Minimum health checks on the host:

```bash
curl -fsS http://127.0.0.1:3021/health
curl -fsS http://127.0.0.1:3021/voice/health
curl -fsS http://127.0.0.1:3021/voice-trainer/health
pnpm run voice:doctor -- --backend-url http://127.0.0.1:3021
```

When `VOICE_TUTOR_SERVICE=user` or `VOICE_TUTOR_SERVICE=system` is used, the
installer starts the service and checks `/voice/standalone/sessions?limit=1`
before it returns. Set `VOICE_TUTOR_STRICT_DEPENDENCY_HEALTH=1` if the installer
should also require `/health` and `/voice/health`, which depend on VoiceTrainer
and the GGUF model being reachable.

`voice:doctor` runs the expensive active readiness path intentionally: session
store write, VoiceTrainer session start, VoiceTrainer websocket frame, cleanup,
and GGUF chat completion. The frontend does not run this continuously; use the
launcher or app “Run Deep Check” button when diagnosing a setup.

Systemd unit templates:

- `deployment/systemd/user/voice-tutor-standalone.service` is the safer default
  for a personal workstation or Tailscale host.
- `deployment/systemd/system/voice-tutor-standalone.service` is for a managed
  server. The installer creates the dedicated `sloane-voice` system user/group,
  tightens env-file permissions, and the unit allows writes only to
  `VOICE_STANDALONE_STATE_ROOT`.

## Caddy

Use `caddy/Caddyfile` when automatic TLS is preferred:

```bash
sudo cp dist/voice-tutor-deploy/deployment/caddy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Caddy handles WebSocket upgrades automatically. The provided matcher proxies
only backend/API paths and serves the PWA shell directly from `dist`.

## Nginx

Use `nginx/voice-tutor.conf` when the host already standardizes on Nginx:

```bash
sudo cp dist/voice-tutor-deploy/deployment/nginx/voice-tutor.conf /etc/nginx/sites-available/voice-tutor.conf
sudo ln -sf /etc/nginx/sites-available/voice-tutor.conf /etc/nginx/sites-enabled/voice-tutor.conf
sudo nginx -t
sudo systemctl reload nginx
```

The Nginx example forwards WebSocket upgrade headers on the backend route group,
disables proxy buffering for realtime capture, and keeps the service worker and
manifest uncached.

## Validation

From `sloane-ui`:

```bash
pnpm run voice:deploy:check
pnpm run voice:doctor -- --backend-url http://127.0.0.1:3021
pnpm run voice:deploy:rehearse
pnpm run voice:deploy:service-smoke
pnpm run voice:deploy:prepare -- --domain voice.example.com
VOICE_STANDALONE_LAUNCHER_URL=https://voice.example.com/voice-tutor.html \
VOICE_STANDALONE_BACKEND_URL=https://voice.example.com \
VOICE_STANDALONE_BACKEND_WS_URL=wss://voice.example.com \
VOICE_STANDALONE_TRAINER_URL=https://voice.example.com/voice-trainer \
pnpm run voice:smoke:launcher

VOICE_STANDALONE_FRONTEND_URL=https://voice.example.com/voice-tutor-app.html \
VOICE_STANDALONE_BACKEND_URL=https://voice.example.com \
pnpm run voice:smoke:live
```

Expected browser launcher values for same-origin deployment:

```text
backendUrl=https://voice.example.com
backendWsUrl=wss://voice.example.com
voiceTrainerUrl=https://voice.example.com/voice-trainer
```

## Production Notes

- Do not expose `127.0.0.1:8002` or `127.0.0.1:8019` directly to browsers.
- Keep `/voice-trainer/*` on the gateway/proxy path so auth tokens and upstream
  topology stay backend-side.
- Do not cache `/voice/*`, `/voice-trainer/*`, `/health`, `/task/*`, or session
  routes at the proxy/CDN layer.
- If the frontend is hosted separately from the backend, use the explicit URL
  fields instead of same-origin mode and keep CORS enabled on the gateway.
- For user services, install `transvoice.target`, the gateway unit, and all
  three `*.service.d/transvoice.conf` drop-ins from `deployment/systemd/user/`.
  The drop-ins bind the LLM to loopback, identify each journal stream, and join
  all four services to the target lifecycle.
