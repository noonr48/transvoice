from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.services.contracts import VoiceAttemptSummary
from src.services.streaming_analyzer import streaming_analyzer
from src.services.storage import model_to_dict


router = APIRouter(prefix='/api/v1/voice/sessions', tags=['voice-summary'])


@router.get('/{voice_session_id}/summary', response_model=VoiceAttemptSummary)
async def get_voice_summary(voice_session_id: str):
  summary = streaming_analyzer.summarize_session(voice_session_id)
  if summary is None:
    raise HTTPException(status_code=404, detail='Voice session not found')
  return model_to_dict(summary)
