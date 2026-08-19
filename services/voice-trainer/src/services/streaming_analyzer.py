from __future__ import annotations

from datetime import datetime, timezone
import logging
import math
import threading
from typing import Any
import uuid

from src.config import settings
from src.services.audio_analysis import (
  LIVE_FRAME_SIZE,
  SAMPLE_RATE,
  analyze_pcm_frame,
  build_attempt_summary,
  build_target_voice_profile,
  normalize_target_preset,
  pcm16_bytes_to_float_samples,
  smooth_live_frame,
)
from src.services.contracts import (
  VOICE_ANALYSIS_VERSION,
  VoiceAttemptArtifact,
  VoiceAttemptSummary,
  VoiceFrame,
  VoiceRepContext,
  VoiceSelfReport,
  VoiceSessionStartRequest,
  VoiceSessionState,
  VoiceTargetProfile,
)
from src.services.reference_analyzer import reference_analyzer
from src.services.storage import clone_model, voice_storage


logger = logging.getLogger(__name__)


def _iso_now() -> str:
  return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

LIVE_TIMELINE_WINDOW_FRAMES = 240
# Flush the full session JSON to disk every N live frames (~1s at ~16 fps)
# instead of on every frame. The append-only frame log + PCM are still written
# every frame, and get_session is cache-first, so live reads stay current.
SESSION_PERSIST_INTERVAL_FRAMES = 16
ATTEMPT_ARTIFACT_TIMELINE_FRAMES = 180
ATTEMPT_ARTIFACT_MAX_TEXT_CHARS = 1200
ATTEMPT_ARTIFACT_MAX_KEY_CHARS = 80
ATTEMPT_ARTIFACT_MAX_COLLECTION_ITEMS = 32
ATTEMPT_ARTIFACT_MAX_JSON_DEPTH = 4
TARGET_SOURCE_CATEGORIES = frozenset({
  'built-in',
  'preset',
  'reference',
  'custom',
  'custom-handmade',
  'custom-reference',
})
REFERENCE_TARGET_SOURCES = frozenset({'reference', 'custom-reference'})
CUSTOM_TARGET_SOURCES = frozenset({'custom', 'custom-handmade'})
EXACT_REFERENCE_PROFILE_FIELDS = (
  'pitchFloorHz',
  'pitchCeilingHz',
  'resonanceFloor',
  'resonanceCeiling',
  'weightFloor',
  'weightCeiling',
)


def _model_payload(model: Any) -> dict[str, Any]:
  if hasattr(model, 'model_dump'):
    return model.model_dump(exclude_none=True)
  if hasattr(model, 'dict'):
    return model.dict(exclude_none=True)
  return dict(model) if isinstance(model, dict) else {}


def _reference_profile_matches(
  supplied: VoiceTargetProfile,
  expected: VoiceTargetProfile,
) -> bool:
  if (
    supplied.profileId != expected.profileId
    or supplied.clipId != expected.clipId
    or supplied.targetPreset != expected.targetPreset
  ):
    return False
  return all(
    math.isclose(
      float(getattr(supplied, field_name)),
      float(getattr(expected, field_name)),
      rel_tol=0.0,
      abs_tol=1e-9,
    )
    for field_name in EXACT_REFERENCE_PROFILE_FIELDS
  )


def _target_source_telemetry(value: Any) -> str:
  normalized = str(value or '').strip()
  return normalized if normalized in TARGET_SOURCE_CATEGORIES else 'unknown'


def _reject_session_start(
  reason: str,
  message: str,
  *,
  target_source: Any,
  reference_present: bool,
  profile_present: bool,
) -> None:
  logger.warning(
    'event=voice_session_start_rejected reason=%s target_source=%s '
    'reference_present=%s profile_present=%s',
    reason,
    _target_source_telemetry(target_source),
    reference_present,
    profile_present,
  )
  raise ValueError(message)


def _clip_text(value: str | None, max_chars: int = ATTEMPT_ARTIFACT_MAX_TEXT_CHARS) -> str | None:
  if value is None:
    return None
  text = str(value)
  return text if len(text) <= max_chars else text[:max_chars]


def _bounded_json_value(value: Any, depth: int = 0) -> Any:
  if value is None or isinstance(value, bool) or isinstance(value, int):
    return value
  if isinstance(value, float):
    return value
  if isinstance(value, str):
    return _clip_text(value)
  if depth >= ATTEMPT_ARTIFACT_MAX_JSON_DEPTH:
    return _clip_text(str(value))
  if isinstance(value, (list, tuple)):
    return [
      _bounded_json_value(item, depth + 1)
      for item in list(value)[:ATTEMPT_ARTIFACT_MAX_COLLECTION_ITEMS]
    ]
  if isinstance(value, dict):
    bounded: dict[str, Any] = {}
    for key, item in list(value.items())[:ATTEMPT_ARTIFACT_MAX_COLLECTION_ITEMS]:
      bounded_key = _clip_text(str(key), ATTEMPT_ARTIFACT_MAX_KEY_CHARS) or 'key'
      bounded[bounded_key] = _bounded_json_value(item, depth + 1)
    return bounded
  return _clip_text(str(value))


def _bounded_rep_context(rep_context: VoiceRepContext | None) -> VoiceRepContext | None:
  if rep_context is None:
    return None
  try:
    payload = _bounded_json_value(_model_payload(rep_context))
    return VoiceRepContext(**payload) if isinstance(payload, dict) else None
  except Exception:
    return None


def _bounded_self_report(self_report: VoiceSelfReport | None) -> VoiceSelfReport | None:
  if self_report is None:
    return None
  try:
    payload = _bounded_json_value(_model_payload(self_report))
    return VoiceSelfReport(**payload) if isinstance(payload, dict) else None
  except Exception:
    return None


def _sample_attempt_timeline(frames: list[VoiceFrame]) -> list[VoiceFrame]:
  if len(frames) <= ATTEMPT_ARTIFACT_TIMELINE_FRAMES:
    return list(frames)
  if ATTEMPT_ARTIFACT_TIMELINE_FRAMES <= 1:
    return frames[:1]

  last_index = len(frames) - 1
  sampled: list[VoiceFrame] = []
  used_indexes: set[int] = set()
  for sample_index in range(ATTEMPT_ARTIFACT_TIMELINE_FRAMES):
    source_index = round((sample_index / (ATTEMPT_ARTIFACT_TIMELINE_FRAMES - 1)) * last_index)
    if source_index in used_indexes:
      continue
    sampled.append(frames[source_index])
    used_indexes.add(source_index)
  return sampled


def _timeline_compression_label(frame_count: int, sampled_count: int) -> str:
  if frame_count <= sampled_count:
    return 'none'
  return f'uniform-sample:{frame_count}->{sampled_count}'


class VoiceSessionEndedError(RuntimeError):
  pass


class VoiceStreamBusyError(RuntimeError):
  """A one-shot take arrived while a WebSocket stream owns the session slot.

  The two must never interleave: they share `_sample_offset` and the session
  PCM file, so a one-shot folded into a live stream would corrupt both takes'
  timelines. This is also the race-free double-submission guard — the caller
  that loses simply does not contribute a take."""


# One-shot take limits. 60 s of 16 kHz mono PCM16 is the cap: long enough for
# any spoken turn or held vocalise, short enough that a runaway client cannot
# force minutes of synchronous DSP in one request.
ONESHOT_MAX_AUDIO_MS = 60_000
ONESHOT_MAX_PCM_BYTES = int(ONESHOT_MAX_AUDIO_MS * SAMPLE_RATE / 1000) * 2


class StreamingAnalyzer:
  def __init__(self):
    self._frame_index: dict[str, int] = {}
    self._sample_offset: dict[str, int] = {}
    self._session_locks: dict[str, threading.RLock] = {}
    self._session_locks_guard = threading.Lock()
    self._active_streams: set[str] = set()
    self._active_streams_guard = threading.Lock()

  def _lock_for_session(self, voice_session_id: str) -> threading.RLock:
    with self._session_locks_guard:
      lock = self._session_locks.get(voice_session_id)
      if lock is None:
        lock = threading.RLock()
        self._session_locks[voice_session_id] = lock
      return lock

  def acquire_stream(self, voice_session_id: str) -> bool:
    """Claim the single active streaming slot for a session. Returns False if a
    stream is already attached, so two concurrent WebSockets can't interleave
    into one shared sample_offset / PCM file and corrupt the timeline."""
    with self._active_streams_guard:
      if voice_session_id in self._active_streams:
        return False
      self._active_streams.add(voice_session_id)
      return True

  def release_stream(self, voice_session_id: str) -> None:
    with self._active_streams_guard:
      self._active_streams.discard(voice_session_id)

  def _stream_url(self, voice_session_id: str) -> str:
    path = f'/api/v1/voice/sessions/{voice_session_id}/stream'
    if getattr(settings, 'public_ws_base_url', ''):
      return f'{settings.public_ws_base_url}{path}'
    return path

  def start_session(self, request: VoiceSessionStartRequest) -> VoiceSessionState:
    target_preset = normalize_target_preset(request.targetPreset)
    profile_present = request.targetVoiceProfile is not None
    reference_present = bool(str(request.referenceClipId or '').strip())
    try:
      target_voice_profile = (
        VoiceTargetProfile(**request.targetVoiceProfile)
        if profile_present
        else None
      )
    except (TypeError, ValueError) as exc:
      logger.warning(
        'event=voice_session_start_rejected reason=invalid_target_profile '
        'target_source=%s reference_present=%s profile_present=%s',
        _target_source_telemetry(request.targetSource),
        reference_present,
        profile_present,
      )
      raise ValueError('Target voice profile is invalid.') from exc
    reference_clip_id = str(request.referenceClipId or '').strip() or None
    target_source = str(request.targetSource or '').strip() or (
      'reference' if reference_clip_id else (
        'custom' if target_voice_profile is not None else 'preset'
      )
    )

    if target_source not in TARGET_SOURCE_CATEGORIES:
      _reject_session_start(
        'invalid_target_source',
        'Unknown target source.',
        target_source=target_source,
        reference_present=reference_present,
        profile_present=profile_present,
      )

    if target_source in REFERENCE_TARGET_SOURCES:
      if reference_clip_id is None:
        _reject_session_start(
          'missing_reference_clip',
          'Reference target requires a reference clip.',
          target_source=target_source,
          reference_present=reference_present,
          profile_present=profile_present,
        )
      stored_analysis = voice_storage.get_reference(reference_clip_id)
      if stored_analysis is None:
        _reject_session_start(
          'missing_reference_analysis',
          'Reference target requires a stored trustworthy reference analysis.',
          target_source=target_source,
          reference_present=reference_present,
          profile_present=profile_present,
        )
      try:
        expected_profile = build_target_voice_profile(stored_analysis, target_preset)
      except ValueError:
        # Calibration self-heal. A stored analysis written by an OLDER analyzer
        # version can no longer derive a voice target (build_target_voice_profile
        # hard-rejects a version mismatch on purpose), but the raw audio it was
        # derived from is retained — so rebuild the analysis in place with the
        # current calibration instead of stranding the clip. Only a genuine
        # VERSION mismatch is retried: a current-version analysis that was
        # rejected on quality grounds is rejected again unchanged, because
        # re-running the same DSP over the same audio cannot change that answer.
        stale_version = str(stored_analysis.analysisVersion or '')
        refreshed_analysis = (
          reference_analyzer.reanalyze_stored(reference_clip_id)
          if stale_version != VOICE_ANALYSIS_VERSION
          else None
        )
        refreshed_profile = None
        if refreshed_analysis is not None:
          try:
            refreshed_profile = build_target_voice_profile(
              refreshed_analysis, target_preset
            )
          except ValueError:
            refreshed_profile = None
        if refreshed_profile is None:
          # Self-heal impossible (raw audio gone, re-analysis failed, or the
          # fresh analysis is still not trustworthy) — reject EXACTLY as before.
          logger.warning(
            'event=voice_session_start_rejected '
            'reason=rejected_reference_analysis target_source=%s '
            'reference_present=%s profile_present=%s',
            _target_source_telemetry(target_source),
            reference_present,
            profile_present,
          )
          raise
        logger.info(
          'event=voice_reference_reanalyzed clip_id=%s from_version=%s '
          'to_version=%s',
          reference_clip_id,
          stale_version,
          refreshed_analysis.analysisVersion,
        )
        stored_analysis = refreshed_analysis
        expected_profile = refreshed_profile
      if (
        target_voice_profile is not None
        and not _reference_profile_matches(target_voice_profile, expected_profile)
      ):
        _reject_session_start(
          'reference_profile_mismatch',
          'Reference target profile does not match the stored reference analysis.',
          target_source=target_source,
          reference_present=reference_present,
          profile_present=profile_present,
        )
      # Persist and score with the server-derived profile even when the caller
      # supplied the same exact bands. This prevents unverified auxiliary
      # fields (advanced bands, prompts, or compatibility metrics) from
      # becoming part of the active target.
      target_voice_profile = expected_profile
    elif target_source in CUSTOM_TARGET_SOURCES:
      if target_voice_profile is None:
        _reject_session_start(
          'missing_custom_profile',
          'Custom target requires a target voice profile.',
          target_source=target_source,
          reference_present=reference_present,
          profile_present=profile_present,
        )
      if reference_clip_id is not None:
        _reject_session_start(
          'conflicting_reference_clip',
          'Custom target cannot include a reference clip.',
          target_source=target_source,
          reference_present=reference_present,
          profile_present=profile_present,
        )
    elif target_voice_profile is not None or reference_clip_id is not None:
      _reject_session_start(
        'conflicting_target_payload',
        'Built-in target cannot include a custom profile or reference clip.',
        target_source=target_source,
        reference_present=reference_present,
        profile_present=profile_present,
      )

    if (
      target_voice_profile is not None
      and target_voice_profile.targetPreset != target_preset
    ):
      _reject_session_start(
        'target_preset_mismatch',
        'Target profile preset does not match requested target preset.',
        target_source=target_source,
        reference_present=reference_present,
        profile_present=profile_present,
      )

    voice_session_id = uuid.uuid4().hex
    session = VoiceSessionState(
      voiceSessionId=voice_session_id,
      sloaneSessionId=request.sloaneSessionId,
      targetPreset=target_preset,
      referenceClipId=reference_clip_id,
      targetVoiceProfile=target_voice_profile,
      targetSource=target_source,
      lessonId=request.lessonId,
      memoryEnabled=request.memoryEnabled,
      status='ready',
      streamUrl=self._stream_url(voice_session_id),
      createdAt=_iso_now(),
    )
    self._frame_index[voice_session_id] = 0
    self._sample_offset[voice_session_id] = 0
    voice_storage.clear_session_frames(voice_session_id)
    voice_storage.clear_session_audio(voice_session_id)
    return voice_storage.save_session(session)

  def get_session(self, voice_session_id: str) -> VoiceSessionState | None:
    return voice_storage.get_session(voice_session_id)

  def register_frame(self, voice_session_id: str, payload: bytes | bytearray | memoryview | None) -> VoiceFrame | None:
    lock = self._lock_for_session(voice_session_id)
    with lock:
      session = self.get_session(voice_session_id)
      if session is None:
        return None

      if session.status == 'ended':
        raise VoiceSessionEndedError(f'Voice session "{voice_session_id}" has ended')

      raw_payload = bytes(payload or b'')
      samples = pcm16_bytes_to_float_samples(raw_payload)

      current_index = self._frame_index.get(voice_session_id, session.frameCount)
      cached_offset = self._sample_offset.get(voice_session_id)
      if cached_offset is None:
        # Cold start (process restart / cache eviction mid-session): reconstruct
        # from the authoritative count of PCM samples already written, not
        # lastFrame.t (which is the START of the last frame — one frame behind
        # the true write position, so it would duplicate a timestamp).
        existing_audio = voice_storage.get_session_audio_bytes(voice_session_id)
        cached_offset = (len(existing_audio) // 2) if existing_audio else 0
      sample_offset = cached_offset
      time_ms = int(round(sample_offset * 1000 / SAMPLE_RATE))
      raw_frame = analyze_pcm_frame(
        samples,
        session.targetPreset,
        time_ms,
        SAMPLE_RATE,
        target_voice_profile=session.targetVoiceProfile,
        target_source=session.targetSource,
      )
      frame = smooth_live_frame(session.lastFrame, raw_frame)

      index = current_index + 1
      self._frame_index[voice_session_id] = index
      self._sample_offset[voice_session_id] = sample_offset + int(samples.size)

      # Keep the session timeline windowed for live UI/streaming, but retain full history separately
      # so summaries reflect the full take, not just the last window.
      next_timeline = [*session.timeline, frame][-LIVE_TIMELINE_WINDOW_FRAMES:]
      updated = clone_model(session, {
        'status': 'active',
        'frameCount': index,
        'lastFrame': frame,
        'timeline': next_timeline,
      })
      # Frame log + PCM are append-only and written every frame (cheap); the full
      # session JSON is flushed only every SESSION_PERSIST_INTERVAL_FRAMES frames
      # to avoid an O(n) rewrite of the whole session at ~16 fps. Otherwise just
      # update the cache, which get_session reads first.
      voice_storage.append_session_frame(voice_session_id, frame)
      voice_storage.append_session_audio(voice_session_id, raw_payload)
      if index % SESSION_PERSIST_INTERVAL_FRAMES == 0:
        voice_storage.save_session(updated)
      else:
        voice_storage.cache_session(updated)
      return frame

  def summarize_session(self, voice_session_id: str) -> VoiceAttemptSummary | None:
    session = self.get_session(voice_session_id)
    if session is None:
      return None

    if session.status == 'ended' and session.summary is not None:
      return session.summary

    if session.frameCount == 0 and session.summary is not None:
      # After a take is finalized, the session is reset but the last summary is still useful.
      return session.summary

    frames = voice_storage.get_session_frames(voice_session_id) or (session.timeline or [])
    raw_audio = voice_storage.get_session_audio_bytes(voice_session_id)
    return self._build_summary_from_frames(session, frames, raw_audio)

  def _build_summary_from_frames(
    self,
    session: VoiceSessionState,
    frames: list[VoiceFrame],
    raw_audio: bytes | bytearray | memoryview | None,
    analysis_profile: str = 'standard',
  ) -> VoiceAttemptSummary:
    raw_samples = pcm16_bytes_to_float_samples(raw_audio) if raw_audio else None
    duration_ms = int((frames[-1].t + round((LIVE_FRAME_SIZE / SAMPLE_RATE) * 1000))) if frames else 0
    reference_analysis = voice_storage.get_reference(session.referenceClipId) if session.referenceClipId else None
    return build_attempt_summary(
      voice_session_id=session.voiceSessionId,
      target_preset=session.targetPreset,
      timeline=frames,
      duration_ms=duration_ms,
      reference_analysis=reference_analysis,
      raw_samples=raw_samples,
      sample_rate=SAMPLE_RATE,
      analysis_profile=analysis_profile,
      target_voice_profile=session.targetVoiceProfile,
      target_source=session.targetSource,
    )

  def _finalize_attempt_artifact(
    self,
    session: VoiceSessionState,
    action: str,
    reason: str | None = None,
    client_attempt_id: str | None = None,
    rep_context: VoiceRepContext | None = None,
    self_report: VoiceSelfReport | None = None,
    analysis_profile: str = 'standard',
  ) -> tuple[VoiceAttemptSummary, VoiceAttemptArtifact]:
    frames = voice_storage.get_session_frames(session.voiceSessionId) or (session.timeline or [])
    raw_audio = voice_storage.get_session_audio_bytes(session.voiceSessionId)
    if frames or session.frameCount > 0 or session.summary is None:
      summary = self._build_summary_from_frames(
        session, frames, raw_audio, analysis_profile=analysis_profile
      )
    else:
      summary = session.summary

    if (
      not frames
      and session.frameCount == 0
      and session.attemptArtifact is not None
      and client_attempt_id is None
      and rep_context is None
      and self_report is None
    ):
      return summary, session.attemptArtifact

    sampled_timeline = _sample_attempt_timeline(frames)
    reliability_flags = []
    if summary.metrics.advanced is not None:
      reliability_flags = list(summary.metrics.advanced.reliabilityFlags or [])

    finalized_at = _iso_now()
    attempt_artifact_id = f'{session.voiceSessionId}-{uuid.uuid4().hex}'

    # Replay retention: persist THIS take's PCM as a real WAV before the caller
    # clears session_audio. `raw_audio` is exactly the current take's audio — the
    # session PCM file is cleared at every take boundary (start_session /
    # finalize_take / end_session), so what has accumulated since the last reset IS
    # one take. Per-session ring of the last 20 attempt WAVs is enforced inside
    # save_attempt_audio. Best-effort: never let retention break finalization.
    includes_raw_audio = False
    if raw_audio:
      try:
        saved_path = voice_storage.save_attempt_audio(
          session.voiceSessionId,
          attempt_artifact_id,
          raw_audio,
          SAMPLE_RATE,
        )
        includes_raw_audio = saved_path is not None
      except Exception:  # noqa: BLE001 - retention is non-critical
        includes_raw_audio = False

    artifact = VoiceAttemptArtifact(
      attemptArtifactId=attempt_artifact_id,
      clientAttemptId=_clip_text(client_attempt_id, 160),
      voiceSessionId=session.voiceSessionId,
      sloaneSessionId=session.sloaneSessionId,
      lessonId=session.lessonId,
      targetPreset=session.targetPreset,
      target=summary.target,
      referenceClipId=session.referenceClipId,
      finalizationAction=action,
      finalizationReason=_clip_text(reason, 240),
      sessionCreatedAt=session.createdAt,
      createdAt=finalized_at,
      finalizedAt=finalized_at,
      durationMs=summary.durationMs,
      frameCount=len(frames),
      timelineFrameCount=len(frames),
      timelineSampledFrameCount=len(sampled_timeline),
      timelineCompression=_timeline_compression_label(len(frames), len(sampled_timeline)),
      timeline=sampled_timeline,
      metrics=summary.metrics,
      reliabilityFlags=reliability_flags,
      issues=list(summary.issues),
      nextDrills=list(summary.nextDrills),
      transcript=summary.transcript,
      repContext=_bounded_rep_context(rep_context),
      selfReport=_bounded_self_report(self_report),
      includesRawAudio=includes_raw_audio,
      analysisVersion=summary.analysisVersion,
    )
    voice_storage.save_attempt_artifact(artifact)
    return summary, artifact

  def end_session(
    self,
    voice_session_id: str,
    reason: str = 'manual end',
    reference_clip_id: str | None = None,
    sloane_session_id: str | None = None,
    client_attempt_id: str | None = None,
    rep_context: VoiceRepContext | None = None,
    self_report: VoiceSelfReport | None = None,
    analysis_profile: str = 'standard',
  ) -> VoiceSessionState | None:
    lock = self._lock_for_session(voice_session_id)
    with lock:
      session = self.get_session(voice_session_id)
      if session is None:
        return None

      session_updates: dict[str, Any] = {}
      if reference_clip_id is not None and reference_clip_id != session.referenceClipId:
        session_updates['referenceClipId'] = reference_clip_id
      if sloane_session_id and sloane_session_id != session.sloaneSessionId:
        session_updates['sloaneSessionId'] = sloane_session_id
      if session_updates:
        session = voice_storage.save_session(clone_model(session, session_updates))

      summary, artifact = self._finalize_attempt_artifact(
        session,
        action='end',
        reason=reason,
        client_attempt_id=client_attempt_id,
        rep_context=rep_context,
        self_report=self_report,
        analysis_profile=analysis_profile,
      )
      updated = voice_storage.update_session(
        voice_session_id,
        status='ended',
        endedAt=_iso_now(),
        summary=summary,
        attemptArtifact=artifact,
      )
      self._frame_index.pop(voice_session_id, None)
      self._sample_offset.pop(voice_session_id, None)
      voice_storage.clear_session_frames(voice_session_id)
      voice_storage.clear_session_audio(voice_session_id)
      return updated

  def finalize_take(
    self,
    voice_session_id: str,
    reference_clip_id: str | None = None,
    reason: str | None = None,
    sloane_session_id: str | None = None,
    client_attempt_id: str | None = None,
    rep_context: VoiceRepContext | None = None,
    self_report: VoiceSelfReport | None = None,
    analysis_profile: str = 'standard',
  ) -> VoiceSessionState | None:
    lock = self._lock_for_session(voice_session_id)
    with lock:
      session = self.get_session(voice_session_id)
      if session is None:
        return None

      session_updates: dict[str, Any] = {}
      if reference_clip_id is not None and reference_clip_id != session.referenceClipId:
        session_updates['referenceClipId'] = reference_clip_id
      if sloane_session_id and sloane_session_id != session.sloaneSessionId:
        session_updates['sloaneSessionId'] = sloane_session_id
      if session_updates:
        session = voice_storage.save_session(clone_model(session, session_updates))

      summary, artifact = self._finalize_attempt_artifact(
        session,
        action='take',
        reason=reason,
        client_attempt_id=client_attempt_id,
        rep_context=rep_context,
        self_report=self_report,
        analysis_profile=analysis_profile,
      )
      updated = voice_storage.update_session(
        voice_session_id,
        status='ready',
        endedAt=None,
        frameCount=0,
        lastFrame=None,
        timeline=[],
        summary=summary,
        attemptArtifact=artifact,
      )
      self._frame_index[voice_session_id] = 0
      self._sample_offset[voice_session_id] = 0
      voice_storage.clear_session_frames(voice_session_id)
      voice_storage.clear_session_audio(voice_session_id)
      return updated

  def analyze_take_oneshot(
    self,
    voice_session_id: str,
    pcm16: bytes | bytearray | memoryview,
    reference_clip_id: str | None = None,
    reason: str | None = None,
    sloane_session_id: str | None = None,
    client_attempt_id: str | None = None,
    rep_context: VoiceRepContext | None = None,
    self_report: VoiceSelfReport | None = None,
    analysis_profile: str = 'standard',
    take_kind: str | None = None,
  ) -> VoiceSessionState | None:
    """Score a whole take handed over in ONE buffer.

    NOT a second scoring path. This walks the caller's PCM through the SAME
    `register_frame` -> `finalize_take` pair the WebSocket uses, re-framed by
    the SAME rule as `stream_voice_session` in api/routers/sessions.py:

        frame_bytes = LIVE_FRAME_SIZE * 2
        while len(buffer) >= frame_bytes: register one frame, drop it

    so the resulting attempt artifact, summary, quality, retention WAV and
    per-take side effects are identical to a streamed take of the same audio.
    Note LIVE_FRAME_SIZE (1024), NOT ANALYSIS_FRAME_SIZE (480): 1024 is what
    the live socket actually registers, and identity is the whole point.

    A trailing partial frame is DISCARDED, exactly as the socket discards the
    remainder still sitting in its buffer when the client goes away. Feeding it
    as a short frame would make the one-shot timeline one frame longer than the
    streamed one for the same audio.

    Returns the post-take session (as `finalize_take` does), or None when the
    session is unknown. Raises VoiceStreamBusyError when a live stream owns the
    session, VoiceSessionEndedError when the session has ended.
    """
    session = self.get_session(voice_session_id)
    if session is None:
      return None
    # An ENDED session must stay ended. register_frame raises for it, but only
    # once a whole frame exists: a payload shorter than one frame registers
    # nothing, falls straight through to finalize_take, and RESURRECTS the
    # session (status ended -> ready, endedAt -> None). Harmless on the streamed
    # /take route, which a learner only reaches deliberately; not harmless here,
    # where this runs automatically on every coach turn and the gateway keeps
    # voiceState.voiceSessionId after an end.
    if session.status == 'ended':
      raise VoiceSessionEndedError(f'Voice session "{voice_session_id}" has ended')

    resolved_rep_context = rep_context
    normalized_kind = str(take_kind or '').strip() or None
    if normalized_kind:
      if resolved_rep_context is None:
        resolved_rep_context = VoiceRepContext(kind=normalized_kind)
      elif not str(resolved_rep_context.kind or '').strip():
        resolved_rep_context = resolved_rep_context.model_copy(
          update={'kind': normalized_kind}
        )

    # Claim the single active streaming slot so a one-shot and a live socket can
    # never interleave into one shared sample_offset / PCM file.
    if not self.acquire_stream(voice_session_id):
      raise VoiceStreamBusyError(
        f'Voice session "{voice_session_id}" already has an active stream.'
      )
    try:
      payload = bytes(pcm16 or b'')
      frame_bytes = int(LIVE_FRAME_SIZE * 2)
      offset = 0
      while len(payload) - offset >= frame_bytes:
        frame = self.register_frame(
          voice_session_id, payload[offset:offset + frame_bytes]
        )
        if frame is None:
          # Session vanished mid-take (ended and cleared by another caller).
          return None
        offset += frame_bytes
      return self.finalize_take(
        voice_session_id,
        reference_clip_id,
        reason=reason,
        sloane_session_id=sloane_session_id,
        client_attempt_id=client_attempt_id,
        rep_context=resolved_rep_context,
        self_report=self_report,
        analysis_profile=analysis_profile,
      )
    finally:
      self.release_stream(voice_session_id)


streaming_analyzer = StreamingAnalyzer()
