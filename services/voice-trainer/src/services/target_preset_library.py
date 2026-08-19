from __future__ import annotations

import math
import random
import re
import time
from typing import Any

from src.services.audio_analysis import MAX_PITCH_HZ, MIN_PITCH_HZ, build_target_voice_profile, clamp, get_target_profile, normalize_target_preset
from src.services.contracts import (
  ReferenceAnalysisResponse,
  VOICE_ANALYSIS_VERSION,
  VoiceAttemptMetrics,
  VoiceCustomTargetPreset,
  VoiceTargetAdvancedBands,
  VoiceTargetProfile,
)
from src.services.storage import clone_model, voice_storage


HANDMADE_TARGET_FIELD_NAMES = (
  'pitchFloorHz',
  'pitchCeilingHz',
  'resonanceFloor',
  'resonanceCeiling',
  'weightFloor',
  'weightCeiling',
  'stylePrompt',
)
_LAST_TIMESTAMP_MS = 0


class VoiceTargetPresetConflictError(ValueError):
  pass


class VoiceTargetPresetCalibrationError(ValueError):
  pass


def _clone_model(model: Any) -> Any:
  if model is None:
    return None
  if hasattr(model, 'model_dump'):
    payload = model.model_dump()
    return model.__class__(**payload)
  return model.__class__(**model.dict())


def _payload_to_dict(payload: dict[str, Any] | Any) -> dict[str, Any]:
  if payload is None:
    return {}
  if hasattr(payload, 'model_dump'):
    return payload.model_dump(exclude_unset=True)
  if hasattr(payload, 'dict'):
    return payload.dict(exclude_unset=True)
  return dict(payload or {})


def _coerce_dict(value: Any) -> dict[str, Any]:
  if value is None:
    return {}
  if hasattr(value, 'model_dump'):
    return value.model_dump(exclude_unset=True)
  if hasattr(value, 'dict'):
    return value.dict(exclude_unset=True)
  if isinstance(value, dict):
    return dict(value)
  return {}


def _normalize_text(value: Any, max_length: int) -> str:
  if not isinstance(value, str):
    return ''
  return value.strip()[:max_length]


def _normalize_optional_text(value: Any, max_length: int) -> str | None:
  normalized = _normalize_text(value, max_length)
  return normalized or None


def _normalize_notes(value: Any) -> list[str]:
  raw_values: list[str]
  if isinstance(value, list):
    raw_values = [str(entry or '') for entry in value]
  elif isinstance(value, str):
    raw_values = re.split(r'\r?\n|,', value)
  else:
    raw_values = []

  return [
    entry.strip()
    for entry in raw_values
    if isinstance(entry, str) and entry.strip()
  ][:6]


def _normalize_timestamp(value: Any, fallback: int) -> int:
  numeric = int(value) if isinstance(value, (int, float)) and value else None
  return numeric if numeric and numeric > 0 else fallback


def _normalize_optional_timestamp(value: Any) -> int | None:
  if not isinstance(value, (int, float)) or not math.isfinite(value):
    return None
  numeric = int(value)
  return numeric if numeric > 0 else None


def _normalize_numeric(
  field_name: str,
  value: Any,
  lower: float,
  upper: float,
) -> float | None:
  if value is None or value == '':
    return None
  if isinstance(value, bool):
    raise ValueError(
      f'{field_name} must be a finite number between {lower} and {upper}.',
    )
  try:
    numeric = float(value)
  except (TypeError, ValueError):
    raise ValueError(
      f'{field_name} must be a finite number between {lower} and {upper}.',
    ) from None
  if not math.isfinite(numeric) or numeric < lower or numeric > upper:
    raise ValueError(
      f'{field_name} must be a finite number between {lower} and {upper}; received {value!r}.',
    )
  return numeric


def _validate_band_order(
  floor_name: str,
  floor_value: float,
  ceiling_name: str,
  ceiling_value: float,
) -> None:
  if floor_value >= ceiling_value:
    raise ValueError(
      f'{floor_name} must be lower than {ceiling_name}; '
      f'received {floor_value} and {ceiling_value}.',
    )


def _next_timestamp_ms() -> int:
  global _LAST_TIMESTAMP_MS
  timestamp = int(time.time() * 1000)
  _LAST_TIMESTAMP_MS = max(timestamp, _LAST_TIMESTAMP_MS + 1)
  return _LAST_TIMESTAMP_MS


def _build_preset_id() -> str:
  timestamp = _next_timestamp_ms()
  return f'voice_preset_{format(timestamp, "x")}_{random.randint(0, 0xFFFFFF):06x}'


def _sort_presets(presets: list[VoiceCustomTargetPreset]) -> list[VoiceCustomTargetPreset]:
  return sorted(
    presets,
    key=lambda preset: (
      -(int(preset.updatedAt or 0)),
      (preset.name or '').lower(),
    ),
  )


def _normalize_reference_analysis(value: Any) -> ReferenceAnalysisResponse | None:
  if value is None:
    return None
  if isinstance(value, ReferenceAnalysisResponse):
    return _clone_model(value)
  if isinstance(value, dict):
    return ReferenceAnalysisResponse(**value)
  raise ValueError('Invalid reference analysis payload for the custom voice preset.')


def _assert_reference_calibration_current(
  reference_analysis: ReferenceAnalysisResponse | None,
  target_voice_profile: VoiceTargetProfile | None = None,
) -> None:
  if reference_analysis is None:
    return
  if reference_analysis.analysisVersion != VOICE_ANALYSIS_VERSION:
    raise VoiceTargetPresetCalibrationError(
      'This saved reference target uses an older or unknown acoustic calibration. '
      'Re-analyze its retained audio before practicing against it.',
    )
  if (
    target_voice_profile is not None
    and target_voice_profile.analysisVersion != VOICE_ANALYSIS_VERSION
  ):
    raise VoiceTargetPresetCalibrationError(
      'This saved reference target profile uses an older acoustic calibration. '
      'Re-analyze its retained audio before practicing against it.',
    )


def _normalize_preset_id(raw: dict[str, Any]) -> str:
  candidate = raw.get('id')
  if not candidate:
    candidate = raw.get('presetId')
  return _normalize_text(candidate, 120)


def _normalize_kind(raw: dict[str, Any], existing_preset: VoiceCustomTargetPreset | None) -> str:
  if raw.get('kind') == 'handmade':
    return 'handmade'
  if raw.get('kind') == 'reference':
    return 'reference'
  if 'handmadeTarget' in raw or any(field_name in raw for field_name in HANDMADE_TARGET_FIELD_NAMES):
    return 'handmade'
  if existing_preset is not None and existing_preset.kind == 'handmade':
    return 'handmade'
  return 'reference'


def _resolve_notes(
  raw: dict[str, Any],
  existing_preset: VoiceCustomTargetPreset | None,
) -> tuple[list[str], bool]:
  handmade_target = _coerce_dict(raw.get('handmadeTarget'))
  legacy_target_profile = _coerce_dict(raw.get('targetVoiceProfile'))

  if 'notes' in raw:
    return _normalize_notes(raw.get('notes')), True
  if 'notesText' in raw:
    return _normalize_notes(raw.get('notesText')), True
  if 'notesText' in handmade_target:
    return _normalize_notes(handmade_target.get('notesText')), True
  if existing_preset is not None and existing_preset.notes:
    return list(existing_preset.notes), False
  return _normalize_notes(legacy_target_profile.get('notes')), False


def _resolve_handmade_payload(
  raw: dict[str, Any],
  existing_preset: VoiceCustomTargetPreset | None,
) -> dict[str, Any]:
  handmade_target = _coerce_dict(raw.get('handmadeTarget'))
  legacy_target_profile = _coerce_dict(raw.get('targetVoiceProfile'))
  existing_target_profile = _coerce_dict(
    existing_preset.targetVoiceProfile
    if existing_preset is not None and existing_preset.kind == 'handmade'
    else None
  )

  payload: dict[str, Any] = {}
  for field_name in HANDMADE_TARGET_FIELD_NAMES:
    value = handmade_target.get(field_name)
    if value in (None, ''):
      value = raw.get(field_name)
    if value in (None, ''):
      value = legacy_target_profile.get(field_name)
    if value in (None, ''):
      value = existing_target_profile.get(field_name)
    if value not in (None, ''):
      payload[field_name] = value
  return payload


def _build_handmade_target_voice_profile(
  preset_id: str,
  name: str,
  base_preset: str,
  payload: dict[str, Any] | None,
  notes: list[str],
) -> VoiceTargetProfile:
  raw = payload or {}
  base_target = get_target_profile(base_preset)

  pitch_floor_hz = _normalize_numeric(
    'pitchFloorHz', raw.get('pitchFloorHz'), MIN_PITCH_HZ, MAX_PITCH_HZ,
  )
  pitch_ceiling_hz = _normalize_numeric(
    'pitchCeilingHz', raw.get('pitchCeilingHz'), MIN_PITCH_HZ, MAX_PITCH_HZ,
  )
  if pitch_floor_hz is None:
    pitch_floor_hz = round(base_target.pitch_floor_hz, 2)
  if pitch_ceiling_hz is None:
    pitch_ceiling_hz = round(base_target.pitch_ceiling_hz, 2)
  _validate_band_order(
    'pitchFloorHz', pitch_floor_hz, 'pitchCeilingHz', pitch_ceiling_hz,
  )

  resonance_floor = _normalize_numeric(
    'resonanceFloor', raw.get('resonanceFloor'), 0.0, 1.0,
  )
  resonance_ceiling = _normalize_numeric(
    'resonanceCeiling', raw.get('resonanceCeiling'), 0.0, 1.0,
  )
  # base_target.min_resonance_mean is a THRESHOLD, not a band centre: a floor for
  # feminine targets ("be at least this bright"). Place the default band on the
  # correct side so a custom target doesn't silently tolerate resonance the base
  # preset rejects.
  # 2026-07-27 MTF-ONLY: the `direction == 'masculine'` branch is REMOVED as dead
  # code. `base_preset` is normalized through normalize_target_preset below,
  # which raises ValueError for every retired masc* id.
  # 2026-07-30 MTF-ONLY: the `direction == 'neutral'` branch is REMOVED the same
  # way — it built a band CENTRED on the threshold (+-0.06) for the androgynous /
  # gender-neutral base presets, both of which are gone from TARGET_PROFILES, so
  # `base_target.direction` can only be 'feminine'. The one-sided default below
  # is the surviving fallback and answers for every direction.
  default_resonance = clamp(base_target.min_resonance_mean)
  if resonance_floor is None:
    resonance_floor = round(default_resonance, 3)
  if resonance_ceiling is None:
    resonance_ceiling = round(clamp(default_resonance + 0.12), 3)
  _validate_band_order(
    'resonanceFloor', resonance_floor, 'resonanceCeiling', resonance_ceiling,
  )

  weight_floor = _normalize_numeric(
    'weightFloor', raw.get('weightFloor'), 0.0, 1.0,
  )
  weight_ceiling = _normalize_numeric(
    'weightCeiling', raw.get('weightCeiling'), 0.0, 1.0,
  )
  # max_weight_mean is a CEILING for feminine targets ("be at most this heavy").
  # 2026-07-27 MTF-ONLY: the `direction == 'masculine'` branch is REMOVED as dead
  # code, for the same reason as the resonance block above.
  # 2026-07-30 MTF-ONLY: the `direction == 'neutral'` branch is REMOVED too — it
  # built a band CENTRED on the threshold (+-0.06); no base preset can be
  # neutral now. The one-sided default below is the surviving fallback.
  default_weight = clamp(base_target.max_weight_mean)
  if weight_ceiling is None:
    weight_ceiling = round(default_weight, 3)
  if weight_floor is None:
    weight_floor = round(clamp(default_weight - 0.12), 3)
  _validate_band_order(
    'weightFloor', weight_floor, 'weightCeiling', weight_ceiling,
  )

  pitch_range_ratio = max(pitch_ceiling_hz / max(pitch_floor_hz, 1.0), 1.01)
  pitch_range_st = round(max(1.8, min(8.0, 12.0 * math.log2(pitch_range_ratio))), 2)
  style_prompt = _normalize_optional_text(raw.get('stylePrompt'), 240) or (
    f'Follow the exact saved pitch, resonance, and weight bands for this custom '
    f'{base_preset.replace("-", " ")} target; keep the sound comfortable and unforced.'
  )

  return VoiceTargetProfile(
    profileId=f'custom-profile-{preset_id}',
    clipId=f'custom-preset-{preset_id}',
    sourceFilename=name,
    durationMs=0,
    targetPreset=base_preset,
    metrics=VoiceAttemptMetrics(
      meanPitchHz=round((pitch_floor_hz + pitch_ceiling_hz) / 2.0, 2),
      pitchRangeSt=pitch_range_st,
      resonanceMean=round((resonance_floor + resonance_ceiling) / 2.0, 3),
      weightMean=round((weight_floor + weight_ceiling) / 2.0, 3),
      targetHitPct=1.0,
      similarityScore=1.0,
    ),
    pitchFloorHz=pitch_floor_hz,
    pitchCeilingHz=pitch_ceiling_hz,
    resonanceFloor=resonance_floor,
    resonanceCeiling=resonance_ceiling,
    weightFloor=weight_floor,
    weightCeiling=weight_ceiling,
    stylePrompt=style_prompt,
    notes=notes,
    advancedBands=VoiceTargetAdvancedBands(
      pitchP10HzFloor=pitch_floor_hz,
      pitchP90HzCeiling=pitch_ceiling_hz,
    ),
    analysisVersion='voice-custom-preset-v2',
  )


def _normalize_target_voice_profile(
  *,
  preset_id: str,
  name: str,
  kind: str,
  base_preset: str,
  existing_preset: VoiceCustomTargetPreset | None,
  target_voice_profile: dict[str, Any] | None,
  reference_analysis: ReferenceAnalysisResponse | None,
  handmade_payload: dict[str, Any],
  notes: list[str],
) -> VoiceTargetProfile | None:
  if kind == 'handmade':
    return _build_handmade_target_voice_profile(
      preset_id=preset_id,
      name=name,
      base_preset=base_preset,
      payload=handmade_payload,
      notes=notes,
    )

  if reference_analysis is not None:
    return build_target_voice_profile(reference_analysis, base_preset)
  if target_voice_profile is not None:
    return VoiceTargetProfile(**target_voice_profile)
  if existing_preset is not None and existing_preset.targetVoiceProfile is not None:
    return _clone_model(existing_preset.targetVoiceProfile)
  return None


class VoiceTargetPresetLibrary:
  def __init__(self, storage = voice_storage):
    self.storage = storage

  def list_presets(self, include_archived: bool = False) -> list[VoiceCustomTargetPreset]:
    presets = [
      _clone_model(preset)
      for preset in self.storage.list_custom_presets()
      if include_archived or not bool(preset.archived)
    ]
    return _sort_presets(presets)

  def get_preset(self, preset_id: str) -> VoiceCustomTargetPreset | None:
    normalized_preset_id = _normalize_text(preset_id, 120)
    if not normalized_preset_id:
      return None
    preset = self.storage.get_custom_preset(normalized_preset_id)
    if preset is not None and preset.kind == 'reference':
      _assert_reference_calibration_current(
        preset.referenceAnalysis,
        preset.targetVoiceProfile,
      )
    return _clone_model(preset) if preset is not None else None

  def _assert_expected_updated_at(
    self,
    existing_preset: VoiceCustomTargetPreset | None,
    raw: dict[str, Any],
    *,
    action_label: str,
  ) -> None:
    if existing_preset is None:
      return
    expected_updated_at = _normalize_optional_timestamp(raw.get('expectedUpdatedAt'))
    if expected_updated_at is None:
      return
    actual_updated_at = _normalize_optional_timestamp(existing_preset.updatedAt)
    if actual_updated_at != expected_updated_at:
      raise VoiceTargetPresetConflictError(
        f'This custom preset changed before {action_label}. Refresh the preset library and try again.',
      )

  def _persist_preset(self, preset: VoiceCustomTargetPreset) -> VoiceCustomTargetPreset:
    return self.storage.save_custom_preset(preset)

  def _ensure_mutable_preset(
    self,
    existing_preset: VoiceCustomTargetPreset | None,
    *,
    action_label: str,
  ) -> None:
    if existing_preset is not None and existing_preset.archived:
      raise ValueError(
        f'Archived custom presets cannot be {action_label}. Restore the preset first.',
      )

  def save_reference_preset(self, payload: dict[str, Any] | Any) -> VoiceCustomTargetPreset:
    raw = _payload_to_dict(payload)
    raw['kind'] = 'reference'
    return self.save_preset(raw)

  def save_handmade_preset(self, payload: dict[str, Any] | Any) -> VoiceCustomTargetPreset:
    raw = _payload_to_dict(payload)
    raw['kind'] = 'handmade'
    return self.save_preset(raw)

  def save_preset(self, payload: dict[str, Any] | Any) -> VoiceCustomTargetPreset:
    raw = _payload_to_dict(payload)
    now = _next_timestamp_ms()
    requested_preset_id = _normalize_preset_id(raw)
    existing_preset = self.storage.get_custom_preset(requested_preset_id) if requested_preset_id else None
    self._assert_expected_updated_at(existing_preset, raw, action_label='saving it')
    self._ensure_mutable_preset(existing_preset, action_label='edited')
    preset_id = existing_preset.id if existing_preset is not None else (requested_preset_id or _build_preset_id())

    kind = _normalize_kind(raw, existing_preset)
    base_preset_candidate = _normalize_text(raw.get('basePreset'), 80).lower()
    base_preset_source = (
      base_preset_candidate
      or (existing_preset.basePreset if existing_preset is not None else None)
    )
    base_preset = normalize_target_preset(base_preset_source)
    requested_notes, notes_provided = _resolve_notes(raw, existing_preset)

    reference_clip_id = None
    reference_clip_name = None
    reference_analysis = None
    if kind == 'reference':
      reference_clip_id = (
        _normalize_optional_text(raw.get('referenceClipId'), 120)
        or (existing_preset.referenceClipId if existing_preset is not None else None)
      )
      provided_reference_analysis = _normalize_reference_analysis(raw.get('referenceAnalysis'))
      if (
        reference_clip_id is not None
        and provided_reference_analysis is not None
        and provided_reference_analysis.clipId != reference_clip_id
      ):
        raise ValueError('referenceClipId does not match the provided referenceAnalysis clipId.')
      resolved_reference_analysis = self.storage.get_reference(reference_clip_id) if reference_clip_id else None
      reference_analysis = (
        resolved_reference_analysis
        or provided_reference_analysis
        or (
          _clone_model(existing_preset.referenceAnalysis)
          if existing_preset is not None
          and existing_preset.referenceAnalysis is not None
          and (
            reference_clip_id is None
            or existing_preset.referenceAnalysis.clipId == reference_clip_id
          )
          else None
        )
      )
      if reference_analysis is not None:
        reference_clip_id = reference_analysis.clipId
        _assert_reference_calibration_current(reference_analysis)
      reference_clip_name = (
        _normalize_optional_text(raw.get('referenceClipName'), 200)
        or (reference_analysis.filename if reference_analysis is not None else None)
        or (existing_preset.referenceClipName if existing_preset is not None else None)
      )

    name = (
      _normalize_optional_text(raw.get('name'), 120)
      or (existing_preset.name if existing_preset is not None else None)
      or reference_clip_name
      or _normalize_optional_text(raw.get('referenceClipName'), 200)
      or ('Handmade custom target' if kind == 'handmade' else 'Saved reference voice')
    )
    if not name:
      raise ValueError('A custom preset name is required.')

    target_voice_profile_payload = _coerce_dict(raw.get('targetVoiceProfile')) or None
    handmade_payload = _resolve_handmade_payload(raw, existing_preset)
    target_voice_profile = _normalize_target_voice_profile(
      preset_id=preset_id,
      name=name,
      kind=kind,
      base_preset=base_preset,
      existing_preset=existing_preset,
      target_voice_profile=target_voice_profile_payload,
      reference_analysis=reference_analysis,
      handmade_payload=handmade_payload,
      notes=requested_notes,
    )
    if kind == 'reference' and reference_analysis is None:
      raise ValueError(
        'A trustworthy reference analysis is required for reference presets.'
      )
    if kind == 'reference' and target_voice_profile is None:
      if reference_clip_id:
        raise ValueError(f'Could not resolve a saved reference analysis for clip "{reference_clip_id}".')
      raise ValueError('A reference clip or target voice profile is required for reference presets.')

    notes = requested_notes
    if not notes and not notes_provided and target_voice_profile is not None:
      notes = list(target_voice_profile.notes or [])

    preset = VoiceCustomTargetPreset(
      id=preset_id,
      name=name,
      kind=kind,
      basePreset=base_preset,
      createdAt=existing_preset.createdAt if existing_preset is not None else _normalize_timestamp(raw.get('createdAt'), now),
      updatedAt=now,
      archived=False,
      archivedAt=None,
      targetVoiceProfile=target_voice_profile,
      referenceClipId=reference_clip_id,
      referenceClipName=reference_clip_name,
      referenceAnalysis=reference_analysis,
      sourceLabel=_normalize_optional_text(raw.get('sourceLabel'), 120)
      or (existing_preset.sourceLabel if existing_preset is not None else None)
      or ('Handmade custom target' if kind == 'handmade' else 'Saved from reference'),
      notes=notes,
    )
    return self._persist_preset(preset)

  def duplicate_preset(self, preset_id: str, payload: dict[str, Any] | Any = None) -> VoiceCustomTargetPreset:
    normalized_preset_id = _normalize_text(preset_id, 120)
    if not normalized_preset_id:
      raise ValueError('A preset id is required.')
    existing_preset = self.storage.get_custom_preset(normalized_preset_id)
    if existing_preset is None:
      raise ValueError('Custom voice preset not found.')
    raw = _payload_to_dict(payload)
    self._assert_expected_updated_at(existing_preset, raw, action_label='duplicating it')
    now = _next_timestamp_ms()
    duplicate_name = (
      _normalize_optional_text(raw.get('name'), 120)
      or f'{existing_preset.name} Copy'
    )
    duplicate = VoiceCustomTargetPreset(
      id=_build_preset_id(),
      name=duplicate_name,
      kind=existing_preset.kind,
      basePreset=existing_preset.basePreset,
      createdAt=now,
      updatedAt=now,
      archived=False,
      archivedAt=None,
      targetVoiceProfile=_clone_model(existing_preset.targetVoiceProfile),
      referenceClipId=existing_preset.referenceClipId,
      referenceClipName=existing_preset.referenceClipName,
      referenceAnalysis=_clone_model(existing_preset.referenceAnalysis),
      sourceLabel=existing_preset.sourceLabel,
      notes=list(existing_preset.notes or []),
    )
    return self._persist_preset(duplicate)

  def archive_preset(self, preset_id: str, payload: dict[str, Any] | Any = None) -> VoiceCustomTargetPreset | None:
    normalized_preset_id = _normalize_text(preset_id, 120)
    if not normalized_preset_id:
      return None
    existing_preset = self.storage.get_custom_preset(normalized_preset_id)
    if existing_preset is None:
      return None
    raw = _payload_to_dict(payload)
    self._assert_expected_updated_at(existing_preset, raw, action_label='archiving it')
    if existing_preset.archived:
      return _clone_model(existing_preset)
    now = _next_timestamp_ms()
    archived_preset = clone_model(existing_preset, {
      'archived': True,
      'archivedAt': now,
      'updatedAt': now,
    })
    return self._persist_preset(archived_preset)

  def restore_preset(self, preset_id: str, payload: dict[str, Any] | Any = None) -> VoiceCustomTargetPreset | None:
    normalized_preset_id = _normalize_text(preset_id, 120)
    if not normalized_preset_id:
      return None
    existing_preset = self.storage.get_custom_preset(normalized_preset_id)
    if existing_preset is None:
      return None
    raw = _payload_to_dict(payload)
    self._assert_expected_updated_at(existing_preset, raw, action_label='restoring it')
    if not existing_preset.archived:
      return _clone_model(existing_preset)
    now = _next_timestamp_ms()
    restored_preset = clone_model(existing_preset, {
      'archived': False,
      'archivedAt': None,
      'updatedAt': now,
    })
    return self._persist_preset(restored_preset)

  def delete_preset(self, preset_id: str, payload: dict[str, Any] | Any = None) -> VoiceCustomTargetPreset | None:
    normalized_preset_id = _normalize_text(preset_id, 120)
    if not normalized_preset_id:
      return None
    existing_preset = self.storage.get_custom_preset(normalized_preset_id)
    if existing_preset is None:
      return None
    raw = _payload_to_dict(payload)
    self._assert_expected_updated_at(existing_preset, raw, action_label='deleting it')
    preset = self.storage.delete_custom_preset(normalized_preset_id)
    return _clone_model(preset) if preset is not None else None


voice_target_preset_library = VoiceTargetPresetLibrary()
