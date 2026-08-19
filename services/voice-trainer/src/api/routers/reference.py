from __future__ import annotations

import mimetypes

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from src.services.reference_analyzer import reference_analyzer
from src.services.contracts import ReferenceAnalysisResponse
from src.services.storage import model_to_dict, voice_storage


router = APIRouter(prefix='/api/v1/voice/reference', tags=['voice-reference'])


@router.post('/analyze', response_model=ReferenceAnalysisResponse)
async def analyze_reference(
  file: UploadFile = File(...),
  targetPreset: str = Form('cute-feminine'),
):
  try:
    analysis = await reference_analyzer.analyze_upload(file, targetPreset)
  except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc
  return model_to_dict(analysis)


@router.get('/{clip_id}', response_model=ReferenceAnalysisResponse)
async def get_reference_analysis(clip_id: str):
  analysis = voice_storage.get_reference(clip_id)
  if analysis is None:
    raise HTTPException(status_code=404, detail='Reference clip not found')
  return model_to_dict(analysis)


@router.get('/{clip_id}/audio')
async def get_reference_audio(clip_id: str):
  analysis = voice_storage.get_reference(clip_id)
  if analysis is None:
    raise HTTPException(status_code=404, detail='Reference clip not found')

  raw_path = voice_storage.get_reference_file_path(clip_id)
  if raw_path is None or not raw_path.exists():
    raise HTTPException(status_code=404, detail='Reference audio not found')

  media_type = mimetypes.guess_type(raw_path.name)[0] or 'application/octet-stream'
  return FileResponse(raw_path, media_type=media_type, filename=analysis.filename or raw_path.name)
