from __future__ import annotations

from datetime import datetime, timezone
import io
import json
import os
from pathlib import Path
import re
import threading
from typing import Any
import uuid
import wave

from src.config import settings
from src.services.contracts import (
  ReferenceAnalysisResponse,
  VoiceAttemptArtifact,
  VoiceCustomTargetPreset,
  VoiceFrame,
  VoiceSessionState,
  VoiceTargetProfile,
  sanitize_non_finite,
)


def model_to_dict(model: Any) -> dict[str, Any]:
  # Sanitize here so the HTTP/coaching path (routers return model_to_dict),
  # persistence and the dataset export all get finite values from one chokepoint.
  if hasattr(model, 'model_dump'):
    return sanitize_non_finite(model.model_dump())
  return sanitize_non_finite(model.dict())


def clone_model(model: Any, updates: dict[str, Any]):
  if hasattr(model, 'model_copy'):
    return model.model_copy(update=updates)
  return model.copy(update=updates)


def _iso_now() -> str:
  # Matches streaming_analyzer._iso_now (UTC ISO-8601, Z suffix). Defined locally
  # so storage has no import cycle back into the analyzer.
  return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


class VoiceStorage:
  def __init__(self, root: Path):
    self.root = root
    self.sessions_dir = root / 'sessions'
    self.session_frames_dir = root / 'session_frames'
    self.session_audio_dir = root / 'session_audio'
    self.custom_presets_dir = root / 'custom_presets'
    self.references_raw_dir = root / 'references' / 'raw'
    self.references_analysis_dir = root / 'references' / 'analysis'
    self.attempts_raw_dir = root / 'attempts' / 'raw'
    # V1.5 time-lapse mirror: pinned milestone takes, per student. A pin promotes
    # an attempt's retained WAV (+ a metrics/timeline snapshot) to permanent
    # storage here, surviving the attempts/raw ring eviction.
    self.milestones_dir = root / 'milestones'
    self.target_profiles_dir = root / 'target_profiles'
    self.summaries_dir = root / 'summaries'
    self.attempt_artifacts_dir = root / 'attempt_artifacts'
    self._sessions: dict[str, VoiceSessionState] = {}
    self._attempt_artifacts: dict[str, VoiceAttemptArtifact] = {}
    self._custom_presets: dict[str, VoiceCustomTargetPreset] = {}
    self._references: dict[str, ReferenceAnalysisResponse] = {}
    self._target_profiles: dict[str, VoiceTargetProfile] = {}
    self._file_locks: dict[Path, threading.Lock] = {}
    self._file_locks_guard = threading.Lock()
    self._ensure_dirs()

  def _ensure_dirs(self) -> None:
    for path in (
      self.root,
      self.sessions_dir,
      self.session_frames_dir,
      self.session_audio_dir,
      self.custom_presets_dir,
      self.references_raw_dir,
      self.references_analysis_dir,
      self.attempts_raw_dir,
      self.milestones_dir,
      self.target_profiles_dir,
      self.summaries_dir,
      self.attempt_artifacts_dir,
    ):
      path.mkdir(parents=True, exist_ok=True)

  def _lock_for(self, path: Path) -> threading.Lock:
    with self._file_locks_guard:
      lock = self._file_locks.get(path)
      if lock is None:
        lock = threading.Lock()
        self._file_locks[path] = lock
      return lock

  def _write_json(self, path: Path, payload: dict[str, Any]) -> None:
    lock = self._lock_for(path)
    tmp_path = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    serialized = json.dumps(sanitize_non_finite(payload), indent=2, allow_nan=False)
    with lock:
      try:
        with open(tmp_path, 'w', encoding='utf-8') as handle:
          handle.write(serialized)
          handle.flush()
          if getattr(settings, 'durable_writes', False):
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
      finally:
        try:
          if tmp_path.exists():
            tmp_path.unlink()
        except FileNotFoundError:
          pass

  def _read_json(self, path: Path) -> dict[str, Any] | None:
    if not path.exists():
      return None
    try:
      payload = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
      return None
    return payload if isinstance(payload, dict) else None

  def _session_frames_path(self, voice_session_id: str) -> Path:
    return self.session_frames_dir / f'{voice_session_id}.jsonl'

  def _session_audio_path(self, voice_session_id: str) -> Path:
    return self.session_audio_dir / f'{voice_session_id}.pcm16'

  def _custom_preset_path(self, preset_id: str) -> Path:
    return self.custom_presets_dir / f'{preset_id}.json'

  def _attempt_artifact_path(self, attempt_artifact_id: str) -> Path:
    safe_id = re.sub(r'[^A-Za-z0-9_.-]+', '_', str(attempt_artifact_id or '')).strip('._')
    return self.attempt_artifacts_dir / f'{safe_id or "unknown"}.json'

  def append_session_frame(self, voice_session_id: str, frame: VoiceFrame) -> None:
    path = self._session_frames_path(voice_session_id)
    lock = self._lock_for(path)
    line = json.dumps(
      sanitize_non_finite(model_to_dict(frame)), separators=(',', ':'), allow_nan=False
    )
    with lock:
      with open(path, 'a', encoding='utf-8') as handle:
        handle.write(line)
        handle.write('\n')
        handle.flush()

  def append_session_audio(self, voice_session_id: str, raw_audio: bytes | bytearray | memoryview | None) -> None:
    payload = bytes(raw_audio or b'')
    if not payload:
      return
    path = self._session_audio_path(voice_session_id)
    lock = self._lock_for(path)
    with lock:
      with open(path, 'ab') as handle:
        handle.write(payload)
        handle.flush()

  def get_session_audio_bytes(self, voice_session_id: str) -> bytes:
    path = self._session_audio_path(voice_session_id)
    if not path.exists():
      return b''
    lock = self._lock_for(path)
    with lock:
      return path.read_bytes()

  def get_session_frames(self, voice_session_id: str) -> list[VoiceFrame]:
    path = self._session_frames_path(voice_session_id)
    if not path.exists():
      return []

    lock = self._lock_for(path)
    with lock:
      raw_lines = path.read_text(encoding='utf-8', errors='ignore').splitlines()

    frames: list[VoiceFrame] = []
    for line in raw_lines:
      if not line.strip():
        continue
      try:
        payload = json.loads(line)
        frames.append(VoiceFrame(**payload))
      except Exception:
        # Ignore truncated/corrupt tail lines (e.g. process crash mid-write).
        continue
    return frames

  def clear_session_frames(self, voice_session_id: str) -> None:
    path = self._session_frames_path(voice_session_id)
    lock = self._lock_for(path)
    with lock:
      try:
        path.unlink()
      except FileNotFoundError:
        return

  def clear_session_audio(self, voice_session_id: str) -> None:
    path = self._session_audio_path(voice_session_id)
    lock = self._lock_for(path)
    with lock:
      try:
        path.unlink()
      except FileNotFoundError:
        return

  def cache_session(self, session: VoiceSessionState) -> VoiceSessionState:
    """Update the in-memory session cache WITHOUT writing to disk.

    get_session is cache-first, so concurrent live reads see the latest state;
    the full session JSON is flushed to disk only periodically (see
    StreamingAnalyzer.register_frame), avoiding an O(n) rewrite of the whole
    session on every frame. The full take is preserved by the append-only frame
    log + PCM, so a crash between flushes loses at most the session snapshot."""
    self._sessions[session.voiceSessionId] = session
    return session

  def save_session(self, session: VoiceSessionState) -> VoiceSessionState:
    self._sessions[session.voiceSessionId] = session
    self._write_json(self.sessions_dir / f'{session.voiceSessionId}.json', model_to_dict(session))
    if session.summary is not None:
      self._write_json(self.summaries_dir / f'{session.voiceSessionId}.json', model_to_dict(session.summary))
    if session.attemptArtifact is not None:
      self.save_attempt_artifact(session.attemptArtifact)
    return session

  def get_session(self, voice_session_id: str) -> VoiceSessionState | None:
    if voice_session_id in self._sessions:
      return self._sessions[voice_session_id]

    raw = self._read_json(self.sessions_dir / f'{voice_session_id}.json')
    if raw is None:
      return None

    session = VoiceSessionState(**raw)
    self._sessions[voice_session_id] = session
    return session

  def update_session(self, voice_session_id: str, **updates: Any) -> VoiceSessionState | None:
    session = self.get_session(voice_session_id)
    if session is None:
      return None

    next_session = clone_model(session, updates)
    return self.save_session(next_session)

  def save_attempt_artifact(self, artifact: VoiceAttemptArtifact) -> VoiceAttemptArtifact:
    self._attempt_artifacts[artifact.attemptArtifactId] = artifact
    self._write_json(self._attempt_artifact_path(artifact.attemptArtifactId), model_to_dict(artifact))
    return artifact

  def get_attempt_artifact(self, attempt_artifact_id: str) -> VoiceAttemptArtifact | None:
    if attempt_artifact_id in self._attempt_artifacts:
      return self._attempt_artifacts[attempt_artifact_id]

    raw = self._read_json(self._attempt_artifact_path(attempt_artifact_id))
    if raw is None:
      return None

    try:
      artifact = VoiceAttemptArtifact(**raw)
    except Exception:
      return None
    self._attempt_artifacts[attempt_artifact_id] = artifact
    return artifact

  def list_attempt_artifacts_for_session(self, voice_session_id: str) -> list[VoiceAttemptArtifact]:
    artifacts: list[VoiceAttemptArtifact] = []
    for path in sorted(self.attempt_artifacts_dir.glob(f'{voice_session_id}-*.json')):
      artifact = self._attempt_artifacts.get(path.stem)
      if artifact is None:
        raw = self._read_json(path)
        if raw is None:
          continue
        try:
          artifact = VoiceAttemptArtifact(**raw)
        except Exception:
          continue
        self._attempt_artifacts[artifact.attemptArtifactId] = artifact
      artifacts.append(artifact)
    return artifacts

  def save_reference(self, analysis: ReferenceAnalysisResponse) -> ReferenceAnalysisResponse:
    self._references[analysis.clipId] = analysis
    self._write_json(self.references_analysis_dir / f'{analysis.clipId}.json', model_to_dict(analysis))
    return analysis

  def save_custom_preset(self, preset: VoiceCustomTargetPreset) -> VoiceCustomTargetPreset:
    self._write_json(self._custom_preset_path(preset.id), model_to_dict(preset))
    self._custom_presets[preset.id] = preset
    return preset

  def get_custom_preset(self, preset_id: str) -> VoiceCustomTargetPreset | None:
    if preset_id in self._custom_presets:
      return self._custom_presets[preset_id]

    raw = self._read_json(self._custom_preset_path(preset_id))
    if raw is None:
      return None

    try:
      preset = VoiceCustomTargetPreset(**raw)
    except Exception:
      return None
    self._custom_presets[preset_id] = preset
    return preset

  def list_custom_presets(self) -> list[VoiceCustomTargetPreset]:
    presets: list[VoiceCustomTargetPreset] = []
    for path in sorted(self.custom_presets_dir.glob('*.json')):
      preset_id = path.stem
      preset = self._custom_presets.get(preset_id)
      if preset is None:
        raw = self._read_json(path)
        if raw is None:
          continue
        try:
          preset = VoiceCustomTargetPreset(**raw)
        except Exception:
          continue
        self._custom_presets[preset_id] = preset
      presets.append(preset)
    return presets

  def delete_custom_preset(self, preset_id: str) -> VoiceCustomTargetPreset | None:
    preset = self.get_custom_preset(preset_id)
    if preset is None:
      return None

    self._custom_presets.pop(preset_id, None)
    path = self._custom_preset_path(preset_id)
    lock = self._lock_for(path)
    with lock:
      try:
        path.unlink()
      except FileNotFoundError:
        pass
    return preset

  def get_reference(self, clip_id: str) -> ReferenceAnalysisResponse | None:
    if clip_id in self._references:
      return self._references[clip_id]

    raw = self._read_json(self.references_analysis_dir / f'{clip_id}.json')
    if raw is None:
      return None

    analysis = ReferenceAnalysisResponse(**raw)
    self._references[clip_id] = analysis
    return analysis

  def get_reference_file_path(self, clip_id: str) -> Path | None:
    if not re.fullmatch(r'[A-Fa-f0-9]{32}', str(clip_id or '')):
      return None
    matches = sorted(self.references_raw_dir.glob(f'{clip_id}_*'))
    if not matches:
      return None
    return matches[0]

  def store_reference_file(self, clip_id: str, filename: str, data: bytes) -> Path:
    # Validate clip_id on the write path too (the read path already does): an
    # unsanitized clip_id like '../../x' would escape references_raw_dir.
    if not re.fullmatch(r'[A-Fa-f0-9]{32}', str(clip_id or '')):
      raise ValueError('Invalid reference clip id')
    safe_name = ''.join(char if char.isalnum() or char in {'.', '-', '_'} else '_' for char in filename) or f'{clip_id}.bin'
    path = self.references_raw_dir / f'{clip_id}_{safe_name}'
    tmp_path = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    lock = self._lock_for(path)
    with lock:
      try:
        with open(tmp_path, 'wb') as handle:
          handle.write(data)
          handle.flush()
          if getattr(settings, 'durable_writes', False):
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
      finally:
        try:
          if tmp_path.exists():
            tmp_path.unlink()
        except FileNotFoundError:
          pass
    return path

  # ----- Attempt audio (replay) -----

  @staticmethod
  def _safe_attempt_id(attempt_id: str) -> str:
    # Attempt artifact ids are "{voiceSessionId(32hex)}-{uuid(32hex)}"; sanitize
    # defensively so an id can never escape attempts_raw_dir via path traversal.
    return re.sub(r'[^A-Za-z0-9_.-]+', '_', str(attempt_id or '')).strip('._')

  def _attempt_audio_path(self, attempt_id: str) -> Path:
    safe_id = self._safe_attempt_id(attempt_id)
    return self.attempts_raw_dir / f'{safe_id or "unknown"}.wav'

  @staticmethod
  def _pcm16_to_wav_bytes(pcm_bytes: bytes, sample_rate: int, channels: int = 1) -> bytes:
    # Wrap raw little-endian PCM16 mono samples in a correct RIFF/WAVE container.
    # An odd trailing byte (split sample) is dropped so frame alignment holds.
    payload = bytes(pcm_bytes or b'')
    if len(payload) % 2 == 1:
      payload = payload[:-1]
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav:
      wav.setnchannels(max(1, int(channels)))
      wav.setsampwidth(2)  # PCM16 -> 2 bytes/sample
      wav.setframerate(int(sample_rate) if sample_rate else 16000)
      wav.writeframes(payload)
    return buffer.getvalue()

  def save_attempt_audio(
    self,
    voice_session_id: str,
    attempt_id: str,
    pcm_bytes: bytes | bytearray | memoryview | None,
    sample_rate: int,
    *,
    ring_limit: int = 20,
  ) -> Path | None:
    """Persist a finalized take's PCM as a real WAV under attempts/raw/{attemptId}.wav.

    Enforces a per-session ring of the last `ring_limit` attempt WAVs (deletes the
    oldest by mtime). Returns the written path, or None when there is no audio.
    Best-effort and isolated: a failure here must never break take finalization.
    """
    payload = bytes(pcm_bytes or b'')
    if not payload:
      return None
    wav_bytes = self._pcm16_to_wav_bytes(payload, sample_rate)
    path = self._attempt_audio_path(attempt_id)
    tmp_path = path.with_name(f'.{path.name}.{uuid.uuid4().hex}.tmp')
    lock = self._lock_for(path)
    with lock:
      try:
        with open(tmp_path, 'wb') as handle:
          handle.write(wav_bytes)
          handle.flush()
          if getattr(settings, 'durable_writes', False):
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
      finally:
        try:
          if tmp_path.exists():
            tmp_path.unlink()
        except FileNotFoundError:
          pass

    self._enforce_attempt_audio_ring(voice_session_id, ring_limit)
    return path

  def _enforce_attempt_audio_ring(self, voice_session_id: str, ring_limit: int) -> None:
    # Attempt ids start with the voice_session_id, so the per-session set is the
    # glob "{session}-*.wav". Keep the newest `ring_limit`; unlink the rest.
    safe_session = self._safe_attempt_id(voice_session_id)
    if not safe_session or ring_limit <= 0:
      return
    try:
      wavs = list(self.attempts_raw_dir.glob(f'{safe_session}-*.wav'))
    except OSError:
      return
    if len(wavs) <= ring_limit:
      return
    # Oldest first by mtime; delete everything beyond the ring.
    wavs.sort(key=lambda p: p.stat().st_mtime if p.exists() else 0.0)
    for stale in wavs[:-ring_limit]:
      try:
        stale.unlink()
      except FileNotFoundError:
        pass
      except OSError:
        pass

  def get_attempt_audio(self, attempt_id: str) -> Path | None:
    path = self._attempt_audio_path(attempt_id)
    if not path.exists():
      return None
    return path

  def attempt_audio_count(self) -> int:
    return len(list(self.attempts_raw_dir.glob('*.wav')))

  # ── V1.5 time-lapse mirror: milestone (pinned take) storage ────────────────
  #
  # A milestone is a permanently-kept copy of an attempt's WAV + a small metadata
  # JSON (date, label, attemptId, durationMs, metricsSummary). Pin promotes a take
  # whose audio is still in the attempts/raw retention ring; it is idempotent per
  # attemptId and capped per student (oldest evicted beyond the cap).
  #
  # Layout: milestones/{safeStudentId}/{date}_{attemptId}.wav + .json
  # The id surfaced to clients is the file stem "{date}_{attemptId}" (a stable,
  # path-safe handle that also encodes the student dir via a separate lookup).

  MILESTONE_CAP_PER_STUDENT = 500

  @staticmethod
  def _safe_id_component(value: str) -> str:
    # Sanitize any id component so it can never escape its directory.
    return re.sub(r'[^A-Za-z0-9_.-]+', '_', str(value or '')).strip('._')

  def _milestone_student_dir(self, student_id: str) -> Path:
    safe = self._safe_id_component(student_id) or 'unknown'
    return self.milestones_dir / safe

  def _find_milestone_paths(self, milestone_id: str) -> tuple[Path, Path] | None:
    # A milestone id is the file stem "{date}_{attemptId}". Search all student
    # dirs for the matching .wav (ids are globally unique via the attempt uuid).
    safe_id = self._safe_id_component(milestone_id)
    if not safe_id:
      return None
    try:
      for wav in self.milestones_dir.glob(f'*/{safe_id}.wav'):
        return wav, wav.with_suffix('.json')
    except OSError:
      return None
    return None

  def pin_attempt_as_milestone(
    self,
    student_id: str,
    attempt_id: str,
    *,
    label: str | None = None,
    cap_per_student: int | None = None,
  ) -> dict[str, Any] | None:
    """Promote a retained attempt WAV to a permanent milestone for `student_id`.

    Idempotent per attemptId (re-pinning returns the existing milestone, updating
    its label when one is supplied). Returns the milestone metadata dict, or None
    when the attempt's audio is no longer in the retention ring.
    """
    safe_student = self._safe_id_component(student_id) or 'unknown'
    safe_attempt = self._safe_attempt_id(attempt_id)
    if not safe_attempt:
      return None

    src_wav = self._attempt_audio_path(attempt_id)
    student_dir = self._milestone_student_dir(student_id)

    # Idempotency: if a milestone already exists for this attemptId in this
    # student's dir, return (and optionally relabel) it without re-copying.
    existing = None
    try:
      for wav in student_dir.glob(f'*_{safe_attempt}.wav'):
        existing = wav
        break
    except OSError:
      existing = None
    if existing is not None:
      meta_path = existing.with_suffix('.json')
      meta = self._read_json(meta_path) or {}
      if label is not None:
        meta['label'] = str(label)[:120]
        self._write_json(meta_path, meta)
      return meta or self._milestone_meta_from_stem(existing.stem, student_id)

    if not src_wav.exists():
      # Audio has aged out of the ring — cannot pin (the contract: pin works only
      # for attempts whose audio is still retained).
      return None

    student_dir.mkdir(parents=True, exist_ok=True)
    date_str = _iso_now()[:10]  # YYYY-MM-DD
    milestone_id = f'{date_str}_{safe_attempt}'
    dst_wav = student_dir / f'{milestone_id}.wav'
    dst_json = student_dir / f'{milestone_id}.json'

    # Copy the WAV bytes (atomic temp+rename), then write the metadata snapshot.
    lock = self._lock_for(dst_wav)
    tmp_path = dst_wav.with_name(f'.{dst_wav.name}.{uuid.uuid4().hex}.tmp')
    with lock:
      try:
        data = src_wav.read_bytes()
        with open(tmp_path, 'wb') as handle:
          handle.write(data)
          handle.flush()
          if getattr(settings, 'durable_writes', False):
            os.fsync(handle.fileno())
        os.replace(tmp_path, dst_wav)
      except OSError:
        try:
          if tmp_path.exists():
            tmp_path.unlink()
        except FileNotFoundError:
          pass
        return None

    # Build the metrics snapshot from the attempt artifact (best-effort).
    artifact = self.get_attempt_artifact(attempt_id)
    duration_ms = 0
    metrics_summary: dict[str, Any] = {}
    timeline_snapshot: list[Any] = []
    if artifact is not None:
      duration_ms = int(getattr(artifact, 'durationMs', 0) or 0)
      metrics = getattr(artifact, 'metrics', None)
      if metrics is not None:
        mean_pitch = getattr(metrics, 'meanPitchHz', None)
        resonance = getattr(metrics, 'resonanceMean', None)
        target_hit = getattr(metrics, 'targetHitPct', None)
        metrics_summary = {
          'meanPitchHz': mean_pitch,
          'resonance': resonance,
          # heldRatio: fraction of voiced timeline frames at/above a hold score.
          'heldRatio': self._compute_held_ratio(getattr(artifact, 'timeline', None)),
          'targetHitPct': target_hit,
        }
      timeline = getattr(artifact, 'timeline', None)
      if isinstance(timeline, list):
        timeline_snapshot = [model_to_dict(f) for f in timeline]

    meta = {
      'id': milestone_id,
      'studentId': safe_student,
      'date': date_str,
      'label': (str(label)[:120] if label is not None else None),
      'attemptId': safe_attempt,
      'durationMs': duration_ms,
      'metricsSummary': metrics_summary,
      'timeline': timeline_snapshot,
      'createdAt': _iso_now(),
    }
    self._write_json(dst_json, meta)

    # Enforce the per-student cap (oldest evicted beyond the cap).
    self._enforce_milestone_cap(student_id, cap_per_student or self.MILESTONE_CAP_PER_STUDENT)
    return meta

  @staticmethod
  def _compute_held_ratio(timeline: Any, hold_score: float = 0.6) -> float | None:
    # Fraction of VOICED frames whose pitchScore is at/above hold_score. Mirrors
    # the kernel's held-ratio fallback so the milestone summary is consistent.
    if not isinstance(timeline, list) or not timeline:
      return None
    voiced = 0
    held = 0
    for frame in timeline:
      is_voiced = bool(getattr(frame, 'voiced', None))
      score = getattr(frame, 'pitchScore', None)
      if not is_voiced or score is None:
        continue
      voiced += 1
      try:
        if float(score) >= hold_score:
          held += 1
      except (TypeError, ValueError):
        continue
    if voiced == 0:
      return None
    return round(held / voiced, 3)

  def _milestone_meta_from_stem(self, stem: str, student_id: str) -> dict[str, Any]:
    # Reconstruct minimal metadata from a milestone file stem (date_attemptId).
    parts = stem.split('_', 1)
    date_str = parts[0] if parts else ''
    attempt_id = parts[1] if len(parts) > 1 else stem
    return {
      'id': stem,
      'studentId': self._safe_id_component(student_id),
      'date': date_str,
      'label': None,
      'attemptId': attempt_id,
      'durationMs': 0,
      'metricsSummary': {},
    }

  def _enforce_milestone_cap(self, student_id: str, cap: int) -> None:
    student_dir = self._milestone_student_dir(student_id)
    if cap <= 0:
      return
    try:
      wavs = list(student_dir.glob('*.wav'))
    except OSError:
      return
    if len(wavs) <= cap:
      return
    # Oldest first by mtime; delete (wav + json) beyond the cap.
    wavs.sort(key=lambda p: p.stat().st_mtime if p.exists() else 0.0)
    for stale in wavs[:-cap]:
      for path in (stale, stale.with_suffix('.json')):
        try:
          path.unlink()
        except FileNotFoundError:
          pass
        except OSError:
          pass

  def list_milestones(self, student_id: str) -> list[dict[str, Any]]:
    """List a student's milestones, OLDEST FIRST. Each item is the public shape:
    { id, date, label, attemptId, durationMs, metricsSummary }."""
    student_dir = self._milestone_student_dir(student_id)
    try:
      jsons = list(student_dir.glob('*.json'))
    except OSError:
      return []
    jsons.sort(key=lambda p: p.stat().st_mtime if p.exists() else 0.0)
    out: list[dict[str, Any]] = []
    for jp in jsons:
      meta = self._read_json(jp)
      if not isinstance(meta, dict):
        meta = self._milestone_meta_from_stem(jp.stem, student_id)
      out.append({
        'id': meta.get('id') or jp.stem,
        'date': meta.get('date'),
        'label': meta.get('label'),
        'attemptId': meta.get('attemptId'),
        'durationMs': meta.get('durationMs', 0),
        'metricsSummary': meta.get('metricsSummary', {}),
      })
    return out

  def get_milestone_audio(self, milestone_id: str) -> Path | None:
    found = self._find_milestone_paths(milestone_id)
    if found is None:
      return None
    wav_path, _ = found
    return wav_path if wav_path.exists() else None

  def delete_milestone(self, milestone_id: str) -> bool:
    found = self._find_milestone_paths(milestone_id)
    if found is None:
      return False
    wav_path, json_path = found
    deleted = False
    for path in (wav_path, json_path):
      try:
        path.unlink()
        deleted = True
      except FileNotFoundError:
        pass
      except OSError:
        pass
    return deleted

  def milestone_count(self) -> int:
    return len(list(self.milestones_dir.glob('*/*.wav')))

  def save_target_profile(self, profile: VoiceTargetProfile) -> VoiceTargetProfile:
    self._target_profiles[profile.profileId] = profile
    self._write_json(self.target_profiles_dir / f'{profile.profileId}.json', model_to_dict(profile))
    return profile

  def get_target_profile(self, profile_id: str) -> VoiceTargetProfile | None:
    if profile_id in self._target_profiles:
      return self._target_profiles[profile_id]

    raw = self._read_json(self.target_profiles_dir / f'{profile_id}.json')
    if raw is None:
      return None

    profile = VoiceTargetProfile(**raw)
    self._target_profiles[profile_id] = profile
    return profile

  def session_count(self) -> int:
    return len(list(self.sessions_dir.glob('*.json')))

  def reference_count(self) -> int:
    return len(list(self.references_analysis_dir.glob('*.json')))

  def target_profile_count(self) -> int:
    return len(list(self.target_profiles_dir.glob('*.json')))

  def custom_preset_count(self) -> int:
    return len(list(self.custom_presets_dir.glob('*.json')))

  def attempt_artifact_count(self) -> int:
    return len(list(self.attempt_artifacts_dir.glob('*.json')))


voice_storage = VoiceStorage(settings.storage_root)
