"""Stateless analysis of audio the app synthesized itself (2026-07-30).

Why this route exists at all is argued on ``SynthesisAnalysisRequest``: the two
existing analysis doors both WRITE (a learner take, or a permanent reference
clip), and the tutor's own voice must file under neither. Everything below the
HTTP layer is the same DSP core those doors run, so a tutor reading and a
learner reading are commensurable — which is the whole point of a call-and-
response graph where the learner copies the tutor's shape.

Nothing here touches ``voice_storage``.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import math

from fastapi import APIRouter, HTTPException

from src.services.audio_analysis import (
  ANALYSIS_FRAME_SIZE,
  ANALYSIS_HOP_SIZE,
  SAMPLE_RATE,
  VOICE_ANALYSIS_VERSION,
  _resample_signal,
  build_attempt_metrics,
  build_timeline_from_samples,
  compress_timeline,
  normalize_target_preset,
  pcm16_bytes_to_float_samples,
)
from src.services.contracts import (
  SynthesisAnalysisRequest,
  SynthesisAnalysisResponse,
)
from src.services.storage import model_to_dict


router = APIRouter(prefix='/api/v1/voice/synthesis', tags=['voice-synthesis'])

# 60 s of mono PCM16 at the request's own rate. Expressed as a duration rather
# than a byte count because tutor speech arrives at 48 kHz while a learner take
# arrives at 16 kHz, and the thing actually being bounded is analysis time.
MAX_SYNTHESIS_AUDIO_MS = 60_000
MIN_SYNTHESIS_SAMPLE_RATE = 8_000
MAX_SYNTHESIS_SAMPLE_RATE = 96_000


def _max_pcm_bytes(sample_rate: int) -> int:
  return int(sample_rate * 2 * (MAX_SYNTHESIS_AUDIO_MS / 1000))


@router.post('/analyze', response_model=SynthesisAnalysisResponse)
async def analyze_synthesis(payload: SynthesisAnalysisRequest):
  sample_rate = int(payload.sampleRate or 0)
  if not (MIN_SYNTHESIS_SAMPLE_RATE <= sample_rate <= MAX_SYNTHESIS_SAMPLE_RATE):
    raise HTTPException(
      status_code=400,
      detail=(
        f'sampleRate must be between {MIN_SYNTHESIS_SAMPLE_RATE} and '
        f'{MAX_SYNTHESIS_SAMPLE_RATE} Hz.'
      ),
    )

  encoded = payload.pcm16Base64 or ''
  max_bytes = _max_pcm_bytes(sample_rate)
  # Reject an oversized body BEFORE decoding it, exactly as the one-shot take
  # route does: base64 inflates 3 bytes to 4, so the encoded length bounds the
  # decoded length without allocating it.
  if len(encoded) > (math.ceil(max_bytes / 3) * 4) + 4:
    raise HTTPException(
      status_code=413,
      detail=f'Synthesis audio exceeds the {MAX_SYNTHESIS_AUDIO_MS} ms limit.',
    )
  try:
    pcm16 = base64.b64decode(encoded, validate=True)
  except (binascii.Error, ValueError) as exc:
    raise HTTPException(
      status_code=400,
      detail='pcm16Base64 must be valid base64-encoded PCM16 audio.',
    ) from exc
  if not pcm16:
    raise HTTPException(status_code=400, detail='Synthesis audio is empty.')
  if len(pcm16) % 2:
    raise HTTPException(
      status_code=400,
      detail='PCM16 audio must contain a whole number of 16-bit samples.',
    )
  if len(pcm16) > max_bytes:
    raise HTTPException(
      status_code=413,
      detail=f'Synthesis audio exceeds the {MAX_SYNTHESIS_AUDIO_MS} ms limit.',
    )

  target_preset = normalize_target_preset(payload.targetPreset)
  duration_ms = int(round((len(pcm16) / 2) * 1000 / sample_rate))

  # Whole-clip DSP is CPU-bound and synchronous; keep it off the event loop the
  # same way every other analysis door in this service does.
  return await asyncio.to_thread(
    _analyze_pcm,
    pcm16,
    sample_rate,
    target_preset,
    duration_ms,
  )


def _analyze_pcm(
  pcm16: bytes,
  sample_rate: int,
  target_preset: str,
  duration_ms: int,
) -> dict:
  samples = pcm16_bytes_to_float_samples(pcm16)
  # The analyzer's OWN resampler, not a second implementation: a tutor reading
  # has to sit in the same measurement space as a learner take for the graph's
  # "copy this shape" premise to mean anything.
  samples = _resample_signal(samples, sample_rate, SAMPLE_RATE)
  if samples.size == 0:
    raise HTTPException(
      status_code=400,
      detail='Synthesis audio did not decode into audio samples.',
    )

  full_timeline = build_timeline_from_samples(
    samples,
    target_preset,
    SAMPLE_RATE,
    ANALYSIS_FRAME_SIZE,
    ANALYSIS_HOP_SIZE,
  )
  metrics = build_attempt_metrics(
    full_timeline,
    target_preset,
    raw_samples=samples,
    sample_rate=SAMPLE_RATE,
    frame_size=ANALYSIS_HOP_SIZE,
  )
  analysis = SynthesisAnalysisResponse(
    analysisVersion=VOICE_ANALYSIS_VERSION,
    durationMs=duration_ms,
    sampleRate=SAMPLE_RATE,
    metrics=metrics,
    timeline=compress_timeline(full_timeline),
  )
  return model_to_dict(analysis)
