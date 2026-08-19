import io
import math
import subprocess

import numpy as np
import soundfile as sf


DEFAULT_SPEAKING_RATE = 0.76
MIN_SPEAKING_RATE = 0.65
MAX_SPEAKING_RATE = 1.25


def float32_to_int16(wav: np.ndarray) -> np.ndarray:
    clipped = np.clip(wav, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16)


def pcm_to_wav(pcm: np.ndarray, sample_rate: int) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, pcm, sample_rate, format="WAV", subtype="PCM_16")
    buf.seek(0)
    return buf.read()


def wav_bytes(pcm_int16: np.ndarray, sample_rate: int) -> bytes:
    return pcm_to_wav(pcm_int16, sample_rate)


def normalize_speaking_rate(value: float | int | None) -> float:
    """Return a bounded speech-tempo multiplier (lower is slower)."""
    try:
        rate = float(value)
    except (TypeError, ValueError):
        return DEFAULT_SPEAKING_RATE
    if not math.isfinite(rate):
        return DEFAULT_SPEAKING_RATE
    return max(MIN_SPEAKING_RATE, min(MAX_SPEAKING_RATE, rate))


def apply_speaking_rate(
    pcm_int16: np.ndarray,
    sample_rate: int,
    speaking_rate: float,
) -> np.ndarray:
    """Pitch-preserving tempo adjustment for mono PCM via ffmpeg's atempo.

    VoxCPM2 has no native speaking-rate parameter. The reference recording is
    voice conditioning only; this transform is applied to newly synthesized
    target speech after generation (and after raw-waveform cache lookup).
    """
    pcm = np.asarray(pcm_int16, dtype=np.int16).reshape(-1)
    rate = normalize_speaking_rate(speaking_rate)
    if pcm.size == 0 or abs(rate - 1.0) < 0.001:
        return pcm.copy()

    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-f",
            "s16le",
            "-ar",
            str(sample_rate),
            "-ac",
            "1",
            "-i",
            "pipe:0",
            "-af",
            f"atempo={rate:.6f}",
            "-f",
            "s16le",
            "pipe:1",
        ],
        input=pcm.tobytes(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
        timeout=15,
    )
    if result.returncode != 0 or len(result.stdout) < 2 or len(result.stdout) % 2:
        detail = result.stderr.decode("utf-8", errors="replace").strip()[-300:]
        raise RuntimeError(f"pitch-preserving tempo adjustment failed: {detail}")
    return np.frombuffer(result.stdout, dtype=np.int16).copy()
