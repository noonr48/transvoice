"""Stateless analysis of app-synthesized audio (2026-07-30).

The tutor speaks, and the learner copies the SHAPE its dot traces. That needs a
reading of the tutor's own synthesized speech — and it needs that reading to be
commensurable with the learner's, or "copy this shape" is a lie.

Two load-bearing properties are under test here:

  1. IDENTITY. The same samples through this route and through the reference
     analyzer produce the SAME metrics, because both run the same DSP core. If
     these diverge, a second measurement space has been forked and the two dots
     on the graph no longer mean the same thing.

  2. NOTHING IS WRITTEN. This is the reason the route exists at all: the two
     pre-existing doors both persist (a learner take; a permanent reference
     clip), and the tutor's voice must file under neither. A future refactor
     that quietly adds a storage write is the failure this test exists to catch.
"""
from __future__ import annotations

import base64
import math
from pathlib import Path
import tempfile
import unittest
import wave

import numpy as np

from fastapi.testclient import TestClient

from src.api.main import app
from src.api.routers.synthesis import MAX_SYNTHESIS_AUDIO_MS
from src.services.audio_analysis import (
    SAMPLE_RATE,
    VOICE_ANALYSIS_VERSION,
    _resample_signal,
)
from src.services.reference_analyzer import reference_analyzer
from src.services.storage import voice_storage


TUTOR_SAMPLE_RATE = 48000


def tutor_like_pcm(
    duration_ms: int = 2000,
    start_f0_hz: float = 180.0,
    end_f0_hz: float = 240.0,
    sample_rate: int = TUTOR_SAMPLE_RATE,
) -> bytes:
    """Synthesized speech-like audio whose pitch TRAVELS across the phrase.

    A flat tone would prove the route returns numbers; a rising contour proves
    it returns a SHAPE, which is the only thing the call-and-response graph can
    actually use. Deterministic, so the assertions below are exact.
    """
    sample_count = int(sample_rate * duration_ms / 1000)
    t = np.arange(sample_count, dtype=np.float64) / sample_rate
    # Linear f0 sweep; integrate to get phase so the contour is continuous.
    f0 = np.linspace(start_f0_hz, end_f0_hz, num=sample_count)
    phase = 2.0 * np.pi * np.cumsum(f0) / sample_rate
    signal = np.zeros(sample_count, dtype=np.float64)
    for harmonic in range(1, 25):
        freq = f0 * harmonic
        if float(freq[0]) >= sample_rate / 2:
            break
        # Formant-ish envelope peaking near 700 Hz and 1800 Hz.
        envelope = (
            1.0 / (1.0 + ((freq - 700.0) / 260.0) ** 2)
            + 0.6 / (1.0 + ((freq - 1800.0) / 420.0) ** 2)
        )
        signal += envelope * np.sin(phase * harmonic) / harmonic
    peak = float(np.max(np.abs(signal))) or 1.0
    scaled = (signal / peak) * 0.72
    return (scaled * 32767.0).astype("<i2").tobytes()


def encode(pcm: bytes) -> str:
    return base64.b64encode(pcm).decode("ascii")


class SynthesisAnalysisRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def post(self, **body):
        return self.client.post("/api/v1/voice/synthesis/analyze", json=body)

    def test_returns_a_travelling_pitch_and_resonance_track(self) -> None:
        response = self.post(
            pcm16Base64=encode(tutor_like_pcm()),
            sampleRate=TUTOR_SAMPLE_RATE,
            targetPreset="cute-feminine",
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()

        self.assertEqual(payload["analysisVersion"], VOICE_ANALYSIS_VERSION)
        self.assertEqual(payload["sampleRate"], SAMPLE_RATE)
        self.assertAlmostEqual(payload["durationMs"], 2000, delta=2)

        timeline = payload["timeline"]
        self.assertGreater(len(timeline), 20)
        voiced = [frame for frame in timeline if frame["voiced"]]
        self.assertGreater(len(voiced), 10, "synthesized speech must read as voiced")

        # Every frame carries the two fields the graph plots.
        for frame in voiced:
            self.assertIsInstance(frame["pitchHz"], float)
            self.assertIsInstance(frame["resonanceScore"], float)
            self.assertGreater(frame["pitchHz"], 0.0)

        # The SHAPE, not just a value: the contour rises across the phrase.
        first_third = [f["pitchHz"] for f in voiced[: max(1, len(voiced) // 3)]]
        last_third = [f["pitchHz"] for f in voiced[-max(1, len(voiced) // 3) :]]
        self.assertLess(
            sum(first_third) / len(first_third),
            sum(last_third) / len(last_third),
            "a rising synthesized contour must read as rising",
        )

        metrics = payload["metrics"]
        self.assertGreater(metrics["meanPitchHz"], 150.0)
        self.assertLess(metrics["meanPitchHz"], 280.0)
        self.assertIsNotNone(metrics["resonanceMean"])
        self.assertTrue(metrics["advanced"]["measurementAvailable"])

    def test_persists_nothing(self) -> None:
        """The reason this route exists. Both older doors write; this one must not.

        The snapshot carries size and mtime, not just paths. A leak that always
        writes the SAME filename — and a leak an earlier test in this class has
        already triggered once — is invisible to a path-set comparison. That is
        not hypothetical: the first version of this test was order-dependent and
        a deliberately-injected `store_reference_file` call survived it.
        """
        storage_root = Path(voice_storage.references_raw_dir).parent.parent

        def snapshot() -> set[tuple[str, int, int]]:
            found = set()
            for path in storage_root.rglob("*"):
                if not path.is_file():
                    continue
                try:
                    stat = path.stat()
                except OSError:
                    continue
                found.add((str(path.relative_to(storage_root)), stat.st_size, stat.st_mtime_ns))
            return found

        before_files = snapshot()
        before_references = voice_storage.reference_count()
        before_sessions = voice_storage.session_count()

        response = self.post(
            pcm16Base64=encode(tutor_like_pcm()),
            sampleRate=TUTOR_SAMPLE_RATE,
        )
        self.assertEqual(response.status_code, 200, response.text)

        self.assertEqual(voice_storage.reference_count(), before_references)
        self.assertEqual(voice_storage.session_count(), before_sessions)
        self.assertEqual(
            snapshot() - before_files,
            set(),
            "analyzing synthesized audio must not create or rewrite any stored artifact",
        )

        # And no clipId is even minted — nothing to accidentally file later.
        self.assertNotIn("clipId", response.json())

    def test_matches_the_reference_analyzer_on_the_same_audio(self) -> None:
        """IDENTITY: same samples, same DSP core, same numbers.

        Run the audio through the stored-reference path (which is the analyzer
        the learner's own uploads go through) and through this route, and
        require the readings to agree. This is what makes the tutor's dot and
        the learner's dot comparable.
        """
        pcm = tutor_like_pcm()
        with tempfile.TemporaryDirectory() as tmp:
            wav_path = Path(tmp) / "tutor.wav"
            with wave.open(str(wav_path), "wb") as handle:
                handle.setnchannels(1)
                handle.setsampwidth(2)
                handle.setframerate(TUTOR_SAMPLE_RATE)
                handle.writeframes(pcm)

            reference = reference_analyzer.analyze_clip(
                clip_id="0" * 32,
                filename="tutor.wav",
                raw_path=wav_path,
                target_preset="cute-feminine",
            )
        # analyze_clip persists by contract; drop the probe clip so this test
        # leaves the store exactly as it found it.
        voice_storage._references.pop("0" * 32, None)
        analysis_json = voice_storage.references_analysis_dir / f'{"0" * 32}.json'
        analysis_json.unlink(missing_ok=True)

        response = self.post(pcm16Base64=encode(pcm), sampleRate=TUTOR_SAMPLE_RATE)
        self.assertEqual(response.status_code, 200, response.text)
        live = response.json()["metrics"]

        self.assertEqual(response.json()["analysisVersion"], reference.analysisVersion)
        # The reference path decodes through ffmpeg and this one through the
        # in-process resampler, so allow a hair of decode difference — but the
        # readings must agree to well within a semitone.
        self.assertAlmostEqual(
            live["meanPitchHz"], reference.metrics.meanPitchHz, delta=4.0
        )
        self.assertAlmostEqual(
            live["resonanceMean"], reference.metrics.resonanceMean, delta=0.06
        )

    def test_resampling_is_the_analyzers_own(self) -> None:
        """48 kHz in and its 16 kHz equivalent must read the same."""
        pcm48 = tutor_like_pcm()
        samples48 = np.frombuffer(pcm48, dtype="<i2").astype(np.float32) / 32768.0
        samples16 = _resample_signal(samples48, TUTOR_SAMPLE_RATE, SAMPLE_RATE)
        pcm16 = (samples16 * 32767.0).astype("<i2").tobytes()

        at48 = self.post(pcm16Base64=encode(pcm48), sampleRate=TUTOR_SAMPLE_RATE)
        at16 = self.post(pcm16Base64=encode(pcm16), sampleRate=SAMPLE_RATE)
        self.assertEqual(at48.status_code, 200, at48.text)
        self.assertEqual(at16.status_code, 200, at16.text)
        self.assertAlmostEqual(
            at48.json()["metrics"]["meanPitchHz"],
            at16.json()["metrics"]["meanPitchHz"],
            delta=1.0,
        )
        self.assertAlmostEqual(at48.json()["durationMs"], at16.json()["durationMs"], delta=2)

    def test_rejects_malformed_and_oversized_audio(self) -> None:
        pcm = tutor_like_pcm(duration_ms=200)

        self.assertEqual(self.post(pcm16Base64="", sampleRate=16000).status_code, 400)
        self.assertEqual(
            self.post(pcm16Base64="not base64!!", sampleRate=16000).status_code, 400
        )
        # Odd byte count is not a whole number of 16-bit samples.
        self.assertEqual(
            self.post(pcm16Base64=encode(pcm[:-1]), sampleRate=16000).status_code, 400
        )
        # Out-of-range sample rates.
        self.assertEqual(self.post(pcm16Base64=encode(pcm), sampleRate=0).status_code, 400)
        self.assertEqual(
            self.post(pcm16Base64=encode(pcm), sampleRate=192000).status_code, 400
        )

        # Oversize is rejected on the ENCODED length, before any allocation.
        max_bytes = int(16000 * 2 * (MAX_SYNTHESIS_AUDIO_MS / 1000))
        oversize = "A" * ((math.ceil(max_bytes / 3) * 4) + 8)
        self.assertEqual(
            self.post(pcm16Base64=oversize, sampleRate=16000).status_code, 413
        )

    def test_silence_reports_no_measurement_rather_than_inventing_one(self) -> None:
        silence = bytes(TUTOR_SAMPLE_RATE * 2)  # 1 s of digital silence
        response = self.post(pcm16Base64=encode(silence), sampleRate=TUTOR_SAMPLE_RATE)
        self.assertEqual(response.status_code, 200, response.text)
        advanced = response.json()["metrics"]["advanced"]
        self.assertFalse(advanced["measurementAvailable"])


if __name__ == "__main__":
    unittest.main()
