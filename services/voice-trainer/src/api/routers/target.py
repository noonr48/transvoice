from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.services.audio_analysis import build_phrase_forecast, build_target_voice_profile, normalize_target_preset
from src.services.contracts import VoicePhraseForecastRequest, VoicePhraseForecastResponse, VoiceTargetProfile, VoiceTargetProfileRequest
from src.services.storage import model_to_dict, voice_storage


router = APIRouter(prefix='/api/v1/voice/target', tags=['voice-target'])


@router.post('/profile', response_model=VoiceTargetProfile)
async def derive_target_profile(payload: VoiceTargetProfileRequest):
  reference_analysis = voice_storage.get_reference(payload.clipId)
  if reference_analysis is None:
    raise HTTPException(status_code=404, detail='Reference clip not found')

  try:
    resolved_preset = normalize_target_preset(payload.targetPreset)
    profile = build_target_voice_profile(reference_analysis, resolved_preset)
  except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc
  voice_storage.save_target_profile(profile)
  return model_to_dict(profile)


@router.post('/forecast', response_model=VoicePhraseForecastResponse)
async def forecast_target_phrase(payload: VoicePhraseForecastRequest):
  try:
    forecast = build_phrase_forecast(payload.targetProfile, payload.phrase)
  except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc
  return model_to_dict(forecast)
