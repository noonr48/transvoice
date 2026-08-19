from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import math

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse

from src.config import settings, token_matches
from src.services.contracts import (
  VoiceMilestonePinRequest,
  VoiceSessionEndRequest,
  VoiceSessionStartRequest,
  VoiceSessionState,
  VoiceTakeOneShotRequest,
)
from src.services.audio_analysis import LIVE_FRAME_SIZE
from src.services.streaming_analyzer import (
  ONESHOT_MAX_AUDIO_MS,
  ONESHOT_MAX_PCM_BYTES,
  VoiceSessionEndedError,
  VoiceStreamBusyError,
  streaming_analyzer,
)
from src.services.storage import model_to_dict, voice_storage


logger = logging.getLogger(__name__)

router = APIRouter(prefix='/api/v1/voice/sessions', tags=['voice-sessions'])

# Attempt-audio replay lives under its own prefix so the path matches the kernel
# proxy (GET /api/v1/voice/attempts/{attemptId}/audio) and the design contract.
attempts_router = APIRouter(prefix='/api/v1/voice/attempts', tags=['voice-attempts'])

# V1.5 time-lapse mirror: milestone (pinned take) endpoints. List/audio/delete
# live under /api/v1/voice/milestones; pin lives under the attempts prefix (it
# acts on an attempt id) — see the kernel proxies in voice-standalone-runtime.js.
milestones_router = APIRouter(prefix='/api/v1/voice/milestones', tags=['voice-milestones'])


@attempts_router.get('/{attempt_id}/audio')
async def get_attempt_audio(attempt_id: str):
  wav_path = voice_storage.get_attempt_audio(attempt_id)
  if wav_path is None or not wav_path.exists():
    raise HTTPException(status_code=404, detail='Attempt audio not found')
  return FileResponse(wav_path, media_type='audio/wav', filename=wav_path.name)


@attempts_router.post('/{attempt_id}/pin')
async def pin_attempt_as_milestone(attempt_id: str, payload: VoiceMilestonePinRequest):
  # Promote a retained attempt take to a permanent milestone for the student.
  # Idempotent per attemptId; 404 when the audio has aged out of the ring.
  meta = voice_storage.pin_attempt_as_milestone(
    payload.studentId,
    attempt_id,
    label=payload.label,
  )
  if meta is None:
    raise HTTPException(
      status_code=404,
      detail='Attempt audio is no longer available to pin (aged out of retention).',
    )
  return {
    'id': meta.get('id'),
    'studentId': meta.get('studentId'),
    'date': meta.get('date'),
    'label': meta.get('label'),
    'attemptId': meta.get('attemptId'),
    'durationMs': meta.get('durationMs', 0),
    'metricsSummary': meta.get('metricsSummary', {}),
  }


@milestones_router.get('')
async def list_milestones(studentId: str):
  return voice_storage.list_milestones(studentId)


@milestones_router.get('/{milestone_id}/audio')
async def get_milestone_audio(milestone_id: str):
  wav_path = voice_storage.get_milestone_audio(milestone_id)
  if wav_path is None or not wav_path.exists():
    raise HTTPException(status_code=404, detail='Milestone audio not found')
  return FileResponse(wav_path, media_type='audio/wav', filename=wav_path.name)


@milestones_router.delete('/{milestone_id}')
async def delete_milestone(milestone_id: str):
  deleted = voice_storage.delete_milestone(milestone_id)
  if not deleted:
    raise HTTPException(status_code=404, detail='Milestone not found')
  return {'deleted': True, 'id': milestone_id}


@router.post('/start')
async def start_voice_session(payload: VoiceSessionStartRequest):
  try:
    # start_session is CPU-bound in one case: a reference target whose stored
    # analysis predates the current calibration triggers an in-place
    # re-analysis of the retained clip (seconds of DSP), so run it in a worker
    # thread rather than stalling the event loop for every other in-flight
    # request.
    #
    # Safe off-loop: start_session touches no event loop, and its only shared
    # state is keyed by a freshly generated voice_session_id
    # (_frame_index/_sample_offset are set per new uuid and never iterated),
    # while voice_storage serializes its own writes per path. Note it does NOT
    # take the per-session RLock — that lock guards register_frame and the take
    # boundaries, not this gate.
    session = await asyncio.to_thread(streaming_analyzer.start_session, payload)
  except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc
  return {
    'voiceSessionId': session.voiceSessionId,
    'sloaneSessionId': session.sloaneSessionId,
    'targetPreset': session.targetPreset,
    'referenceClipId': session.referenceClipId,
    'targetSource': session.targetSource,
    'targetProfileId': (
      session.targetVoiceProfile.profileId
      if session.targetVoiceProfile is not None
      else None
    ),
    # The gateway fails a start closed unless the analyzer echoes the
    # calibration the bound target was derived under (its
    # `missing_analysis_version` acknowledgement gate). Echo the version that
    # the ACTIVE profile actually carries — after a self-heal that is the
    # freshly re-stamped one, which is exactly what the gateway must rebind to.
    'analysisVersion': (
      session.targetVoiceProfile.analysisVersion
      if session.targetVoiceProfile is not None
      else None
    ),
    'lessonId': session.lessonId,
    'status': session.status,
    'streamUrl': session.streamUrl,
    'createdAt': session.createdAt,
  }


@router.get('/{voice_session_id}', response_model=VoiceSessionState)
async def get_voice_session(voice_session_id: str):
  session = streaming_analyzer.get_session(voice_session_id)
  if session is None:
    raise HTTPException(status_code=404, detail='Voice session not found')
  return model_to_dict(session)


@router.post('/{voice_session_id}/end')
async def end_voice_session(voice_session_id: str, payload: VoiceSessionEndRequest):
  try:
    session = streaming_analyzer.end_session(
      voice_session_id,
      payload.reason,
      payload.referenceClipId,
      sloane_session_id=payload.sloaneSessionId,
      client_attempt_id=payload.clientAttemptId,
      rep_context=payload.repContext,
      self_report=payload.selfReport,
      analysis_profile=payload.analysisProfile,
    )
  except ValueError as exc:
    # 2026-07-27 MTF-ONLY: the summary build reads the session's STORED preset
    # through get_target_profile, which now raises on a target outside
    # TARGET_PROFILES instead of silently substituting cute-feminine. A corrupt
    # stored row is bad REQUEST data, not a server fault — map it the same way
    # /start and the /target routes already do. Without this the route 500s.
    raise HTTPException(status_code=400, detail=str(exc)) from exc
  if session is None:
    raise HTTPException(status_code=404, detail='Voice session not found')

  return {
    'voiceSessionId': session.voiceSessionId,
    'status': session.status,
    'streamUrl': session.streamUrl,
    'endedAt': session.endedAt,
    'summary': model_to_dict(session.summary) if session.summary is not None else None,
    'attemptArtifact': model_to_dict(session.attemptArtifact) if session.attemptArtifact is not None else None,
  }


@router.post('/{voice_session_id}/take')
async def finalize_voice_take(voice_session_id: str, payload: VoiceSessionEndRequest):
  try:
    session = streaming_analyzer.finalize_take(
      voice_session_id,
      payload.referenceClipId,
      reason=payload.reason,
      sloane_session_id=payload.sloaneSessionId,
      client_attempt_id=payload.clientAttemptId,
      rep_context=payload.repContext,
      self_report=payload.selfReport,
      analysis_profile=payload.analysisProfile,
    )
  except ValueError as exc:
    # Same gate as /end: a stored target outside TARGET_PROFILES is rejected as
    # a 400, never coached against a substituted profile.
    raise HTTPException(status_code=400, detail=str(exc)) from exc
  if session is None:
    raise HTTPException(status_code=404, detail='Voice session not found')

  return _take_finalize_payload(session)


def _take_finalize_payload(session: VoiceSessionState) -> dict:
  # The exact payload shape the streamed `/take` route returns, so a caller can
  # consume either path with one reader.
  return {
    'voiceSessionId': session.voiceSessionId,
    'status': session.status,
    'streamUrl': session.streamUrl,
    'summary': model_to_dict(session.summary) if session.summary is not None else None,
    'attemptArtifact': (
      model_to_dict(session.attemptArtifact)
      if session.attemptArtifact is not None
      else None
    ),
  }


@router.post('/{voice_session_id}/take-oneshot')
async def finalize_voice_take_oneshot(
  voice_session_id: str,
  payload: VoiceTakeOneShotRequest,
):
  """Score a whole take handed over in one request.

  The gateway's coach loop already holds a finished, trimmed 16 kHz PCM16
  segment by the time it reaches the ASR; it has no live socket into this
  service. This route lets that segment become a real take through the SAME
  internals a streamed take uses (see StreamingAnalyzer.analyze_take_oneshot),
  so nothing about the resulting artifact depends on which door the audio came
  through.
  """
  encoded = payload.pcm16Base64 or ''
  # Reject an oversized body BEFORE decoding it: base64 inflates 3 bytes to 4,
  # so the encoded length bounds the decoded length without allocating it.
  if len(encoded) > (math.ceil(ONESHOT_MAX_PCM_BYTES / 3) * 4) + 4:
    raise HTTPException(
      status_code=413,
      detail=f'One-shot take audio exceeds the {ONESHOT_MAX_AUDIO_MS} ms limit.',
    )
  try:
    pcm16 = base64.b64decode(encoded, validate=True)
  except (binascii.Error, ValueError) as exc:
    raise HTTPException(
      status_code=400,
      detail='pcm16Base64 must be valid base64-encoded PCM16 audio.',
    ) from exc
  if not pcm16:
    raise HTTPException(status_code=400, detail='One-shot take audio is empty.')
  if len(pcm16) % 2:
    raise HTTPException(
      status_code=400,
      detail='PCM16 audio must contain a whole number of 16-bit samples.',
    )
  if len(pcm16) > ONESHOT_MAX_PCM_BYTES:
    raise HTTPException(
      status_code=413,
      detail=f'One-shot take audio exceeds the {ONESHOT_MAX_AUDIO_MS} ms limit.',
    )
  if streaming_analyzer.get_session(voice_session_id) is None:
    raise HTTPException(status_code=404, detail='Voice session not found')

  try:
    # Whole-take DSP is CPU-bound and synchronous; keep it off the event loop
    # exactly as the streamed path does for every individual frame.
    session = await asyncio.to_thread(
      streaming_analyzer.analyze_take_oneshot,
      voice_session_id,
      pcm16,
      payload.referenceClipId,
      payload.reason,
      payload.sloaneSessionId,
      payload.clientAttemptId,
      payload.repContext,
      payload.selfReport,
      payload.analysisProfile,
      payload.takeKind,
    )
  except VoiceStreamBusyError as exc:
    # A live stream owns this session. The caller must NOT also contribute a
    # take for the same audio — that is the double-count guard, decided at the
    # one place that can see both callers.
    raise HTTPException(status_code=409, detail=str(exc)) from exc
  except VoiceSessionEndedError as exc:
    raise HTTPException(status_code=409, detail=str(exc)) from exc
  except ValueError as exc:
    # Same gate as /end and /take: a stored target outside TARGET_PROFILES is a
    # 400. Listed AFTER the two RuntimeError arms above so their 409 semantics
    # are unaffected (neither derives from ValueError).
    raise HTTPException(status_code=400, detail=str(exc)) from exc

  if session is None:
    raise HTTPException(status_code=404, detail='Voice session not found')
  return _take_finalize_payload(session)


@router.websocket('/{voice_session_id}/stream')
async def stream_voice_session(websocket: WebSocket, voice_session_id: str):
  # WebSocket auth reads the token from the query string (browsers can't set
  # headers on the upgrade); constant-time compare via token_matches.
  if not token_matches(websocket.query_params.get('token', '') or '', getattr(settings, 'auth_token', '')):
    await websocket.close(code=4401, reason='Unauthorized')
    return

  session = streaming_analyzer.get_session(voice_session_id)
  if session is None:
    await websocket.close(code=4404, reason='Voice session not found')
    return

  # Only one active stream per session: a second concurrent socket would
  # interleave into the shared sample_offset / PCM file and corrupt the timeline.
  if not streaming_analyzer.acquire_stream(voice_session_id):
    await websocket.close(code=4409, reason='Another stream is already active for this session.')
    return

  try:
    await websocket.accept()
    frame_bytes = int(LIVE_FRAME_SIZE * 2)  # PCM16 little-endian: 2 bytes/sample
    # Cap the buffered backlog so a single oversized/runaway message cannot force
    # unbounded synchronous work. After draining, the buffer always holds less
    # than one whole frame (just a carried-over partial sample).
    max_backlog_bytes = frame_bytes * 64
    buffer = bytearray()
    try:
      while True:
        message = await websocket.receive()
        if message.get('type') == 'websocket.disconnect':
          break
        payload = message.get('bytes')
        if payload is None:
          # Incoming audio frames must be binary (PCM16 LE). Do not reinterpret UTF-8 text as PCM bytes.
          if message.get('text') is not None:
            await websocket.close(code=1003, reason='Text frames are not supported; send binary PCM16 frames.')
            return
          await websocket.close(code=1003, reason='Unsupported frame type; expected binary PCM16 frames.')
          return

        # Accumulate and re-frame. Real clients chunk audio by their own buffer
        # size (AudioWorklet quanta, Opus packets, MTU), almost never in exact
        # 1024-sample PCM blocks, so requiring an exact frame size would
        # disconnect normal browsers mid-utterance. Buffer the bytes, analyze
        # whole frames as they complete, and carry any partial-sample remainder
        # (incl. a split odd byte) to the next message to keep byte alignment.
        buffer.extend(payload)
        if len(buffer) > max_backlog_bytes:
          await websocket.close(code=1009, reason='Audio backlog too large; stream PCM16 continuously in smaller chunks.')
          return

        while len(buffer) >= frame_bytes:
          chunk = bytes(buffer[:frame_bytes])
          del buffer[:frame_bytes]
          try:
            frame = await asyncio.to_thread(streaming_analyzer.register_frame, voice_session_id, chunk)
          except VoiceSessionEndedError:
            await websocket.close(code=1008, reason='Voice session ended; restart explicitly before streaming more audio.')
            return
          except ValueError as exc:
            # 2026-07-27 MTF-ONLY: get_target_profile now RAISES on a preset outside
            # TARGET_PROFILES rather than defaulting to cute-feminine, so a resumed
            # session holding a retired/corrupt preset surfaces here. Failing closed is
            # intended — coaching it against a substituted target is the thing the house
            # law bans — but it must close the socket cleanly instead of dying uncaught.
            #
            # THE REASON MUST STAY SHORT. RFC 6455 caps a control-frame payload at 125
            # bytes, i.e. 123 bytes of reason after the 2-byte close code. Interpolating
            # the ValueError here produced 217 bytes (its message embeds the whole
            # 7-preset enum): `websockets` then raises `control frame too long`, the
            # close never goes out, and the client sees a bare 1006 with an EMPTY
            # reason — the exact opposite of the clean close this handler exists for.
            # Measured 2026-07-27 against a real uvicorn+websockets round-trip.
            # So: fixed short reason on the control frame, full detail on the data
            # channel (the same `error` shape this handler already uses below) and in
            # the server log.
            #
            # MEASURED STORE SCOPE — 2026-07-27, round 5. An earlier revision of this
            # comment asserted "both live stores are clean". That was FALSE: the sweep
            # behind it had covered one of three analyzer directories and none of the
            # gateway's non-primary files. What was actually found and purged, counted
            # per file:
            #   ~/.local/state/sloane/voice-standalone/  (backend/voice-standalone-config.js)
            #     sessions.json                 0 (already clean)
            #     sessions.json.bak             1 session  -> 0   [LIVE RESTORE SOURCE:
            #                                     loadSessions() reads it when the primary
            #                                     is corrupt and writes it back]
            #     eval-turns.jsonl              8 lines    -> 0   (rewritten, not deleted)
            #     learner-context/students/     1 file     -> 0   [REACHED THE MODEL PROMPT
            #                                     via deeptutor-voice-adapter.js
            #                                     `Struggles: ${...join(' | ')}`]
            #     learner-context/events/       1 file     -> 0
            #   sloane-local/voice/  (VOICE_TRAINER_STORAGE_ROOT, storage.py:49-62)
            #     summaries/                    4 files    -> 0
            #     attempt_artifacts/            4 files    -> 0
            #     sessions/ + the other 9 dirs  0 (already clean)
            #   ~/.sloane/voice/  (config.py `_default_storage_root` FALLBACK root — not
            #                      in the round-5 finding list, found by enumerating the
            #                      config rather than the report)
            #     sessions/                     1 file     -> 0
            # Every storage root reachable from backend/voice-standalone-config.js and
            # from services/voice-trainer/src/config.py + storage.py was enumerated and
            # re-counted at 0 after the purge; originals are backed up outside the repo.
            # This is a statement about those enumerated roots on that date, NOT a claim
            # that no such value exists anywhere.
            #
            # Going forward the WRITE gates are what keep it that way: the gateway rejects
            # a non-enum preset inside createSession — the choke point every create path
            # funnels through (startVoiceSession, POST /session/start, checkpoint
            # recovery), reached BEFORE the row is persisted — and again in
            # updateVoiceSessionPreset. This handler stays because a file
            # restored out of band can still carry one.
            logger.warning(
              'Voice session %s rejected: %s', voice_session_id, exc,
            )
            await websocket.send_json({'error': str(exc)})
            await websocket.close(code=1008, reason='Voice session target is no longer supported.')
            return
          if frame is None:
            await websocket.send_json({'error': 'Voice session not found'})
            return
          await websocket.send_json(model_to_dict(frame))
    except WebSocketDisconnect:
      return
  finally:
    streaming_analyzer.release_stream(voice_session_id)
