import shutil

import numpy as np
import pytest

from app.audio import apply_speaking_rate, normalize_speaking_rate


def _estimated_frequency(signal: np.ndarray, sample_rate: int) -> float:
    crossings = np.count_nonzero(np.diff(np.signbit(signal)))
    duration = len(signal) / sample_rate
    return crossings / (2 * duration)


def test_speaking_rate_normalization_is_bounded_and_defaults_slow():
    assert normalize_speaking_rate(None) == 0.76
    assert normalize_speaking_rate(float("nan")) == 0.76
    assert normalize_speaking_rate(0.1) == 0.65
    assert normalize_speaking_rate(3) == 1.25
    assert normalize_speaking_rate(0.76) == 0.76


def test_unity_rate_preserves_pcm_exactly():
    pcm = np.array([-32768, -1, 0, 1, 32767], dtype=np.int16)
    assert np.array_equal(apply_speaking_rate(pcm, 48000, 1.0), pcm)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is required")
def test_slower_rate_extends_duration_without_shifting_pitch():
    sample_rate = 48000
    duration = 1.5
    time_axis = np.arange(round(sample_rate * duration)) / sample_rate
    pcm = (0.35 * np.sin(2 * np.pi * 220 * time_axis) * 32767).astype(np.int16)

    slowed = apply_speaking_rate(pcm, sample_rate, 0.8)

    assert len(slowed) > len(pcm) * 1.15
    assert len(slowed) < len(pcm) * 1.35
    assert _estimated_frequency(slowed, sample_rate) == pytest.approx(220, rel=0.03)
