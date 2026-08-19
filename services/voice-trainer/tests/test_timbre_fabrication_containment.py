"""Containment tests for the fabricated-timbre value (2026-07-29).

WHAT THIS IS ABOUT. `_estimate_timbre` returns a hard-coded ``0.5, 0.5`` when the
frame carries no speech-band energy (audio_analysis.py, the ``total_energy <=
EPSILON`` branch), and ``analyze_pcm_frame`` does the same for an empty buffer.
0.5 is dead-centre on both 0-1 axes — the single most believable wrong answer
there is, because a graph dot drawn there looks like a perfectly ordinary voice.

WHY IT WAS NOT CHANGED. ``VoiceFrame.resonanceScore`` / ``.weightScore`` are
REQUIRED floats in contracts.py and are mirrored as required numbers in
frontend/src/voice/contracts.ts, so returning None is a breaking wire change
across a live path. Measured 2026-07-29: the fabrication never reaches an
attempt's means, because the aggregate already selects voiced frames only. A
breaking change was therefore not justified for a defect that two existing
guards already neutralise.

WHAT THESE TESTS DO. They pin the two guards that make that judgement safe. If
either is ever removed, these fail loudly rather than the fabricated 0.5
silently becoming coaching evidence.
"""

import numpy as np
import pytest

from src.services import audio_analysis as A

PRESET = "everyday-feminine"


def _voiced_frame(index: int) -> np.ndarray:
    """A synthetic masculine-ish vowel: low f0, energy concentrated low."""
    start = index * A.LIVE_FRAME_SIZE
    t = (np.arange(A.LIVE_FRAME_SIZE) + start) / float(A.SAMPLE_RATE)
    return (
        0.30 * np.sin(2 * np.pi * 130.0 * t)
        + 0.15 * np.sin(2 * np.pi * 390.0 * t)
        + 0.05 * np.sin(2 * np.pi * 1400.0 * t)
    ).astype(np.float32)


def _silent_frame() -> np.ndarray:
    return np.zeros(A.LIVE_FRAME_SIZE, dtype=np.float32)


def test_the_fabricated_value_is_still_there_and_is_still_dead_centre():
    """Documents the defect precisely, so the containment below has a subject.

    If this ever fails because the function started returning None, the wire
    contract was changed and every consumer needs re-checking — see the module
    docstring.
    """
    resonance, weight = A._estimate_timbre(_silent_frame(), A.SAMPLE_RATE, None)
    assert resonance == 0.5
    assert weight == 0.5


def test_GUARD_1_silent_frames_never_reach_a_mixed_take_s_means():
    """The load-bearing guard: voiced-frame selection in the aggregate.

    A take that is half real voice and half digital silence must produce exactly
    the same resonance/weight means as the voiced half alone. Any drift toward
    0.5 means the fabricated frames are being averaged in.
    """
    frames = [
        A.analyze_pcm_frame(_voiced_frame(i), time_ms=i * 64, target_preset=PRESET)
        for i in range(20)
    ]
    frames += [
        A.analyze_pcm_frame(_silent_frame(), time_ms=i * 64, target_preset=PRESET)
        for i in range(20, 40)
    ]

    voiced = [f for f in frames if f.voiced]
    assert voiced, "fixture produced no voiced frames — the synthetic vowel stopped working"

    metrics = A.build_attempt_metrics(frames, target_preset=PRESET)
    voiced_resonance = float(np.mean([f.resonanceScore for f in voiced]))
    voiced_weight = float(np.mean([f.weightScore for f in voiced]))

    assert metrics.resonanceMean == pytest.approx(voiced_resonance, abs=1e-6)
    assert metrics.weightMean == pytest.approx(voiced_weight, abs=1e-6)


def test_GUARD_2_an_all_silent_take_is_flagged_unusable():
    """The second guard: a take with nothing to measure says so.

    The means ARE fabricated here (0.5 / 0.5) — that is the known defect. What
    must never break is the flag, because backend/coaching/signal-builder.js
    detectIssues returns early on ``measurementAvailable === false`` and that is
    what stops the fabricated numbers becoming a spoken cue.
    """
    frames = [
        A.analyze_pcm_frame(_silent_frame(), time_ms=i * 64, target_preset=PRESET)
        for i in range(40)
    ]
    metrics = A.build_attempt_metrics(frames, target_preset=PRESET)

    assert metrics.advanced.measurementAvailable is False
    assert "no_voiced_frames" in (metrics.advanced.measurementRejectionReasons or [])
    assert metrics.advanced.voicedFramePct == 0.0
