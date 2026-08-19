from __future__ import annotations

import asyncio
import logging
from pathlib import Path
import uuid

import numpy as np

from src.services.audio_analysis import (
    ANALYSIS_FRAME_SIZE,
    ANALYSIS_HOP_SIZE,
    REFERENCE_HOP_SIZE,
    SAMPLE_RATE,
    build_attempt_metrics,
    build_timeline_from_samples,
    compress_timeline,
    decode_audio_file_to_samples,
    normalize_target_preset,
)
from src.services.contracts import (
    ReferenceAnalysisResponse,
    VOICE_ANALYSIS_VERSION,
    VoiceAttemptMetrics,
    VoiceReferenceQuality,
)
from src.services.storage import voice_storage

logger = logging.getLogger(__name__)

# Clip-wide clipping threshold mirrors the per-frame DSP convention in
# audio_analysis.py (|x| >= 0.985 counts as a clipped/saturated sample).
_CLIP_SATURATION_LEVEL = 0.985

# Cloning is conservative: it wants cleaner audio than coaching does, because a
# noisy/quiet/clipped reference produces an audibly degraded cloned coach voice.
_CLONE_MAX_CLIPPING_PCT = 0.05
_CLONE_MIN_DURATION_MS = 3000

# Verdict floors. "reject" is reserved for clips that are genuinely unusable as a
# target at all (decode-empty is handled upstream with a 400).
_REJECT_MIN_DURATION_MS = 1500
_REJECT_MIN_VOICED_COVERAGE = 0.15

# Human-readable labels for the reliability flags the analyzer already emits.
_FLAG_PHRASES = {
    "short_sample": "very short",
    "low_voiced_coverage": "little clear voice",
    "low_confidence": "hard to read clearly",
    "low_score_confidence": "uncertain reading",
    "quiet_input": "quiet",
}


def _clip_wide_clipping_pct(samples: np.ndarray) -> float:
    """Fraction of raw samples at/over the saturation level across the WHOLE clip.

    The per-frame ``clippingPct`` aggregated in ``build_attempt_metrics`` only
    averages voiced frames; for a trust/cloning gate we want clipping anywhere in
    the clip, so measure it directly on the decoded mono samples (same threshold,
    no new math)."""
    if samples is None or samples.size == 0:
        return 0.0
    return float(np.mean(np.abs(samples) >= _CLIP_SATURATION_LEVEL))


def assess_reference_quality(
    metrics: VoiceAttemptMetrics,
    duration_ms: int,
    clipping_pct: float,
) -> VoiceReferenceQuality:
    """Turn the metrics we already computed into a plain-English trust verdict.

    Pure policy over existing numbers — no signal processing here."""
    advanced = metrics.advanced
    flags = list(advanced.reliabilityFlags) if advanced is not None else []
    voiced_coverage = (
        float(advanced.voicedFramePct)
        if advanced is not None and advanced.voicedFramePct is not None
        else 0.0
    )
    mean_loudness_db = (
        float(advanced.meanLoudnessDb)
        if advanced is not None and advanced.meanLoudnessDb is not None
        else -90.0
    )
    quiet = "quiet_input" in flags

    # --- verdict -------------------------------------------------------------
    if (
        duration_ms < _REJECT_MIN_DURATION_MS
        or voiced_coverage < _REJECT_MIN_VOICED_COVERAGE
    ):
        verdict = "reject"
    elif flags:
        verdict = "usable"
    else:
        verdict = "good"

    # --- cloning gate (stricter than coaching) -------------------------------
    cloneable = not (
        clipping_pct > _CLONE_MAX_CLIPPING_PCT
        or quiet
        or duration_ms < _CLONE_MIN_DURATION_MS
        or verdict == "reject"
    )

    # --- summaries -----------------------------------------------------------
    duration_s = round(duration_ms / 1000.0, 1)
    if verdict == "reject":
        if duration_ms < _REJECT_MIN_DURATION_MS:
            summary = (
                f"This clip is only {duration_s}s — too short to read a target "
                "voice from. Aim for 10–20 seconds of speech."
            )
        else:
            summary = (
                "Almost no clear speech was found in this clip. Record somewhere "
                "quieter, speaking steadily into the mic."
            )
    elif verdict == "usable":
        descriptors = [
            _FLAG_PHRASES[flag] for flag in flags if flag in _FLAG_PHRASES
        ]
        if descriptors:
            joined = ", ".join(dict.fromkeys(descriptors))
            summary = (
                f"Usable, but the clip is {joined}. A longer, clearer take would "
                "give a steadier target."
            )
        else:
            summary = "Usable target voice, with a few minor reliability notes."
    else:
        summary = (
            f"Clear {duration_s}s sample — this reads as a solid target voice."
        )

    if cloneable:
        clone_note = "Demos will be spoken in your target voice."
    elif clipping_pct > _CLONE_MAX_CLIPPING_PCT:
        clone_note = (
            "Clip is too distorted (clipping) to clone — demos will use the "
            "default coach voice."
        )
    elif quiet:
        clone_note = (
            "Clip is too quiet to clone cleanly — demos will use the default "
            "coach voice."
        )
    elif duration_ms < _CLONE_MIN_DURATION_MS:
        clone_note = (
            "Clip is a little short to clone reliably — demos will use the "
            "default coach voice."
        )
    else:
        clone_note = "Clip too noisy to clone — demos will use the default coach voice."

    return VoiceReferenceQuality(
        durationMs=int(duration_ms),
        clippingPct=round(float(clipping_pct), 4),
        meanLoudnessDb=round(float(mean_loudness_db), 2),
        voicedCoveragePct=round(float(voiced_coverage), 3),
        flags=flags,
        verdict=verdict,
        cloneable=bool(cloneable),
        summary=summary,
        cloneNote=clone_note,
    )


class ReferenceAnalyzer:
    def analyze_clip(
        self,
        *,
        clip_id: str,
        filename: str,
        raw_path: Path,
        target_preset: str,
    ) -> ReferenceAnalysisResponse:
        """Analyze one retained raw clip and persist the result under ``clip_id``.

        The single analysis core shared by the upload path and the stale-
        calibration self-heal. It is deliberately SYNCHRONOUS and CPU-bound
        (decode + full-clip DSP takes seconds on a normal reference take), so
        every caller reached from an async request handler must run it off the
        event loop — ``analyze_upload`` wraps it in ``asyncio.to_thread``, and
        the session-start gate reaches it from a worker thread because
        ``POST /api/v1/voice/sessions/start`` offloads ``start_session`` with
        ``asyncio.to_thread``.

        Writing under an existing ``clip_id`` is an in-place re-stamp:
        ``voice_storage.save_reference`` upserts by clipId, so the clip keeps
        its identity, filename and target preset while its metrics, timeline,
        quality and ``analysisVersion`` are recomputed with the current
        calibration."""
        resolved_target_preset = normalize_target_preset(target_preset)

        samples = decode_audio_file_to_samples(raw_path, SAMPLE_RATE)
        if samples.size == 0:
            raise ValueError(
                f'Uploaded clip "{filename}" did not decode into audio samples'
            )

        full_timeline = build_timeline_from_samples(
            samples,
            resolved_target_preset,
            SAMPLE_RATE,
            ANALYSIS_FRAME_SIZE,
            ANALYSIS_HOP_SIZE,
        )
        timeline = compress_timeline(full_timeline)
        metrics = build_attempt_metrics(
            full_timeline,
            resolved_target_preset,
            raw_samples=samples,
            sample_rate=SAMPLE_RATE,
            frame_size=ANALYSIS_HOP_SIZE,
        )

        duration_ms = int(round(samples.shape[0] * 1000 / SAMPLE_RATE))
        clipping_pct = _clip_wide_clipping_pct(samples)
        quality = assess_reference_quality(metrics, duration_ms, clipping_pct)

        analysis = ReferenceAnalysisResponse(
            clipId=clip_id,
            filename=filename,
            durationMs=duration_ms,
            targetPreset=resolved_target_preset,
            metrics=metrics,
            timeline=timeline,
            quality=quality,
            analysisVersion=VOICE_ANALYSIS_VERSION,
        )
        return voice_storage.save_reference(analysis)

    async def analyze_upload(
        self, upload, target_preset: str
    ) -> ReferenceAnalysisResponse:
        resolved_target_preset = normalize_target_preset(target_preset)
        raw = await upload.read()
        clip_id = uuid.uuid4().hex
        filename = upload.filename or f"{clip_id}.wav"
        raw_path = voice_storage.store_reference_file(clip_id, filename, raw)

        return await asyncio.to_thread(
            self.analyze_clip,
            clip_id=clip_id,
            filename=filename,
            raw_path=raw_path,
            target_preset=resolved_target_preset,
        )

    def reanalyze_stored(self, clip_id: str) -> ReferenceAnalysisResponse | None:
        """Re-analyze an already-stored reference IN PLACE with the current
        calibration, reusing the retained raw audio.

        This is the durable half of calibration self-healing: when
        ``VOICE_ANALYSIS_VERSION`` moves, a stored analysis from the previous
        version can no longer derive a voice target, but the raw audio it was
        derived from is still on disk — so the analysis can simply be rebuilt
        instead of stranding the clip.

        Returns ``None`` (never raises) when the self-heal is not possible:
        no stored analysis, no retained raw file, or the re-analysis itself
        fails. A ``None`` return means the caller must fail exactly as it would
        have before, so a broken self-heal can never widen an existing gate."""
        stored = voice_storage.get_reference(clip_id)
        if stored is None:
            return None

        raw_path = voice_storage.get_reference_file_path(clip_id)
        if raw_path is None or not raw_path.exists():
            logger.warning(
                'event=voice_reference_reanalysis_skipped reason=missing_raw_audio '
                'clip_id=%s from_version=%s',
                clip_id,
                stored.analysisVersion,
            )
            return None

        try:
            return self.analyze_clip(
                clip_id=stored.clipId,
                filename=stored.filename,
                raw_path=raw_path,
                target_preset=stored.targetPreset,
            )
        except Exception as exc:  # noqa: BLE001 - self-heal must never escalate
            logger.warning(
                'event=voice_reference_reanalysis_failed clip_id=%s '
                'from_version=%s error=%s',
                clip_id,
                stored.analysisVersion,
                type(exc).__name__,
            )
            return None


reference_analyzer = ReferenceAnalyzer()
