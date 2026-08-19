"""Regression tests for the 2026-06 DSP/voice-copy correctness fixes.

These lock in behaviour that previously regressed silently:
  A1  NaN/Inf never serialize as invalid JSON
  A2  formant extraction recovers F1/F2 on clean vowels (was dropping them)
  A3  harmonicStrength (HNR) is gain-invariant and tracks noise
  B1  an attempt re-analyzed from raw PCM matches the reference path
  B2  clipped windows do not feed the quality estimators
  C1  the attempt signal carries the (preset or reference-derived) target bands

Signals are synthesized with numpy only (no scipy); formant ground truth comes
from a source-filter vowel synthesizer.
"""
from __future__ import annotations

import json
import math
from pathlib import Path
import unittest

import numpy as np

from src.services import audio_analysis as A
from src.services.contracts import (
    ReferenceAnalysisResponse,
    VoiceAttemptAdvancedMetrics,
    VoiceAttemptMetrics,
    VoiceAttemptSummary,
    VoiceTargetProfile,
    sanitize_non_finite,
)
from src.services.storage import model_to_dict

FS = A.SAMPLE_RATE

# 2026-07-30 MTF-ONLY. Every "for every preset" census in this file iterates the
# LIVE ids out of `A.TARGET_PROFILES` — the single source of truth for the
# offered set — instead of restating them. The previous hardcoded table went
# stale the moment "androgynous"/"gender-neutral" were retired, and worse, a
# preset added ONLY to the analyzer would have been skipped in silence.
LIVE_PRESETS = tuple(sorted(A.TARGET_PROFILES))

# A derived census is only as good as its non-emptiness: were the source of truth
# ever emptied, every `for preset in LIVE_PRESETS` loop would pass by iterating
# nothing — vacuously green, and worse than the hardcoded list it replaces. The
# JS side hit exactly this trap and guards it the same way
# (backend/voice-direction-parity.test.js readDspCanon).
assert len(LIVE_PRESETS) >= 5, (
    f"expected the live preset set to be non-trivial, got {LIVE_PRESETS!r}"
)

# The MTF-only product law, stated INDEPENDENTLY of the table under test. It is
# deliberately NOT derived from `TARGET_PROFILES[...].direction`: deriving it
# would turn every `assertEqual(target.direction, ...)` below into a tautology
# comparing the table to itself. Written out here, those assertions still fail if
# any preset is given a direction the product no longer supports.
MTF_ONLY_DIRECTION = "feminine"

# Every preset id the product has retired, swept as one list so the next
# retirement inherits the guard rather than needing a new test.
RETIRED_PRESETS = (
    # Retired 2026-07-26 with the masculinizing direction.
    "masculine",
    "masc-deep",
    "masc-natural",
    "masc-warm",
    "masc-bright",
    # Retired 2026-07-30 with the neutral direction (MTF-only narrowing).
    "androgynous",
    "gender-neutral",
)


def _wav_fixture_dir() -> Path:
    """Locate the gateway backend WAV fixtures from either DSP tree.

    The suite runs from two roots: the app repo (services/voice-trainer, where
    parents[3] is the transvoice-app root) and the deployed VoiceTrainer tree
    (where parents[3] is ~/Desktop). Candidates, in order: VOICE_FIXTURES_DIR
    env, the app-repo-relative path, the canonical app-repo absolute path.
    """
    import os

    candidates = []
    env_dir = os.environ.get("VOICE_FIXTURES_DIR")
    if env_dir:
        candidates.append(Path(env_dir))
    candidates.append(Path(__file__).resolve().parents[3] / "backend/tests/fixtures")
    candidates.append(
        Path.home() / "Desktop/solane/transvoice-app/backend/tests/fixtures"
    )
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError("backend WAV fixtures not found; set VOICE_FIXTURES_DIR")


def synth_vowel(f0, formants, dur=1.4, fs=FS, noise_db=None, gain=1.0, seed=0):
    """Source-filter vowel: harmonics shaped by a 2-pole resonator cascade."""
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
    sig = sig / (np.max(np.abs(sig)) + 1e-9)
    if noise_db is not None:
        power = float(np.mean(sig * sig))
        noise_power = power / (10 ** (noise_db / 10))
        sig = sig + rng.normal(0, math.sqrt(noise_power), n)
    sig = sig / (np.max(np.abs(sig)) + 1e-9) * 0.9 * gain
    return sig.astype(np.float32)


VOWELS = {
    "/a/": (730, [(730, 70), (1090, 90), (2440, 120)]),
    "/i/": (270, [(270, 60), (2290, 110), (3010, 140)]),
    "/u/": (300, [(300, 60), (870, 80), (2240, 110)]),
    "/e/": (530, [(530, 70), (1840, 100), (2480, 120)]),
}


def _harmonic_strength(sig):
    timeline = A.build_timeline_from_samples(
        sig, "everyday-feminine", FS, A.ANALYSIS_FRAME_SIZE, A.ANALYSIS_HOP_SIZE
    )
    metrics = A.build_attempt_metrics(
        timeline, "everyday-feminine", raw_samples=sig, sample_rate=FS,
        frame_size=A.ANALYSIS_HOP_SIZE,
    )
    return metrics.advanced.quality.harmonicStrength


class FormantRecoveryTests(unittest.TestCase):
    def test_f1_recovered_on_all_vowels(self):
        # The old LPC order (10) + 40 Hz bandwidth floor dropped F1/F2 entirely
        # on clean vowels. F1 must now be recovered within tolerance on each.
        for name, (f0, formants) in VOWELS.items():
            sig = synth_vowel(f0, formants)
            f1s = []
            for start in range(0, len(sig) - A.ANALYSIS_FRAME_SIZE, A.ANALYSIS_HOP_SIZE):
                w = sig[start:start + A.ANALYSIS_FRAME_SIZE].astype(np.float64)
                w = w - w.mean()
                if math.sqrt(float(np.mean(w * w))) < A.MIN_VOICED_RMS:
                    continue
                f1, _f2 = A._estimate_lpc_formants(w, FS)
                if f1 is not None:
                    f1s.append(f1)
            self.assertGreater(len(f1s), 10, f"{name}: no F1 windows recovered")
            true_f1 = formants[0][0]
            self.assertLess(
                abs(float(np.median(f1s)) - true_f1), 90.0,
                f"{name}: F1 {np.median(f1s):.0f} far from true {true_f1}",
            )


class HnrTests(unittest.TestCase):
    def test_harmonic_strength_is_gain_invariant(self):
        formants = [(650, 80), (1200, 90), (2600, 120)]
        loud = _harmonic_strength(synth_vowel(165, formants, gain=1.0, seed=1))
        quiet = _harmonic_strength(synth_vowel(165, formants, gain=0.04, seed=1))
        self.assertIsNotNone(loud)
        self.assertIsNotNone(quiet)
        # Same voice at 1/25th the level must read the same HNR (old code swung
        # by >10 dB because it mixed an RMS energy term into the measure).
        self.assertLess(abs(loud - quiet), 1.0)

    def test_harmonic_strength_tracks_noise(self):
        formants = [(650, 80), (1200, 90), (2600, 120)]
        clean = _harmonic_strength(synth_vowel(165, formants, seed=2))
        noisy = _harmonic_strength(synth_vowel(165, formants, noise_db=5, seed=2))
        self.assertGreater(clean, noisy + 3.0)

    def test_hnr_survives_smoothing_and_leading_silence(self):
        t = np.arange(FS, dtype=np.float32) / FS
        tone = (0.3 * np.sin(2 * np.pi * 180.0 * t)).astype(np.float32)

        def analyze(signal):
            timeline = A.build_timeline_from_samples(
                signal,
                "everyday-feminine",
                FS,
                A.ANALYSIS_FRAME_SIZE,
                A.ANALYSIS_HOP_SIZE,
            )
            voiced_hnr = [
                frame.advanced.harmonicNoiseRatioDb
                for frame in timeline
                if frame.voiced and frame.advanced is not None
            ]
            metrics = A.build_attempt_metrics(
                timeline,
                "everyday-feminine",
                raw_samples=signal,
                sample_rate=FS,
                frame_size=A.ANALYSIS_HOP_SIZE,
            )
            return voiced_hnr, metrics.advanced.quality.harmonicStrength

        direct_hnr, direct_strength = analyze(tone)
        delayed_hnr, delayed_strength = analyze(
            np.concatenate([np.zeros(int(0.2 * FS), dtype=np.float32), tone])
        )
        self.assertGreater(len(direct_hnr), 20)
        self.assertGreater(len(delayed_hnr), 20)
        self.assertTrue(all(value is not None for value in direct_hnr))
        self.assertTrue(all(value is not None for value in delayed_hnr))
        self.assertAlmostEqual(direct_strength, delayed_strength, delta=0.5)


class NanSanitizationTests(unittest.TestCase):
    def test_non_finite_never_reaches_json(self):
        advanced = VoiceAttemptAdvancedMetrics(
            meanLoudnessDb=float("nan"), spectralTiltMeanDbPerOct=float("inf")
        )
        metrics = VoiceAttemptMetrics(
            meanPitchHz=float("nan"), pitchRangeSt=2.0, resonanceMean=0.5,
            weightMean=0.5, targetHitPct=0.4, similarityScore=0.6, advanced=advanced,
        )
        summary = VoiceAttemptSummary(
            voiceSessionId="x", durationMs=1000, targetPreset="cute-feminine",
            metrics=metrics,
        )
        payload = model_to_dict(summary)
        # Would raise ValueError if any NaN/Inf survived.
        json.dumps(payload, allow_nan=False)
        self.assertIsNone(payload["metrics"]["meanPitchHz"])
        self.assertIsNone(payload["metrics"]["advanced"]["meanLoudnessDb"])

    def test_sanitizer_preserves_finite_and_nests(self):
        out = sanitize_non_finite({"a": 1.5, "b": float("nan"), "c": [1.0, float("inf")]})
        self.assertEqual(out["a"], 1.5)
        self.assertIsNone(out["b"])
        self.assertEqual(out["c"], [1.0, None])


def _reference_from(sig):
    timeline = A.build_timeline_from_samples(
        sig, "everyday-feminine", FS, A.ANALYSIS_FRAME_SIZE, A.ANALYSIS_HOP_SIZE
    )
    metrics = A.build_attempt_metrics(
        timeline, "everyday-feminine", raw_samples=sig, sample_rate=FS,
        frame_size=A.ANALYSIS_HOP_SIZE,
    )
    return ReferenceAnalysisResponse(
        clipId="c", filename="r.wav", durationMs=int(len(sig) * 1000 / FS),
        targetPreset="everyday-feminine", metrics=metrics,
        timeline=A.compress_timeline(timeline),
        analysisVersion=A.VOICE_ANALYSIS_VERSION,
    )


class ParityTests(unittest.TestCase):
    def test_attempt_matches_reference_on_same_audio(self):
        sig = synth_vowel(165, [(650, 80), (1200, 90), (2600, 120)], seed=3)
        ref = _reference_from(sig)
        # Feed the same audio as a live attempt; build_attempt_summary must
        # re-analyze from raw PCM at the reference's resolution.
        live = A.build_timeline_from_samples(
            sig, "everyday-feminine", FS, A.LIVE_FRAME_SIZE, A.LIVE_FRAME_SIZE
        )
        summary = A.build_attempt_summary(
            "s", "everyday-feminine", live, 1400, raw_samples=sig, sample_rate=FS,
        )
        self.assertAlmostEqual(
            summary.metrics.meanPitchHz, ref.metrics.meanPitchHz, delta=2.0
        )
        self.assertAlmostEqual(
            summary.metrics.advanced.quality.breathyRisk,
            ref.metrics.advanced.quality.breathyRisk, delta=0.03,
        )


class ClippingGateTests(unittest.TestCase):
    def test_clipped_windows_are_rejected(self):
        formants = [(650, 80), (1200, 90), (2600, 120)]
        clean = synth_vowel(165, formants, seed=4)
        clipped = np.clip(clean * 6.0, -1.0, 1.0).astype(np.float32)
        voiced = [
            f for f in A.build_timeline_from_samples(
                clean, "everyday-feminine", FS, A.ANALYSIS_FRAME_SIZE, A.ANALYSIS_HOP_SIZE
            ) if f.voiced
        ]
        clean_windows = A._sample_analysis_windows(clean, voiced, FS)
        clipped_windows = A._sample_analysis_windows(clipped, voiced, FS)
        self.assertGreater(len(clean_windows), 10)
        self.assertLess(len(clipped_windows), len(clean_windows) // 2)


class AttemptTargetTests(unittest.TestCase):
    def test_custom_timbre_coaching_follows_exact_coordinate_side(self):
        # STRENGTHENED 2026-07-30: this profile used to declare
        # `direction="neutral"`, a value no live preset can carry since the
        # androgynous / gender-neutral retirement. Declaring "feminine" instead
        # is not cosmetic — it makes the test STRICTLY harder. The bands below
        # (resonance 0.1-0.3, weight 0.6-0.8) are the opposite shape to the
        # feminine lane's own semantics, so the "resonance 0.4 -> darker" and
        # "weight 0.5 -> fuller" assertions can only pass if the EXACT bands
        # outrank the direction. Under the old "neutral" label the direction
        # happened to agree with the bands, which hid that.
        profile = A.VoiceTargetProfile(
            name="grounded-custom",
            pitch_floor_hz=100.0,
            pitch_ceiling_hz=140.0,
            min_target_hit_pct=0.3,
            min_resonance_mean=0.3,
            max_weight_mean=0.6,
            min_pitch_range_st=1.8,
            min_similarity_score=0.55,
            direction="feminine",
            resonance_floor=0.1,
            resonance_ceiling=0.3,
            weight_floor=0.6,
            weight_ceiling=0.8,
            source="custom-handmade",
        )
        resonance_low = A._timbre_band_coaching_message("resonance", 0.05, profile)
        resonance_high = A._timbre_band_coaching_message("resonance", 0.4, profile)
        weight_low = A._timbre_band_coaching_message("weight", 0.5, profile)
        weight_high = A._timbre_band_coaching_message("weight", 0.9, profile)
        self.assertIn("brighter", resonance_low[0])
        self.assertIn("darker", resonance_high[0])
        self.assertIn("fuller", weight_low[0])
        self.assertIn("lighter", weight_high[0])

    def test_preset_target_bands_and_deltas(self):
        attempt = synth_vowel(150, [(650, 80), (1300, 90), (2700, 120)], seed=5)
        live = A.build_timeline_from_samples(
            attempt, "everyday-feminine", FS, A.LIVE_FRAME_SIZE, A.LIVE_FRAME_SIZE
        )
        summary = A.build_attempt_summary(
            "s", "everyday-feminine", live, 1400, raw_samples=attempt, sample_rate=FS,
        )
        target = summary.target
        self.assertIsNotNone(target)
        self.assertEqual(target.source, "preset")
        self.assertEqual(
            target.pitchFloorHz,
            A.get_target_profile("everyday-feminine").pitch_floor_hz,
        )
        # A ~150 Hz voice is below the feminine floor.
        self.assertEqual(target.pitchPlacement, "below")
        self.assertLess(target.pitchGapHz, 0.0)

    def test_voice_copy_target_is_reference_derived(self):
        attempt = synth_vowel(150, [(650, 80), (1300, 90), (2700, 120)], seed=6)
        ref = _reference_from(synth_vowel(215, [(700, 80), (1500, 90), (2800, 120)], seed=7))
        live = A.build_timeline_from_samples(
            attempt, "everyday-feminine", FS, A.LIVE_FRAME_SIZE, A.LIVE_FRAME_SIZE
        )
        summary = A.build_attempt_summary(
            "s", "everyday-feminine", live, 1400, reference_analysis=ref,
            raw_samples=attempt, sample_rate=FS,
        )
        target = summary.target
        self.assertEqual(target.source, "reference")
        self.assertIsNotNone(target.referenceMeanPitchHz)
        # Bands come from the reference voice, not the static preset.
        self.assertAlmostEqual(
            target.referenceMeanPitchHz, ref.metrics.meanPitchHz, delta=1.0
        )
        self.assertEqual(target.pitchPlacement, "below")

    def test_handmade_target_profile_is_the_scoring_authority(self):
        # Deliberately far from the everyday-feminine base preset. If the
        # custom profile is dropped at any call seam, this take scores in-band
        # instead of below and the test fails.
        custom = VoiceTargetProfile(
            profileId="custom-profile-low",
            clipId="custom-preset-low",
            sourceFilename="Low custom target",
            durationMs=0,
            targetPreset="everyday-feminine",
            metrics=VoiceAttemptMetrics(
                meanPitchHz=130.0,
                pitchRangeSt=3.0,
                resonanceMean=0.2,
                weightMean=0.7,
                targetHitPct=1.0,
                similarityScore=1.0,
            ),
            pitchFloorHz=120.0,
            pitchCeilingHz=140.0,
            resonanceFloor=0.10,
            resonanceCeiling=0.30,
            weightFloor=0.60,
            weightCeiling=0.80,
            stylePrompt="A deliberately low test target.",
        )
        attempt = synth_vowel(
            205,
            [(650, 80), (1300, 90), (2700, 120)],
            seed=16,
        )
        live = A.build_timeline_from_samples(
            attempt,
            "everyday-feminine",
            FS,
            A.LIVE_FRAME_SIZE,
            A.LIVE_FRAME_SIZE,
            target_voice_profile=custom,
        )
        summary = A.build_attempt_summary(
            "s-custom",
            "everyday-feminine",
            live,
            1400,
            raw_samples=attempt,
            sample_rate=FS,
            target_voice_profile=custom,
            target_source="custom-handmade",
        )
        self.assertEqual(summary.target.source, "custom-handmade")
        self.assertEqual(summary.target.targetProfileId, custom.profileId)
        self.assertEqual(summary.target.pitchFloorHz, 120.0)
        self.assertEqual(summary.target.pitchCeilingHz, 140.0)
        self.assertEqual(summary.target.resonanceFloor, 0.10)
        self.assertEqual(summary.target.resonanceCeiling, 0.30)
        self.assertEqual(summary.target.weightFloor, 0.60)
        self.assertEqual(summary.target.weightCeiling, 0.80)
        self.assertEqual(summary.target.pitchPlacement, "above")

    def test_reference_bands_outrank_the_base_presets_thresholds(self):
        # RENAMED + RE-POINTED 2026-07-30 (was
        # `test_neutral_reference_uses_directional_band_endpoints`; itself
        # re-pointed 2026-07-26 from the masculine lane onto the neutral one,
        # which the MTF-only narrowing has now retired).
        #
        # The clause that died is "whatever the base preset's coordinate-side
        # semantics are" — there is only one coordinate side left. The property
        # that SURVIVES is the one that clause was evidence for: a
        # REFERENCE-derived target scores against the reference voice's own
        # bands, never against the base preset's thresholds. Nothing else covers
        # it — `test_voice_copy_target_is_reference_derived` checks source and
        # pitch only, and `test_handmade_target_profile_is_the_scoring_authority`
        # covers the CUSTOM path, not `build_target_voice_profile`.
        #
        # This is NOT a feminine copy that trivially passes. The fixture is a
        # dark (resonance 0.20) and heavy (weight 0.70) reference voice, which
        # VIOLATES the everyday-feminine floor (0.24) and ceiling (0.46) on both
        # axes, so the base preset's semantics would place it out of band on
        # both. Measured 2026-07-30 by dropping the exact bands and letting
        # `_target_timbre_bands` answer from the preset: resonanceGap -0.04,
        # weightGap -0.24, i.e. RED. The two assertions marked TEETH below pin
        # that departure explicitly instead of relying on the fixture numbers
        # staying inconvenient by luck.
        base_preset = "everyday-feminine"
        base = A.get_target_profile(base_preset)
        timeline = [
            A.VoiceFrame(
                t=index * 10,
                voiced=True,
                pitchHz=125.0,
                pitchScore=0.9,
                resonanceScore=0.20,
                weightScore=0.70,
                confidence=0.9,
                loudnessDb=-20.0,
            )
            for index in range(100)
        ]
        ref_metrics = VoiceAttemptMetrics(
            meanPitchHz=125.0,
            pitchRangeSt=2.5,
            resonanceMean=0.20,
            weightMean=0.70,
            targetHitPct=0.8,
            similarityScore=1.0,
        )
        ref = ReferenceAnalysisResponse(
            clipId="dark-heavy-ref",
            filename="dark-heavy.wav",
            durationMs=1500,
            targetPreset=base_preset,
            metrics=ref_metrics,
            timeline=timeline,
            analysisVersion=A.VOICE_ANALYSIS_VERSION,
        )
        target_voice_profile = A.build_target_voice_profile(ref, base_preset)

        # TEETH: the derived band must genuinely DEPART from the base preset's
        # thresholds on both axes. Without this, zero gaps below could be
        # satisfied by a target that silently fell back to the preset.
        self.assertLess(target_voice_profile.resonanceFloor, base.min_resonance_mean)
        self.assertGreater(target_voice_profile.weightCeiling, base.max_weight_mean)

        profile = A._resolve_target_profile(
            base_preset,
            target_voice_profile,
            source="reference",
        )
        target = A._build_attempt_target(
            profile,
            base_preset,
            ref,
            ref_metrics,
            target_voice_profile=target_voice_profile,
        )
        self.assertEqual(target.source, "reference")
        self.assertEqual(target.resonanceGap, 0.0)
        self.assertEqual(target.weightGap, 0.0)


class PitchContractTests(unittest.TestCase):
    @staticmethod
    def _harmonic_signal(
        frequency_hz,
        sample_count,
        *,
        noise_db=None,
        seed=0,
        first_harmonic=1,
    ):
        time = np.arange(sample_count, dtype=np.float64) / FS
        signal = sum(
            (1.0 / harmonic)
            * np.sin(
                2.0 * math.pi * harmonic * frequency_hz * time
                + (0.13 * harmonic)
            )
            for harmonic in range(first_harmonic, 7)
        )
        if noise_db is not None:
            rms = math.sqrt(float(np.mean(signal * signal)))
            noise_rms = rms / (10.0 ** (float(noise_db) / 20.0))
            signal = signal + np.random.default_rng(seed).normal(
                0.0, noise_rms, sample_count
            )
        peak = max(float(np.max(np.abs(signal))), 1e-9)
        return (signal / peak * 0.65).astype(np.float32)

    @staticmethod
    def _pitch_error_cents(actual_hz, expected_hz):
        return abs(1200.0 * math.log2(float(actual_hz) / float(expected_hz)))

    def test_yin_sweep_covers_every_custom_target_pitch_without_octave_aliases(self):
        for noise_db in (None, 20.0):
            for frequency_hz in range(80, 401, 5):
                signal = self._harmonic_signal(
                    frequency_hz,
                    A.ANALYSIS_FRAME_SIZE,
                    noise_db=noise_db,
                    seed=(frequency_hz * 10) + int(noise_db or 0),
                )
                measured_hz, strength = A._estimate_pitch(signal, FS)
                self.assertIsNotNone(
                    measured_hz,
                    f"no pitch at {frequency_hz} Hz, noise_db={noise_db}, strength={strength}",
                )
                self.assertLessEqual(
                    self._pitch_error_cents(measured_hz, frequency_hz),
                    25.0,
                    f"pitch alias at {frequency_hz} Hz, noise_db={noise_db}: {measured_hz}",
                )

    def test_finalized_timeline_has_dense_coverage_at_domain_edges(self):
        for frequency_hz in (80, 85, 90, 200, 300, 370, 380, 390, 400):
            signal = self._harmonic_signal(frequency_hz, int(0.4 * FS))
            timeline = A.build_timeline_from_samples(
                signal,
                "everyday-feminine",
                FS,
                A.ANALYSIS_FRAME_SIZE,
                A.ANALYSIS_HOP_SIZE,
                analysis_profile=A.ANALYSIS_PROFILE_NO_FORMANTS,
            )
            voiced = [frame.pitchHz for frame in timeline if frame.voiced]
            coverage = len(voiced) / max(len(timeline), 1)
            self.assertGreaterEqual(
                coverage,
                0.95,
                f"voiced coverage at {frequency_hz} Hz was {coverage:.3f}",
            )
            median_hz = float(np.median(np.asarray(voiced)))
            self.assertLessEqual(
                self._pitch_error_cents(median_hz, frequency_hz),
                25.0,
                f"median pitch at {frequency_hz} Hz was {median_hz}",
            )

    def test_live_frames_share_the_full_pitch_contract(self):
        for frequency_hz in (80, 90, 200, 300, 380, 400):
            signal = self._harmonic_signal(frequency_hz, A.LIVE_FRAME_SIZE)
            frame = A.analyze_pcm_frame(
                signal,
                "everyday-feminine",
                0,
                FS,
                analysis_profile=A.ANALYSIS_PROFILE_NO_FORMANTS,
            )
            self.assertTrue(frame.voiced, f"live {frequency_hz} Hz frame was unvoiced")
            self.assertLessEqual(
                self._pitch_error_cents(frame.pitchHz, frequency_hz),
                25.0,
                f"live pitch at {frequency_hz} Hz was {frame.pitchHz}",
            )

    def test_missing_fundamental_does_not_create_an_octave_error(self):
        for first_harmonic in (2, 3):
            for frequency_hz in (80, 100, 180, 300, 380, 400):
                signal = self._harmonic_signal(
                    frequency_hz,
                    A.ANALYSIS_FRAME_SIZE,
                    first_harmonic=first_harmonic,
                )
                measured_hz, _ = A._estimate_pitch(signal, FS)
                self.assertIsNotNone(measured_hz)
                self.assertLessEqual(
                    self._pitch_error_cents(measured_hz, frequency_hz),
                    50.0,
                    f"missing-fundamental alias at {frequency_hz} Hz: {measured_hz}",
                )

    def test_out_of_domain_low_pitch_rejects_and_high_pitch_saturates_honestly(self):
        for frequency_hz in (75, 78):
            signal = self._harmonic_signal(frequency_hz, A.ANALYSIS_FRAME_SIZE)
            measured_hz, _ = A._estimate_pitch(signal, FS)
            self.assertIsNone(measured_hz)

        high_signal = self._harmonic_signal(420, int(0.4 * FS))
        timeline = A.build_timeline_from_samples(
            high_signal,
            "bright-playful",
            FS,
            A.ANALYSIS_FRAME_SIZE,
            A.ANALYSIS_HOP_SIZE,
            analysis_profile=A.ANALYSIS_PROFILE_NO_FORMANTS,
        )
        voiced = [frame.pitchHz for frame in timeline if frame.voiced]
        self.assertTrue(voiced)
        self.assertTrue(all(value == A.MAX_PITCH_HZ for value in voiced))
        metrics = A.build_attempt_metrics(
            timeline,
            "bright-playful",
            raw_samples=high_signal,
            sample_rate=FS,
            frame_size=A.ANALYSIS_HOP_SIZE,
            analysis_profile=A.ANALYSIS_PROFILE_NO_FORMANTS,
        )
        self.assertTrue(metrics.advanced.hitPitchCeiling)

    def test_white_noise_remains_measurement_unavailable(self):
        noise = np.random.default_rng(20260720).normal(0.0, 0.12, FS).astype(np.float32)
        timeline = A.build_timeline_from_samples(
            noise,
            "everyday-feminine",
            FS,
            A.ANALYSIS_FRAME_SIZE,
            A.ANALYSIS_HOP_SIZE,
            analysis_profile=A.ANALYSIS_PROFILE_NO_FORMANTS,
        )
        metrics = A.build_attempt_metrics(
            timeline,
            "everyday-feminine",
            raw_samples=noise,
            sample_rate=FS,
            frame_size=A.ANALYSIS_HOP_SIZE,
            analysis_profile=A.ANALYSIS_PROFILE_NO_FORMANTS,
        )
        self.assertFalse(metrics.advanced.measurementAvailable)
        self.assertEqual(metrics.advanced.pitchValidFrameCount, 0)

    def test_every_voiced_fixture_pitch_respects_declared_bounds(self):
        # WIDENED 2026-07-30: was one call passing the retired "gender-neutral"
        # id, where the preset was only ever a label — MIN/MAX_PITCH_HZ is the
        # global analyzer contract, not a per-preset band. Now a census over
        # every live preset, so no preset can be added with a tracker
        # configuration that emits out-of-contract pitch.
        fixture = _wav_fixture_dir() / "clean_male_osr_16k.wav"
        with __import__("wave").open(str(fixture), "rb") as wav_file:
            samples = np.frombuffer(
                wav_file.readframes(wav_file.getnframes()), dtype="<i2"
            ).astype(np.float32) / 32768.0
        for preset in LIVE_PRESETS:
            with self.subTest(preset=preset):
                timeline = A.build_timeline_from_samples(
                    samples,
                    preset,
                    FS,
                    A.ANALYSIS_FRAME_SIZE,
                    A.ANALYSIS_HOP_SIZE,
                )
                voiced = [frame.pitchHz for frame in timeline if frame.voiced]
                self.assertGreater(len(voiced), 100)
                self.assertTrue(
                    all(A.MIN_PITCH_HZ <= value <= A.MAX_PITCH_HZ for value in voiced),
                    f"out-of-contract pitches: {[v for v in voiced if not A.MIN_PITCH_HZ <= v <= A.MAX_PITCH_HZ][:8]}",
                )

    def test_pitch_range_ignores_single_octave_outlier(self):
        def frame(t, pitch):
            return A.VoiceFrame(
                t=t,
                voiced=True,
                pitchHz=pitch,
                pitchScore=1.0,
                resonanceScore=0.3,
                weightScore=0.4,
                confidence=0.9,
                loudnessDb=-20.0,
                advanced=A.VoiceFrameAdvancedMetrics(
                    pitchConfidence=0.9,
                    voicedProbability=0.9,
                    rms=0.1,
                    harmonicRatio=0.8,
                    harmonicNoiseRatioDb=20.0,
                    stabilityScore=0.9,
                ),
            )

        contour = [frame(index * 10, 200.0) for index in range(100)]
        with_outlier = [*contour]
        with_outlier[50] = frame(500, 400.0)
        baseline = A.build_attempt_metrics(contour, "everyday-feminine")
        outlier = A.build_attempt_metrics(with_outlier, "everyday-feminine")
        self.assertAlmostEqual(outlier.pitchRangeSt, baseline.pitchRangeSt, delta=0.2)


class MeasurementValidityTests(unittest.TestCase):
    def test_no_voice_is_explicitly_unavailable(self):
        silence = np.zeros(FS, dtype=np.float32)
        timeline = A.build_timeline_from_samples(
            silence,
            "everyday-feminine",
            FS,
            A.ANALYSIS_FRAME_SIZE,
            A.ANALYSIS_HOP_SIZE,
        )
        metrics = A.build_attempt_metrics(
            timeline,
            "everyday-feminine",
            raw_samples=silence,
            sample_rate=FS,
            frame_size=A.ANALYSIS_HOP_SIZE,
        )
        self.assertFalse(metrics.advanced.measurementAvailable)
        self.assertIn("no_voiced_frames", metrics.advanced.measurementRejectionReasons)
        self.assertEqual(metrics.advanced.pitchValidFrameCount, 0)

    def test_noisy_and_clipped_captures_cannot_emit_voice_corrections(self):
        for filename, expected_reason, expected_issue in (
            ("noisy_low_snr_male_16k.wav", "low_snr", "Background noise"),
            (
                "clipped_hot_input_male_16k.wav",
                "sustained_clipping",
                "microphone clipped",
            ),
        ):
            fixture = _wav_fixture_dir() / filename
            samples = A.decode_audio_file_to_samples(fixture, FS)
            timeline = A.build_timeline_from_samples(
                samples,
                "everyday-feminine",
                FS,
                A.ANALYSIS_FRAME_SIZE,
                A.ANALYSIS_HOP_SIZE,
                analysis_profile=A.ANALYSIS_PROFILE_NO_FORMANTS,
            )
            summary = A.build_attempt_summary(
                "capture-contract",
                "everyday-feminine",
                timeline,
                int(round(samples.size * 1000 / FS)),
                raw_samples=None,
                sample_rate=FS,
                analysis_profile=A.ANALYSIS_PROFILE_NO_FORMANTS,
            )
            self.assertIn(
                expected_reason,
                summary.metrics.advanced.measurementRejectionReasons,
            )
            self.assertTrue(
                any(expected_issue in issue for issue in summary.issues),
                summary.issues,
            )
            self.assertFalse(
                any(
                    token in " ".join(summary.issues).lower()
                    for token in (
                        "pitch floor",
                        "resonance",
                        "vocal weight",
                        "airy",
                        "squeezed",
                    )
                ),
                summary.issues,
            )


class JitterShimmerTests(unittest.TestCase):
    def _pulse_voice(self, f0, dur, jitter, seed):
        # impulse train with controlled period jitter, formant-filtered
        rng = np.random.default_rng(seed)
        T0 = FS / f0
        n = int(dur * FS)
        src = np.zeros(n)
        t = 0.0
        while t < n:
            idx = int(round(t))
            if 0 <= idx < n:
                src[idx] = 1.0
            t += max(T0 * (1.0 + jitter * rng.standard_normal()), T0 * 0.5)
        tt = np.arange(int(0.03 * FS)) / FS
        ir = sum(
            np.exp(-math.pi * bw * tt) * np.sin(2 * math.pi * fc * tt)
            for fc, bw in [(700, 80), (1200, 90), (2600, 120)]
        )
        sig = np.convolve(src, ir)[:n]
        return (sig / (np.max(np.abs(sig)) + 1e-9) * 0.9).astype(np.float64)

    def test_jitter_tracks_injected_not_noise_floored(self):
        # The old amplitude-peak method floored at ~3% jitter even for a nearly
        # clean voice; period-synchronous tracking must read low-jitter as low.
        low = self._pulse_voice(160, 1.5, 0.003, seed=1)
        high = self._pulse_voice(160, 1.5, 0.03, seed=1)
        jl_low, _, _ = A._estimate_jitter(low, FS, 160.0, [(0, low.size)])
        jl_high, _, _ = A._estimate_jitter(high, FS, 160.0, [(0, high.size)])
        self.assertIsNotNone(jl_low)
        self.assertIsNotNone(jl_high)
        self.assertLess(jl_low, 0.015)
        self.assertGreater(jl_high, jl_low * 2.0)

    def test_perturbation_does_not_straddle_region_gaps(self):
        a = self._pulse_voice(160, 0.8, 0.005, seed=2)
        b = self._pulse_voice(160, 0.8, 0.005, seed=3)
        gap = np.zeros(int(0.25 * FS))
        two = np.concatenate([a, gap, b])
        regions = [(0, a.size), (a.size + gap.size, a.size + gap.size + b.size)]
        # RAP measured per-region must not fabricate deviation at the silence seam.
        _, rap, _ = A._estimate_jitter(two, FS, 160.0, regions)
        self.assertIsNotNone(rap)
        self.assertLess(rap, 0.02)


class TargetDirectionContractTests(unittest.TestCase):
    """The preset registry's direction contract and its rejection contract.

    RENAMED 2026-07-30 from `BidirectionalTargetTests`. The name described an
    axis that no longer exists: with the masculinizing (2026-07-26) and neutral
    (2026-07-30) directions both retired, "feminine" is the only direction a
    preset can carry, so nothing here is bidirectional. What the class still
    pins, and what a one-direction product makes MORE important rather than less:

      * every LIVE preset feminizes and embeds its own metric contract,
      * every RETIRED preset is rejected exactly like an id that never existed,
      * the direction helpers read one-sided (floor/ceiling) bands, not centred
        ones — the property that actually distinguished the retired lane,
      * the same take scores differently against different targets.

    The census set is derived from `A.TARGET_PROFILES` (see LIVE_PRESETS); the
    expected direction is NOT (see MTF_ONLY_DIRECTION).
    """

    def _summary(self, sig, preset):
        live = A.build_timeline_from_samples(
            sig, preset, FS, A.LIVE_FRAME_SIZE, A.LIVE_FRAME_SIZE
        )
        return A.build_attempt_summary(
            "s", preset, live, 1500, raw_samples=sig, sample_rate=FS
        )

    def test_every_live_preset_round_trips_through_the_enum(self):
        # REPLACES `test_new_presets_registered` (2026-07-30). That test asserted
        # the two NEUTRAL presets were registered and normalized to themselves —
        # a claim the MTF-only narrowing inverts, since both are now rejected
        # (see test_retired_presets_are_gone_and_fail_closed below).
        #
        # The shape worth keeping is the round-trip: every id the registry offers
        # must survive `normalize_target_preset` unchanged, so the offered set and
        # the accepted set cannot drift apart. Derived, so a preset added to
        # TARGET_PROFILES without a normalizer path breaks this immediately
        # instead of waiting for someone to list it here.
        for name in LIVE_PRESETS:
            with self.subTest(preset=name):
                self.assertIn(name, A.TARGET_PROFILES)
                self.assertEqual(A.normalize_target_preset(name), name)
        # The empty/None default must land INSIDE the live set, not on a retired
        # id — the one substitution the normalizer is still allowed to make.
        self.assertIn(A.normalize_target_preset(None), LIVE_PRESETS)
        self.assertIn(A.normalize_target_preset(""), LIVE_PRESETS)

    def test_retired_presets_are_gone_and_fail_closed(self):
        # WIDENED 2026-07-30 (was
        # `test_retired_masculinizing_presets_are_gone_and_fail_closed`). The
        # registry must not carry a retired preset, and normalize_target_preset
        # must keep REJECTING it rather than silently substituting a feminine
        # target (the house fail-closed law). A removed preset is a removed
        # preset whichever direction it left with, so the neutral retirement
        # (androgynous, gender-neutral) is swept by the SAME list as the
        # masculinizing one — see RETIRED_PRESETS.
        for name in RETIRED_PRESETS:
            with self.subTest(preset=name):
                self.assertNotIn(name, A.TARGET_PROFILES)
                with self.assertRaises(ValueError):
                    A.normalize_target_preset(name)
                # ...and identically to an id that never existed at all: same
                # exception type from the same choke point, no aliasing.
                with self.assertRaises(ValueError):
                    A.get_target_profile(name)
        with self.assertRaises(ValueError):
            A.normalize_target_preset("not-a-preset-at-all")

        # NARROWED 2026-07-30. This loop used to accept
        # `("feminine", "neutral")`, which kept passing after the retirement
        # while permitting a direction no preset may carry — green, but too
        # permissive to catch a neutral profile being re-added. It is now pinned
        # to the single live direction.
        for name, profile in A.TARGET_PROFILES.items():
            self.assertEqual(profile.direction, MTF_ONLY_DIRECTION, name)

    def test_every_builtin_preset_embeds_its_canonical_metric_contract(self):
        # DERIVED 2026-07-30: the census used to iterate a hardcoded
        # EXPECTED_DIRECTIONS table and assert `set(TARGET_PROFILES) ==
        # set(EXPECTED_DIRECTIONS)`. Both halves of that went stale on the
        # retirement. It now iterates LIVE_PRESETS, so the set can never desync.
        #
        # The expected DIRECTION is still stated independently
        # (MTF_ONLY_DIRECTION) rather than read back out of the profile: deriving
        # it too would make the direction assertion below compare the table to
        # itself and it could never fail.
        #
        # VACUITY FIXED 2026-07-30. The band assertions used to compare
        # `target.resonanceFloor` against `A._target_timbre_bands(profile)` — the
        # very call `_build_attempt_target` makes internally — so they compared
        # the code to itself and could not fail. Proved by mutation: swapping
        # `_target_timbre_bands` back to the retired CENTRED expansion left this
        # test GREEN. The expected bands are now written out from the profile's
        # own threshold fields, which is the contract those fields DECLARE, and
        # the same mutation now turns it red.
        for preset in LIVE_PRESETS:
            expected_direction = MTF_ONLY_DIRECTION
            with self.subTest(preset=preset):
                profile = A.get_target_profile(preset)
                # The one-sided expansion, stated independently of the helper:
                # resonance is a FLOOR up to 1.0, weight a CEILING down from 0.0.
                resonance_floor = profile.min_resonance_mean
                resonance_ceiling = 1.0
                weight_floor = 0.0
                weight_ceiling = profile.max_weight_mean
                metrics = VoiceAttemptMetrics(
                    meanPitchHz=(profile.pitch_floor_hz + profile.pitch_ceiling_hz) / 2.0,
                    pitchRangeSt=profile.min_pitch_range_st,
                    resonanceMean=(resonance_floor + resonance_ceiling) / 2.0,
                    weightMean=(weight_floor + weight_ceiling) / 2.0,
                    targetHitPct=profile.min_target_hit_pct,
                    similarityScore=profile.min_similarity_score,
                )
                target = A._build_attempt_target(profile, preset, None, metrics)

                self.assertEqual(target.source, "preset")
                self.assertEqual(target.targetPreset, preset)
                self.assertEqual(target.direction, expected_direction)
                self.assertEqual(target.pitchFloorHz, profile.pitch_floor_hz)
                self.assertEqual(target.pitchCeilingHz, profile.pitch_ceiling_hz)
                self.assertEqual(target.resonanceFloor, round(resonance_floor, 3))
                self.assertEqual(target.resonanceCeiling, round(resonance_ceiling, 3))
                self.assertEqual(target.weightFloor, round(weight_floor, 3))
                self.assertEqual(target.weightCeiling, round(weight_ceiling, 3))
                self.assertEqual(target.pitchPlacement, "in_band")
                self.assertEqual(target.resonanceGap, 0.0)
                self.assertEqual(target.weightGap, 0.0)

                # ...and the gap arithmetic must actually MEASURE, not just
                # report 0. A midpoint metric is in-band whatever the band shape
                # is, so the zero-gaps above are cheap on their own; these two
                # out-of-band probes are what make the census cost something.
                below = A._build_attempt_target(
                    profile,
                    preset,
                    None,
                    metrics.model_copy(
                        update={
                            "meanPitchHz": profile.pitch_floor_hz - 10.0,
                            "resonanceMean": max(0.0, resonance_floor - 0.05),
                            "weightMean": min(1.0, weight_ceiling + 0.05),
                        }
                    ),
                )
                self.assertEqual(below.pitchPlacement, "below")
                self.assertLess(below.pitchGapHz, 0.0)
                # Signs are the module's historical convention: resonance
                # negative = darker than the floor, weight negative = heavier
                # than the ceiling.
                self.assertLess(below.resonanceGap, 0.0)
                self.assertLess(below.weightGap, 0.0)

                above = A._build_attempt_target(
                    profile,
                    preset,
                    None,
                    metrics.model_copy(
                        update={"meanPitchHz": profile.pitch_ceiling_hz + 10.0}
                    ),
                )
                self.assertEqual(above.pitchPlacement, "above")
                self.assertGreater(above.pitchGapHz, 0.0)

    def test_exact_custom_target_bands_override_every_base_preset_lane(self):
        # DERIVED 2026-07-30 (was iterating the hardcoded EXPECTED_DIRECTIONS).
        # The exact bands below are deliberately a DARK, HEAVY, LOW target that
        # every live feminine preset's own thresholds would reject, so a base
        # preset leaking into the result shows up as a non-zero gap.
        for preset in LIVE_PRESETS:
            expected_direction = MTF_ONLY_DIRECTION
            with self.subTest(preset=preset):
                custom = VoiceTargetProfile(
                    profileId=f"custom-{preset}",
                    clipId=f"clip-{preset}",
                    sourceFilename=f"{preset} handmade",
                    durationMs=0,
                    targetPreset=preset,
                    metrics=VoiceAttemptMetrics(
                        meanPitchHz=130.0,
                        pitchRangeSt=3.0,
                        resonanceMean=0.31,
                        weightMean=0.69,
                        targetHitPct=1.0,
                        similarityScore=1.0,
                    ),
                    pitchFloorHz=121.0,
                    pitchCeilingHz=139.0,
                    resonanceFloor=0.21,
                    resonanceCeiling=0.41,
                    weightFloor=0.59,
                    weightCeiling=0.79,
                    stylePrompt="Exact test target.",
                )
                profile = A._resolve_target_profile(
                    preset,
                    custom,
                    source="custom-handmade",
                )
                target = A._build_attempt_target(
                    profile,
                    preset,
                    None,
                    custom.metrics,
                    target_voice_profile=custom,
                )

                self.assertEqual(target.source, "custom-handmade")
                self.assertEqual(target.targetProfileId, custom.profileId)
                self.assertEqual(target.direction, expected_direction)
                self.assertEqual(target.pitchFloorHz, 121.0)
                self.assertEqual(target.pitchCeilingHz, 139.0)
                self.assertEqual(target.resonanceFloor, 0.21)
                self.assertEqual(target.resonanceCeiling, 0.41)
                self.assertEqual(target.weightFloor, 0.59)
                self.assertEqual(target.weightCeiling, 0.79)
                self.assertEqual(target.pitchPlacement, "in_band")
                self.assertEqual(target.resonanceGap, 0.0)
                self.assertEqual(target.weightGap, 0.0)

    def test_scoring_follows_the_selected_target(self):
        # RE-POINTED 2026-07-30 (previously gender-neutral vs bright-playful;
        # itself re-pointed 2026-07-26 from "masculine scores a deep voice above
        # feminine"). The guarantee is direction-independent and survives intact:
        # the SAME take scores differently against different targets, because
        # scoring is target-relative and not a fixed "brighter is better".
        #
        # It does not need two directions to have teeth, only two different pitch
        # bands. everyday-feminine floors at 168 Hz and bright-playful at 198 Hz,
        # so a 115 Hz take is below both but much nearer the former. Measured
        # 2026-07-30: similarity 0.047 vs 0.018, a 2.6x spread. Make scoring
        # ignore the selected preset and the two collapse to equal -> RED.
        deep = synth_vowel(115, [(480, 70), (1000, 90), (2200, 120)], seed=1)
        nearer = self._summary(deep, "everyday-feminine")
        further = self._summary(deep, "bright-playful")
        self.assertLess(
            A.get_target_profile("everyday-feminine").pitch_floor_hz,
            A.get_target_profile("bright-playful").pitch_floor_hz,
        )
        self.assertGreater(
            nearer.metrics.similarityScore, further.metrics.similarityScore
        )
        self.assertEqual(nearer.target.direction, MTF_ONLY_DIRECTION)
        self.assertEqual(nearer.target.pitchPlacement, "below")
        self.assertEqual(further.target.pitchPlacement, "below")

    # DELETED 2026-07-30 — `test_neutral_coaching_is_band_relative_not_a_
    # feminizing_register` (re-pointed 2026-07-26 from "masculine coaching is not
    # feminine-worded", so this was its second retirement).
    #
    # It proved that resonance coaching copy follows which SIDE of the target band
    # the take fell on: a take BELOW a band-centred neutral target earns
    # "brighter", and a take ABOVE it must earn "darker" and must never say
    # "brighter". That two-sidedness was possible only because a neutral target
    # expanded a threshold into a CENTRED band, so a take could overshoot it.
    #
    # Both androgynous and gender-neutral were removed on 2026-07-30, and with
    # them the centred band. Every live preset's resonance band is one-sided —
    # `_target_timbre_bands` returns (floor, 1.0) — so a built-in target CANNOT be
    # overshot on resonance and the "above-band earns darker" half is unreachable.
    # Measured 2026-07-30 on soft-feminine with the same bright 215 Hz fixture:
    # the coaching text comes back "intonation stayed flat; ..." with no resonance
    # clause at all, so a feminine re-point would have had to drop the half that
    # carried the actual guarantee and keep only the trivially-true "below-band
    # earns brighter" half.
    #
    # NOT LOST: both sides are still covered, and better, by
    # `AttemptTargetTests.test_custom_timbre_coaching_follows_exact_coordinate_side`
    # — a CUSTOM profile can carry an exact two-sided band, so it exercises
    # brighter/darker AND fuller/lighter against real band edges.

    def test_soft_feminine_is_more_inclusive_than_bright(self):
        # Cultural inclusivity: a darker feminine voice (resonance ~0.28, e.g. an
        # Indian-English female who is higher-pitched but not bright) should meet
        # the soft-feminine target but NOT the bright Australian one.
        soft = A.get_target_profile("soft-feminine")
        bright = A.get_target_profile("australian-bright-feminine")
        self.assertEqual(soft.direction, "feminine")
        self.assertEqual(bright.direction, "feminine")
        self.assertLess(soft.min_resonance_mean, bright.min_resonance_mean)
        self.assertTrue(A._resonance_meets_target(0.28, soft))
        self.assertFalse(A._resonance_meets_target(0.28, bright))

    def test_direction_helpers_read_one_sided_bands_not_centred_ones(self):
        # RECAST 2026-07-30 (was `test_direction_helpers_respect_target`; itself
        # re-pointed 2026-07-26 off the masculine column). It compared a feminine
        # against a neutral preset to show the helpers read the target's
        # direction. With the neutral lane retired there is no second column to
        # compare against, and a two-FEMININE-preset re-point would only restate
        # `test_soft_feminine_is_more_inclusive_than_bright` below.
        #
        # So the axis moves from "one direction vs the other" to "one-sided vs
        # CENTRED", which is what the two directions actually differed by, and
        # becomes a census over every live preset.
        #
        # The load-bearing assertion is the unbounded-bright one: a maximally
        # bright voice must ALWAYS satisfy a floor. That is exactly what a
        # re-introduced centred band (threshold +- 0.14) would break, and it is
        # not asserted anywhere else. Same for weight at the light extreme.
        for preset in LIVE_PRESETS:
            with self.subTest(preset=preset):
                profile = A.get_target_profile(preset)
                resonance_floor, resonance_ceiling, weight_floor, weight_ceiling = (
                    A._target_timbre_bands(profile)
                )
                # The band really is the one-sided expansion of the threshold.
                self.assertEqual(resonance_floor, profile.min_resonance_mean)
                self.assertEqual(resonance_ceiling, 1.0)
                self.assertEqual(weight_floor, 0.0)
                self.assertEqual(weight_ceiling, profile.max_weight_mean)

                # Resonance is a FLOOR: no amount of brightness is "too much"...
                self.assertTrue(A._resonance_meets_target(1.0, profile))
                self.assertTrue(
                    A._resonance_meets_target(profile.min_resonance_mean, profile)
                )
                # ...and anything under it misses.
                self.assertFalse(
                    A._resonance_meets_target(profile.min_resonance_mean - 0.01, profile)
                )

                # Weight is a CEILING: no amount of lightness is "too little"...
                self.assertTrue(A._weight_meets_target(0.0, profile))
                self.assertTrue(
                    A._weight_meets_target(profile.max_weight_mean, profile)
                )
                # ...and anything over it misses.
                self.assertFalse(
                    A._weight_meets_target(profile.max_weight_mean + 0.01, profile)
                )

    def test_helpers_disagree_across_presets_so_they_read_the_selected_target(self):
        # ADDED 2026-07-30 to keep the half of the retired
        # `test_direction_helpers_respect_target` that the census above does not
        # cover: that the helpers read the SELECTED target rather than one shared
        # global threshold. The censuses are per-preset and would all still pass
        # if every preset collapsed onto identical bands.
        widest = min(LIVE_PRESETS, key=lambda p: A.get_target_profile(p).min_resonance_mean)
        narrowest = max(LIVE_PRESETS, key=lambda p: A.get_target_profile(p).min_resonance_mean)
        wide = A.get_target_profile(widest)
        narrow = A.get_target_profile(narrowest)
        self.assertLess(wide.min_resonance_mean, narrow.min_resonance_mean)
        # A resonance between the two floors must split them.
        between = (wide.min_resonance_mean + narrow.min_resonance_mean) / 2.0
        self.assertTrue(A._resonance_meets_target(between, wide), widest)
        self.assertFalse(A._resonance_meets_target(between, narrow), narrowest)


# ── D1  absence is not the worst case (2026-07-26) ──────────────────────────
#
# The bug: _build_quality_metrics coerced every missing input with
# `float(x or 0.0)`. Because 0 dB CPPS and 0 dB HNR are the WORST possible
# readings, a take whose audio could not be measured picked up
#   0.45 * clamp((6 - 0)/12) + 0.35 * clamp((10 - 0)/8) = 0.225 + 0.35 = 0.575
# of breathy risk manufactured entirely from missing data — well over the
# 0.22 profile-capped warn band, so live coaching nagged "breathy" on takes it
# had never actually measured.
#
# The rule these tests lock in: a risk score is emitted ONLY from real
# measurements. Missing terms are dropped and the surviving weights are
# renormalized; if nothing informative survives, the risk is None.


def _old_breathy_risk(harmonic_strength, cpps_like, spectral_tilt):
    """The pre-fix formula, verbatim, for parity checking on complete inputs."""
    tilt_magnitude = abs(min(float(spectral_tilt or 0.0), 0.0))
    return A.clamp(
        (0.45 * A.clamp((6.0 - float(harmonic_strength or 0.0)) / 12.0))
        + (0.35 * A.clamp((10.0 - float(cpps_like or 0.0)) / 8.0))
        + (0.20 * A.clamp((tilt_magnitude - 10.0) / 12.0))
    )


def _old_strain_risk(harmonic_strength, spectral_tilt, clipping, stability):
    """The pre-fix formula, verbatim, for parity checking on complete inputs."""
    return A.clamp(
        (0.40 * A.clamp((float(harmonic_strength or 0.0) - 10.0) / 12.0))
        + (0.25 * A.clamp((float(spectral_tilt or -12.0) + 10.0) / 8.0))
        + (0.20 * A.clamp((float(clipping or 0.0) - 0.005) / 0.04))
        + (0.15 * A.clamp((0.60 - float(stability or 0.0)) / 0.30))
    )


class NullInputRiskTests(unittest.TestCase):
    """D1a/D1b/D1c — renormalize over measured terms; never score absence."""

    def _quality(self, windows=None, **kwargs):
        params = dict(
            analysis_windows=windows or [],
            sample_rate=FS,
            spectral_tilt_mean=None,
            harmonic_ratio_mean=None,
            stability_mean=None,
            clipping_mean=None,
            harmonic_strength_db=None,
        )
        params.update(kwargs)
        return A._build_quality_metrics(**params)

    # (a) both direct noise measures missing → no verdict at all.
    def test_both_inputs_null_gives_no_breathy_risk(self):
        quality = self._quality(
            spectral_tilt_mean=-14.0,  # present, but tilt alone proves nothing
            harmonic_ratio_mean=0.30,  # level-dependent: must NOT rescue the term
            stability_mean=0.72,
            clipping_mean=0.0,
            harmonic_strength_db=None,  # no gain-invariant HNR
        )
        self.assertIsNotNone(quality)
        self.assertIsNone(quality.cppsLike)
        self.assertIsNone(
            quality.breathyRisk,
            "unmeasurable audio must not produce a breathy verdict",
        )
        # The specific floor the old code manufactured from two nulls alone:
        #   0.45 * clamp((6-0)/12) + 0.35 * clamp((10-0)/8) = 0.225 + 0.35
        self.assertAlmostEqual(_old_breathy_risk(None, None, None), 0.575, places=6)

    def test_harmonic_ratio_fallback_is_quarantined_from_risk(self):
        """The legacy harmonic_ratio→HNR fallback is level-dependent, so it may
        feed the surfaced display field but never a risk score."""
        quiet = self._quality(harmonic_ratio_mean=0.05, spectral_tilt_mean=-14.0)
        loud = self._quality(harmonic_ratio_mean=0.95, spectral_tilt_mean=-14.0)
        # The surfaced field keeps the fallback (display continuity)…
        self.assertIsNotNone(quiet.harmonicStrength)
        self.assertIsNotNone(loud.harmonicStrength)
        self.assertLess(quiet.harmonicStrength, loud.harmonicStrength)
        # …but neither drives a risk, because neither is a real HNR.
        self.assertIsNone(quiet.breathyRisk)
        self.assertIsNone(loud.breathyRisk)

    def test_strain_needs_a_voice_derived_term(self):
        # Tilt + clipping are capture-chain properties; alone they prove nothing.
        # (harmonic_ratio_mean only materializes the surfaced display field.)
        only_capture = self._quality(
            spectral_tilt_mean=-2.0, clipping_mean=0.09, harmonic_ratio_mean=0.4
        )
        self.assertIsNone(only_capture.strainRisk)
        # Stability alone is enough to emit one.
        with_stability = self._quality(
            spectral_tilt_mean=-2.0,
            clipping_mean=0.09,
            harmonic_ratio_mean=0.4,
            stability_mean=0.30,
        )
        self.assertIsNotNone(with_stability.strainRisk)

    def test_nothing_measurable_at_all_reports_nothing(self):
        """The early-return guard: no field measurable → no quality block."""
        self.assertIsNone(self._quality())
        self.assertIsNone(
            self._quality(spectral_tilt_mean=-2.0, clipping_mean=0.09),
            "tilt+clipping alone are not a quality report",
        )
        # One measurable field is enough to keep the block.
        self.assertIsNotNone(self._quality(harmonic_ratio_mean=0.4))

    # (b) one term missing → the rest renormalize over their own weights.
    def test_null_cpps_renormalizes_over_remaining_weights(self):
        hnr, tilt = 4.0, -26.0
        quality = self._quality(
            harmonic_strength_db=hnr,
            spectral_tilt_mean=tilt,
            stability_mean=0.70,
            clipping_mean=0.0,
        )
        self.assertIsNone(quality.cppsLike)
        harmonic_term = A.clamp((6.0 - hnr) / 12.0)
        tilt_term = A.clamp((abs(min(tilt, 0.0)) - 10.0) / 12.0)
        expected = (0.45 * harmonic_term + 0.20 * tilt_term) / (0.45 + 0.20)
        self.assertAlmostEqual(quality.breathyRisk, round(expected, 3), delta=1e-6)
        # Renormalizing is NOT the same as dropping the term to zero: the old
        # code would have scored the missing CPPS at its worst value instead.
        self.assertNotAlmostEqual(
            quality.breathyRisk, _old_breathy_risk(hnr, None, tilt), delta=1e-3
        )

    def test_null_stability_renormalizes_strain(self):
        hnr, tilt, clip = 18.0, -4.0, 0.02
        quality = self._quality(
            harmonic_strength_db=hnr, spectral_tilt_mean=tilt, clipping_mean=clip
        )
        expected = (
            0.40 * A.clamp((hnr - 10.0) / 12.0)
            + 0.25 * A.clamp((tilt + 10.0) / 8.0)
            + 0.20 * A.clamp((clip - 0.005) / 0.04)
        ) / (0.40 + 0.25 + 0.20)
        self.assertAlmostEqual(quality.strainRisk, round(expected, 3), delta=1e-6)

    # (c) complete inputs → bit-for-bit the same numbers as before the fix.
    def test_complete_inputs_match_the_old_formula(self):
        windows = _voiced_analysis_windows()
        self.assertGreater(len(windows), 4, "need real windows for a real CPPS")
        measured = [A._cpps_like(w, FS) for _, w in windows]
        measured = [v for v in measured if v is not None and v > 0.0]
        self.assertTrue(measured, "the fixture must produce a measurable CPPS")
        cpps_like = A._safe_mean(measured, 0.0)

        grid = [
            (14.0, -18.0, 0.0, 0.80),
            (2.5, -22.5, 0.012, 0.41),
            (-3.0, -6.0, 0.09, 0.22),
            (26.0, -11.0, 0.004, 0.95),
        ]
        for hnr, tilt, clip, stability in grid:
            with self.subTest(hnr=hnr, tilt=tilt):
                quality = A._build_quality_metrics(
                    analysis_windows=windows,
                    sample_rate=FS,
                    spectral_tilt_mean=tilt,
                    harmonic_ratio_mean=0.5,
                    stability_mean=stability,
                    clipping_mean=clip,
                    harmonic_strength_db=hnr,
                )
                self.assertAlmostEqual(quality.cppsLike, round(cpps_like, 2), delta=1e-6)
                self.assertAlmostEqual(
                    quality.breathyRisk,
                    round(_old_breathy_risk(hnr, cpps_like, tilt), 3),
                    delta=1e-6,
                )
                self.assertAlmostEqual(
                    quality.strainRisk,
                    round(_old_strain_risk(hnr, tilt, clip, stability), 3),
                    delta=1e-6,
                )

    def test_blend_is_identity_when_every_term_is_present(self):
        self.assertAlmostEqual(
            A._blend_available_terms([(0.45, 0.2), (0.35, 0.6), (0.20, 0.9)]),
            0.45 * 0.2 + 0.35 * 0.6 + 0.20 * 0.9,
            delta=1e-9,
        )
        self.assertIsNone(A._blend_available_terms([(0.45, None), (0.35, None)]))
        self.assertIsNone(A._blend_available_terms([]))


class UnmeasurableTakeTests(unittest.TestCase):
    """D1d — the end-to-end symptom: no breath nag on unmeasurable audio."""

    def _quality_for(self, signal):
        timeline = A.build_timeline_from_samples(
            signal, "everyday-feminine", FS, A.LIVE_FRAME_SIZE, A.LIVE_FRAME_SIZE
        )
        summary = A.build_attempt_summary(
            "s",
            "everyday-feminine",
            timeline,
            int(len(signal) * 1000 / FS),
            raw_samples=signal,
            sample_rate=FS,
        )
        return summary.metrics.advanced.quality

    def test_silence_and_noise_produce_no_risk_verdict(self):
        rng = np.random.default_rng(11)
        cases = {
            "digital silence": np.zeros(int(FS * 1.2)),
            "muted mic": rng.standard_normal(int(FS * 1.2)) * 1e-5,
            "room noise only": rng.standard_normal(int(FS * 1.2)) * 0.1,
        }
        for name, signal in cases.items():
            with self.subTest(case=name):
                quality = self._quality_for(signal)
                self.assertIsNone(quality.cppsLike)
                self.assertIsNone(
                    quality.breathyRisk, f"{name} must not read as breathy"
                )
                self.assertIsNone(quality.strainRisk, f"{name} must not read as strain")

    def test_real_voice_still_produces_both_risks(self):
        """The fix must narrow, not blank out: measurable audio still scores."""
        signal = synth_vowel(165, [(650, 80), (1200, 90), (2600, 120)], seed=7)
        quality = self._quality_for(signal)
        for field in ("cppsLike", "harmonicStrength", "breathyRisk", "strainRisk"):
            self.assertIsNotNone(getattr(quality, field), f"{field} went missing")
        self.assertGreaterEqual(quality.breathyRisk, 0.0)
        self.assertLessEqual(quality.breathyRisk, 1.0)
        self.assertGreaterEqual(quality.strainRisk, 0.0)
        self.assertLessEqual(quality.strainRisk, 1.0)

    def test_gain_does_not_manufacture_breathiness(self):
        """A quiet mic must not read as breathy.

        Non-regression guard only: on fully measurable takes the gain-invariant
        HNR already drove this term, so this passes pre-fix too. The quarantine
        of the level-dependent fallback is proven by
        NullInputRiskTests.test_harmonic_ratio_fallback_is_quarantined_from_risk,
        which does fail against the old code."""
        formants = [(650, 80), (1200, 90), (2600, 120)]
        loud = self._quality_for(synth_vowel(165, formants, gain=1.0, seed=8))
        quiet = self._quality_for(synth_vowel(165, formants, gain=0.04, seed=8))
        self.assertIsNotNone(loud.breathyRisk)
        self.assertIsNotNone(quiet.breathyRisk)
        self.assertAlmostEqual(quiet.breathyRisk, loud.breathyRisk, delta=0.12)


class QualityBandDerivationTests(unittest.TestCase):
    """D1e — a target band is derived only from a measured metric."""

    def _bands_for(self, quality):
        metrics = VoiceAttemptAdvancedMetrics(quality=quality)
        return A._quality_bands_from_advanced(metrics)

    def test_unmeasured_metrics_yield_no_band(self):
        from src.services.contracts import VoiceAttemptQualityMetrics

        bands = self._bands_for(VoiceAttemptQualityMetrics())
        self.assertIsNone(bands.cppsLikeFloor)
        self.assertIsNone(bands.harmonicStrengthFloor)
        self.assertIsNone(bands.breathyRiskCeiling)
        self.assertIsNone(bands.strainRiskCeiling)

    def test_measured_metrics_still_yield_the_same_bands(self):
        from src.services.contracts import VoiceAttemptQualityMetrics

        bands = self._bands_for(
            VoiceAttemptQualityMetrics(
                cppsLike=12.0, harmonicStrength=16.0, breathyRisk=0.30, strainRisk=0.25
            )
        )
        self.assertAlmostEqual(bands.cppsLikeFloor, 9.8, delta=1e-9)
        self.assertAlmostEqual(bands.harmonicStrengthFloor, 13.0, delta=1e-9)
        self.assertAlmostEqual(bands.breathyRiskCeiling, 0.40, delta=1e-9)
        self.assertAlmostEqual(bands.strainRiskCeiling, 0.35, delta=1e-9)

    def test_partially_measured_metrics_keep_only_what_was_measured(self):
        from src.services.contracts import VoiceAttemptQualityMetrics

        bands = self._bands_for(
            VoiceAttemptQualityMetrics(harmonicStrength=16.0, breathyRisk=None)
        )
        self.assertAlmostEqual(bands.harmonicStrengthFloor, 13.0, delta=1e-9)
        self.assertIsNone(bands.cppsLikeFloor)
        self.assertIsNone(bands.breathyRiskCeiling)
        self.assertIsNone(bands.strainRiskCeiling)


def _voiced_analysis_windows():
    """Real analysis windows from a synthesized vowel (for a real CPPS)."""
    signal = synth_vowel(165, [(650, 80), (1200, 90), (2600, 120)], seed=5)
    voiced = [
        f
        for f in A.build_timeline_from_samples(
            signal, "everyday-feminine", FS, A.ANALYSIS_FRAME_SIZE, A.ANALYSIS_HOP_SIZE
        )
        if f.voiced
    ]
    return A._sample_analysis_windows(signal, voiced, FS)


if __name__ == "__main__":
    unittest.main()
