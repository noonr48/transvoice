from __future__ import annotations

from fastapi import APIRouter, HTTPException

from src.services.contracts import (
  VoiceCustomTargetPreset,
  VoiceCustomTargetPresetDuplicateRequest,
  VoiceCustomTargetPresetDeleteResponse,
  VoiceCustomTargetPresetLibraryResponse,
  VoiceCustomTargetPresetMutationRequest,
  VoiceCustomTargetPresetSaveRequest,
  VoiceHandmadeTargetPresetSaveRequest,
  VoiceReferenceTargetPresetSaveRequest,
)
from src.services.storage import model_to_dict
from src.services.target_preset_library import (
  VoiceTargetPresetCalibrationError,
  VoiceTargetPresetConflictError,
  voice_target_preset_library,
)


router = APIRouter(prefix='/api/v1/voice/presets', tags=['voice-presets'])


def _save_custom_target_preset(save_operation, payload):
  try:
    preset = save_operation(payload)
  except VoiceTargetPresetConflictError as exc:
    raise HTTPException(status_code=409, detail=str(exc)) from exc
  except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc
  return model_to_dict(preset)


@router.get('', response_model=VoiceCustomTargetPresetLibraryResponse)
async def list_custom_target_presets(includeArchived: bool = False):
  return {
    'presets': [
      model_to_dict(preset)
      for preset in voice_target_preset_library.list_presets(include_archived=includeArchived)
    ],
  }


@router.post('', response_model=VoiceCustomTargetPreset)
async def save_custom_target_preset(payload: VoiceCustomTargetPresetSaveRequest):
  return _save_custom_target_preset(voice_target_preset_library.save_preset, payload)


@router.post('/reference/save', response_model=VoiceCustomTargetPreset)
async def save_reference_target_preset(payload: VoiceReferenceTargetPresetSaveRequest):
  return _save_custom_target_preset(voice_target_preset_library.save_reference_preset, payload)


@router.post('/handmade/save', response_model=VoiceCustomTargetPreset)
async def save_handmade_target_preset(payload: VoiceHandmadeTargetPresetSaveRequest):
  return _save_custom_target_preset(voice_target_preset_library.save_handmade_preset, payload)


@router.get('/{preset_id}', response_model=VoiceCustomTargetPreset)
async def get_custom_target_preset(preset_id: str):
  try:
    preset = voice_target_preset_library.get_preset(preset_id)
  except VoiceTargetPresetCalibrationError as exc:
    raise HTTPException(status_code=409, detail=str(exc)) from exc
  if preset is None:
    raise HTTPException(status_code=404, detail='Custom voice preset not found')
  return model_to_dict(preset)


@router.post('/{preset_id}/duplicate', response_model=VoiceCustomTargetPreset)
async def duplicate_custom_target_preset(preset_id: str, payload: VoiceCustomTargetPresetDuplicateRequest):
  return _save_custom_target_preset(
    lambda request: voice_target_preset_library.duplicate_preset(preset_id, request),
    payload,
  )


@router.post('/{preset_id}/archive', response_model=VoiceCustomTargetPreset)
async def archive_custom_target_preset(preset_id: str, payload: VoiceCustomTargetPresetMutationRequest):
  try:
    preset = voice_target_preset_library.archive_preset(preset_id, payload)
  except VoiceTargetPresetConflictError as exc:
    raise HTTPException(status_code=409, detail=str(exc)) from exc
  if preset is None:
    raise HTTPException(status_code=404, detail='Custom voice preset not found')
  return model_to_dict(preset)


@router.post('/{preset_id}/restore', response_model=VoiceCustomTargetPreset)
async def restore_custom_target_preset(preset_id: str, payload: VoiceCustomTargetPresetMutationRequest):
  try:
    preset = voice_target_preset_library.restore_preset(preset_id, payload)
  except VoiceTargetPresetConflictError as exc:
    raise HTTPException(status_code=409, detail=str(exc)) from exc
  if preset is None:
    raise HTTPException(status_code=404, detail='Custom voice preset not found')
  return model_to_dict(preset)


@router.delete('/{preset_id}', response_model=VoiceCustomTargetPresetDeleteResponse)
async def delete_custom_target_preset(preset_id: str, expectedUpdatedAt: int | None = None):
  try:
    deleted_preset = voice_target_preset_library.delete_preset(preset_id, {
      'expectedUpdatedAt': expectedUpdatedAt,
    })
  except VoiceTargetPresetConflictError as exc:
    raise HTTPException(status_code=409, detail=str(exc)) from exc
  if deleted_preset is None:
    raise HTTPException(status_code=404, detail='Custom voice preset not found')
  return {
    'deletedPreset': model_to_dict(deleted_preset),
  }
