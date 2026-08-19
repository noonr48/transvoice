"""Contract tests for descriptive formant-lite measurement reliability.

These fields are NOT a clinical or product validation decision. They expose how
much already-computed LPC evidence contributed to the attempt-level formant
summary so downstream research can determine later whether a detector/version
is reliable enough for beginner-facing resonance coaching.
"""
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np

from src.services import audio_analysis as A


def _window(pitch_hz: float):
    return SimpleNamespace(pitchHz=pitch_hz), np.zeros(A.LIVE_FRAME_SIZE, dtype=np.float64)


def test_formant_lite_surfaces_window_yield_dispersion_and_pitch_context():
    windows = [
        _window(150.0),
        _window(160.0),
        _window(165.0),
        _window(170.0),
        _window(180.0),
    ]
    estimates = [
        (500.0, 1800.0),
        (510.0, 1820.0),
        (None, None),
        (495.0, 1790.0),
        (505.0, 1810.0),
    ]

    with patch.object(A, "_estimate_lpc_formants", side_effect=estimates):
        metrics, f2_values = A._build_formant_lite_metrics(windows, A.SAMPLE_RATE)

    assert metrics is not None
    assert len(f2_values) == 4
    assert metrics.analysisWindowCount == 5
    assert metrics.validWindowCount == 4
    assert metrics.validWindowPct == 0.8
    assert metrics.f2P10Hz is not None
    assert metrics.f2P90Hz is not None
    assert metrics.f2P10Hz < metrics.f2MedianHz < metrics.f2P90Hz
    assert metrics.f2IqrHz is not None and metrics.f2IqrHz > 0
    assert metrics.f2MadHz is not None and metrics.f2MadHz > 0
    assert metrics.medianWindowPitchHz == 165.0
    assert metrics.maxWindowPitchHz == 180.0


def test_formant_lite_still_fails_closed_when_fewer_than_three_windows_solve():
    windows = [_window(150.0), _window(160.0), _window(170.0), _window(180.0)]
    estimates = [
        (500.0, 1800.0),
        (None, None),
        (510.0, 1810.0),
        (None, None),
    ]

    with patch.object(A, "_estimate_lpc_formants", side_effect=estimates):
        metrics, f2_values = A._build_formant_lite_metrics(windows, A.SAMPLE_RATE)

    assert metrics is None
    assert len(f2_values) == 2
