from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.api.routers.presets import router as presets_router
from src.api.routers.reference import router as reference_router
from src.api.routers.sessions import (
  attempts_router,
  milestones_router,
  router as sessions_router,
)
from src.api.routers.summary import router as summary_router
from src.api.routers.synthesis import router as synthesis_router
from src.api.routers.target import router as target_router
from src.config import http_authorized, settings
from src.services.storage import voice_storage


app = FastAPI(
  title='VoiceTrainer',
  version='0.1.0',
  description='Local voice-analysis service for SLOANE Voice mode.',
)

app.add_middleware(
  CORSMiddleware,
  allow_origins=list(settings.cors_origins),
  allow_credentials=False,
  allow_methods=['*'],
  allow_headers=['*'],
)

@app.middleware('http')
async def voice_trainer_auth_guard(request: Request, call_next):
  token = getattr(settings, 'auth_token', '') or ''
  if not token:
    return await call_next(request)
  if request.method == 'OPTIONS' or request.url.path == '/health':
    return await call_next(request)

  # Constant-time, Bearer-header-only (no ?token= on HTTP routes — that leaks
  # into logs). The WebSocket upgrade authenticates separately in sessions.py.
  if http_authorized(request.headers.get('authorization', ''), token):
    return await call_next(request)

  return JSONResponse({'error': 'Unauthorized'}, status_code=401)


@app.get('/health')
async def health():
  return {
    'status': 'ok',
    'service': 'voice-trainer',
    'storageRoot': str(settings.storage_root),
    'sessions': voice_storage.session_count(),
    'references': voice_storage.reference_count(),
    'capabilities': [
      'session-lifecycle',
      'reference-analysis',
      'target-voice-profiles',
      'custom-target-presets',
      'phrase-forecasting',
      'websocket-frame-stream',
      'one-shot-take',
      'summary-generation',
      'milestones',
      # 2026-07-30: stateless analysis of app-synthesized audio (tutor speech).
      # Advertised so the gateway can tell a service that can measure the tutor
      # from one that predates the route and would 404.
      'synthesis-analysis',
    ],
    'targetProfiles': voice_storage.target_profile_count(),
    'customPresets': voice_storage.custom_preset_count(),
    'milestones': voice_storage.milestone_count(),
  }


app.include_router(sessions_router)
app.include_router(attempts_router)
app.include_router(milestones_router)
app.include_router(presets_router)
app.include_router(reference_router)
app.include_router(summary_router)
app.include_router(synthesis_router)
app.include_router(target_router)


def main() -> None:
  # Bind using `VOICE_TRAINER_HOST` / `VOICE_TRAINER_PORT` so config controls runtime.
  import uvicorn

  uvicorn.run(app, host=settings.host, port=settings.port, log_level='info')


if __name__ == '__main__':
  main()
