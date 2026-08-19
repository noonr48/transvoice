"""Tests for the 2026-07-19 vocalise proxies + LPC analysis-profile gate.

Covers the field contract added to VoiceAttemptAdvancedMetrics:
  glideSmoothness   1 − std(per-frame pitch slope st/s)/30, clamped 0-1,
                    null when <8 voiced frames
  f2RangeHz         max−min of the per-window F2 list, null when <3 windows
  trillRateHz/trillDetected/trillDurationMs
                    dominant 15-45 Hz AM of the frame-RMS envelope (one
                    lag-limited autocorrelation, strict-local-max + >=0.35
                    normalized-peak prominence rule); nulls when the frame
                    rate cannot cover the band (live ~16 fps)
  hitPitchCeiling   >=5% of voiced frames within 2 Hz of the 400 Hz clamp
  analysisProfile   echo of the profile that produced the metrics

and the 'no_formants' profile: formant-derived fields null, non-formant
fields identical, default 'standard' byte-identical to the pre-gate behavior.

Signals are synthesized with numpy only (no scipy), matching test_dsp_fixes.
"""
from __future__ import annotations

import math
import unittest

import numpy as np

from src.services import audio_analysis as A
from src.services.contracts import (
    VoiceFrame,
    VoiceFrameAdvancedMetrics,
    VoiceSessionEndRequest,
)

FS = A.SAMPLE_RATE


def synth_vowel(f0, formants, dur=1.4, fs=FS, gain=1.0, seed=0):
    """Source-filter vowel (same synthesizer as test_dsp_fixes)."""
    rng = np.random.default_rng(seed)
    n = int(dur * fs)
    t = np.arange(n) / fs
    sig = np.zeros(n)
    k = 1
    while k * f0 < fs / 2 * 0.95:
        fk = k * f0
        mag = 1.0
        for fc, bw in formants:
            r = math.exp(-math.pi * bw / fs)
            theta = 2 * math.pi * fc / fs
            w = 2 * math.pi * fk / fs
            denom = abs(
                1 - 2 * r * math.cos(theta) * np.exp(-1j * w) + r * r * np.exp(-2j * w)
            )
            mag *= (1 - r) / max(denom, 1e-9)
        sig += mag / (k**0.5) * np.cos(2 * math.pi * fk * t + rng.uniform(0, 2 * math.pi))
        k += 1
    sig = sig / (np.max(np.abs(sig)) + 1e-9) * 0.9 * gain
    return sig.astype(np.float32)


FORMANTS = [(650, 80), (1200, 90), (2600, 120)]


def make_frame(t_ms, pitch_hz, voiced=True, rms=0.05):
    return VoiceFrame(
        t=int(t_ms),
        voiced=voiced,
        pitchHz=round(float(pitch_hz), 2) if voiced else 0.0,
        pitchScore=0.5,
        resonanceScore=0.5,
        weightScore=0.5,
        confidence=0.9 if voiced else 0.1,
        loudnessDb=-20.0 if voiced else -60.0,
        advanced=VoiceFrameAdvancedMetrics(rms=rms),
    )


def offline_metrics(sig, preset="everyday-feminine", analysis_profile="standard"):
    timeline = A.build_timeline_from_samples(
        sig, preset, FS, A.ANALYSIS_FRAME_SIZE, A.ANALYSIS_HOP_SIZE,
        analysis_profile=analysis_profile,
    )
    return A.build_attempt_metrics(
        timeline, preset, raw_samples=sig, sample_rate=FS,
        frame_size=A.ANALYSIS_HOP_SIZE, analysis_profile=analysis_profile,
    )


class GlideSmoothnessTests(unittest.TestCase):
    def _glide_timeline(self, n=150, dt_ms=10):
        # Linear 150 -> 300 Hz sweep: slope drifts slowly (11.5 -> 5.8 st/s),
        # so the slope std is small and smoothness must read high.
        return [
            make_frame(i * dt_ms, 150.0 + (150.0 * i / (n - 1))) for i in range(n)
        ]

    def test_linear_glide_scores_high_and_reports_robust_range(self):
        metrics = A.build_attempt_metrics(self._glide_timeline(), "everyday-feminine")
        adv = metrics.advanced
        self.assertIsNotNone(adv.glideSmoothness)
        self.assertGreaterEqual(adv.glideSmoothness, 0.85)
        # pitchRangeSt is the robust P10-P90 spread, not the extrema: that keeps
        # a single octave-tracking error from looking like expressive range.
        self.assertAlmostEqual(metrics.pitchRangeSt, 9.46, delta=0.1)
        # The endpoint contour still records the full 150 -> 300 Hz octave.
        self.assertAlmostEqual(adv.pitchDriftSt, 12.0, delta=0.1)

    def test_jittery_pitch_scores_low(self):
        rng = np.random.default_rng(11)
        jittery = [
            make_frame(i * 10, rng.uniform(170.0, 230.0)) for i in range(150)
        ]
        smooth = A.build_attempt_metrics(
            self._glide_timeline(), "everyday-feminine"
        ).advanced.glideSmoothness
        rough = A.build_attempt_metrics(
            jittery, "everyday-feminine"
        ).advanced.glideSmoothness
        self.assertIsNotNone(rough)
        self.assertLessEqual(rough, 0.2)
        self.assertLess(rough, smooth)

    def test_null_under_eight_voiced_frames(self):
        short = [make_frame(i * 10, 200.0) for i in range(6)]
        metrics = A.build_attempt_metrics(short, "everyday-feminine")
        self.assertIsNone(metrics.advanced.glideSmoothness)


class TrillTests(unittest.TestCase):
    def test_28hz_am_is_detected_with_rate_near_28(self):
        sig = synth_vowel(150, FORMANTS, dur=1.4, seed=21)
        t = np.arange(sig.size) / FS
        am = (1.0 + 0.8 * np.cos(2 * math.pi * 28.0 * t)).astype(np.float32)
        trilled = (sig * am)
        trilled = (trilled / (np.max(np.abs(trilled)) + 1e-9) * 0.9).astype(np.float32)
        adv = offline_metrics(trilled).advanced
        self.assertTrue(adv.trillDetected)
        self.assertIsNotNone(adv.trillRateHz)
        self.assertGreaterEqual(adv.trillRateHz, 24.0)
        self.assertLessEqual(adv.trillRateHz, 32.0)
        self.assertIsNotNone(adv.trillDurationMs)
        self.assertGreaterEqual(adv.trillDurationMs, 500)

    def test_flat_tone_is_not_detected(self):
        adv = offline_metrics(synth_vowel(150, FORMANTS, dur=1.4, seed=22)).advanced
        self.assertIsNotNone(adv.trillDetected)
        self.assertFalse(adv.trillDetected)
        self.assertIsNone(adv.trillRateHz)
        self.assertIsNone(adv.trillDurationMs)

    def test_live_frame_rate_cannot_cover_band_so_nulls(self):
        # ~16 fps (64 ms hop) puts 15-45 Hz beyond Nyquist: analysis must
        # decline (null), not fabricate a rate.
        live = [make_frame(i * 64, 200.0, rms=0.05) for i in range(40)]
        adv = A.build_attempt_metrics(live, "everyday-feminine").advanced
        self.assertIsNone(adv.trillDetected)
        self.assertIsNone(adv.trillRateHz)
        self.assertIsNone(adv.trillDurationMs)


class F2RangeTests(unittest.TestCase):
    def test_range_is_max_minus_min(self):
        self.assertEqual(A._f2_range_hz([1400.0, 1800.0, 1650.0]), 400.0)

    def test_null_under_three_windows(self):
        self.assertIsNone(A._f2_range_hz([1400.0, 1800.0]))
        self.assertIsNone(A._f2_range_hz([]))

    def test_vowel_audio_surfaces_a_range(self):
        adv = offline_metrics(synth_vowel(150, FORMANTS, dur=1.4, seed=23)).advanced
        self.assertIsNotNone(adv.formantLite)
        self.assertIsNotNone(adv.f2RangeHz)
        self.assertGreaterEqual(adv.f2RangeHz, 0.0)
        self.assertLess(adv.f2RangeHz, 2000.0)


class PitchCeilingTests(unittest.TestCase):
    def test_clamped_series_flags_ceiling(self):
        # 10% of voiced frames pinned within 2 Hz of the 400 Hz clamp.
        frames = [make_frame(i * 10, 250.0) for i in range(90)]
        frames += [make_frame((90 + i) * 10, 399.5) for i in range(10)]
        metrics = A.build_attempt_metrics(frames, "everyday-feminine")
        self.assertTrue(metrics.advanced.hitPitchCeiling)

    def test_mid_band_series_does_not_flag(self):
        frames = [make_frame(i * 10, 250.0) for i in range(100)]
        metrics = A.build_attempt_metrics(frames, "everyday-feminine")
        self.assertIsNotNone(metrics.advanced.hitPitchCeiling)
        self.assertFalse(metrics.advanced.hitPitchCeiling)

    def test_null_without_voiced_frames(self):
        frames = [make_frame(i * 10, 0.0, voiced=False) for i in range(20)]
        metrics = A.build_attempt_metrics(frames, "everyday-feminine")
        self.assertIsNone(metrics.advanced.hitPitchCeiling)


class AnalysisProfileTests(unittest.TestCase):
    def test_normalizer(self):
        self.assertEqual(A.normalize_analysis_profile("no_formants"), "no_formants")
        self.assertEqual(A.normalize_analysis_profile(" NO_FORMANTS "), "no_formants")
        self.assertEqual(A.normalize_analysis_profile("standard"), "standard")
        self.assertEqual(A.normalize_analysis_profile("garbage"), "standard")
        self.assertEqual(A.normalize_analysis_profile(None), "standard")

    def test_end_request_default_is_standard(self):
        # Older callers that omit the field must deserialize unchanged.
        self.assertEqual(VoiceSessionEndRequest().analysisProfile, "standard")

    def test_standard_profile_is_byte_identical_to_default(self):
        sig = synth_vowel(165, FORMANTS, dur=1.4, seed=31)
        timeline = A.build_timeline_from_samples(
            sig, "everyday-feminine", FS, A.ANALYSIS_FRAME_SIZE, A.ANALYSIS_HOP_SIZE
        )
        without = A.build_attempt_metrics(
            timeline, "everyday-feminine", raw_samples=sig, sample_rate=FS,
            frame_size=A.ANALYSIS_HOP_SIZE,
        )
        explicit = A.build_attempt_metrics(
            timeline, "everyday-feminine", raw_samples=sig, sample_rate=FS,
            frame_size=A.ANALYSIS_HOP_SIZE, analysis_profile="standard",
        )
        self.assertEqual(without.model_dump(), explicit.model_dump())
        self.assertEqual(without.advanced.analysisProfile, "standard")

    def test_no_formants_nulls_formant_fields_and_keeps_the_rest(self):
        """Formant-DERIVED fields go null; non-formant measurements are
        unchanged. resonance/weight/similarity composites are deliberately NOT
        asserted equal: without LPC they take the documented spectral/pitch
        fallback (the same degraded mode an LPC failure produces)."""
        sig = synth_vowel(165, FORMANTS, dur=1.4, seed=32)
        live = A.build_timeline_from_samples(
            sig, "everyday-feminine", FS, A.LIVE_FRAME_SIZE, A.LIVE_FRAME_SIZE
        )
        std = A.build_attempt_summary(
            "s", "everyday-feminine", live, 1400, raw_samples=sig, sample_rate=FS,
        )
        gated = A.build_attempt_summary(
            "s", "everyday-feminine", live, 1400, raw_samples=sig, sample_rate=FS,
            analysis_profile="no_formants",
        )
        std_adv = std.metrics.advanced
        gated_adv = gated.metrics.advanced
        # formant-derived: present under standard, null under no_formants
        self.assertIsNotNone(std_adv.formantLite)
        self.assertIsNotNone(std_adv.f2RangeHz)
        self.assertIsNone(gated_adv.formantLite)
        self.assertIsNone(gated_adv.f2RangeHz)
        # profile echoed both ways
        self.assertEqual(std_adv.analysisProfile, "standard")
        self.assertEqual(gated_adv.analysisProfile, "no_formants")
        # everything non-formant is identical
        self.assertEqual(std.metrics.meanPitchHz, gated.metrics.meanPitchHz)
        self.assertEqual(std.metrics.pitchRangeSt, gated.metrics.pitchRangeSt)
        self.assertEqual(std_adv.medianPitchHz, gated_adv.medianPitchHz)
        self.assertEqual(std_adv.pitchStdSt, gated_adv.pitchStdSt)
        self.assertEqual(std_adv.meanLoudnessDb, gated_adv.meanLoudnessDb)
        self.assertEqual(std_adv.snrDb, gated_adv.snrDb)
        self.assertEqual(std_adv.noiseFloorDb, gated_adv.noiseFloorDb)
        self.assertEqual(std_adv.clippingPct, gated_adv.clippingPct)
        self.assertEqual(std_adv.captureReliability, gated_adv.captureReliability)
        self.assertEqual(std_adv.glideSmoothness, gated_adv.glideSmoothness)
        self.assertEqual(std_adv.trillDetected, gated_adv.trillDetected)
        self.assertEqual(std_adv.hitPitchCeiling, gated_adv.hitPitchCeiling)
        self.assertEqual(std_adv.spectralCentroidMeanHz, gated_adv.spectralCentroidMeanHz)
        self.assertEqual(std_adv.spectralTiltMeanDbPerOct, gated_adv.spectralTiltMeanDbPerOct)
        self.assertIsNotNone(std_adv.quality)
        self.assertIsNotNone(gated_adv.quality)
        self.assertEqual(std_adv.quality.cppsLike, gated_adv.quality.cppsLike)
        self.assertEqual(std_adv.quality.jitterLocal, gated_adv.quality.jitterLocal)
        self.assertEqual(std_adv.quality.shimmerLocal, gated_adv.quality.shimmerLocal)


if __name__ == "__main__":
    unittest.main()
