from __future__ import annotations

from array import array
from io import BytesIO
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import wave

import numpy as np

from src.services.audio_analysis import (
    build_phrase_forecast,
    build_target_voice_profile,
    normalize_target_preset,
    _cpps_like,
)
from src.services.contracts import (
    VOICE_ANALYSIS_VERSION,
    VoiceCustomTargetPresetDuplicateRequest,
    VoiceHandmadeTargetPresetSaveRequest,
    VoiceCustomTargetPresetMutationRequest,
    VoiceReferenceTargetPresetSaveRequest,
    VoiceRepContext,
    VoiceSelfReport,
    VoiceSessionStartRequest,
    VoiceAttemptMetrics,
    VoiceTargetProfile,
)
from src.services.reference_analyzer import ReferenceAnalyzer
from src.services.storage import VoiceStorage
from src.services.streaming_analyzer import StreamingAnalyzer
from src.services.target_preset_library import (
    VoiceTargetPresetCalibrationError,
    VoiceTargetPresetConflictError,
    VoiceTargetPresetLibrary,
)

import src.services.reference_analyzer as reference_module
import src.services.streaming_analyzer as streaming_module


class FakeUpload:
    def __init__(self, filename: str, data: bytes):
        self.filename = filename
        self._data = data

    async def read(self) -> bytes:
        return self._data


def synth_voice_pcm(
    frequencies: list[float],
    seconds_per_frequency: float = 0.16,
    sample_rate: int = 16000,
) -> bytes:
    values = array("h")
    segment_samples = max(1, int(seconds_per_frequency * sample_rate))

    for frequency in frequencies:
        for index in range(segment_samples):
            t = index / sample_rate
            envelope = 0.55 - (
                0.45 * math.cos((2.0 * math.pi * index) / max(segment_samples - 1, 1))
            )
            sample = (
                (0.30 * math.sin(2.0 * math.pi * frequency * t))
                + (0.22 * math.sin(2.0 * math.pi * frequency * 2.0 * t))
                + (0.15 * math.sin(2.0 * math.pi * frequency * 3.0 * t))
                + (0.10 * math.sin(2.0 * math.pi * 1800.0 * t))
                + (0.08 * math.sin(2.0 * math.pi * 2600.0 * t))
            ) * envelope
            sample = max(-0.95, min(0.95, sample))
            values.append(int(sample * 32767))

    return values.tobytes()


def pcm_to_wav_bytes(pcm_bytes: bytes, sample_rate: int = 16000) -> bytes:
    buffer = BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(pcm_bytes)
    return buffer.getvalue()


def build_custom_target_profile(**overrides) -> VoiceTargetProfile:
    payload = {
        "profileId": "custom-asymmetric",
        "clipId": "custom-asymmetric-clip",
        "sourceFilename": "Handmade asymmetric target",
        "durationMs": 0,
        "targetPreset": "everyday-feminine",
        "metrics": VoiceAttemptMetrics(
            meanPitchHz=190.0,
            pitchRangeSt=4.25,
            resonanceMean=0.4,
            weightMean=0.5,
            targetHitPct=1.0,
            similarityScore=1.0,
        ),
        "pitchFloorHz": 121.2345,
        "pitchCeilingHz": 287.6543,
        "resonanceFloor": 0.12345,
        "resonanceCeiling": 0.67891,
        "weightFloor": 0.23456,
        "weightCeiling": 0.78912,
        "stylePrompt": "Asymmetric custom test target",
    }
    payload.update(overrides)
    return VoiceTargetProfile(**payload)


class VoiceServiceTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.storage = VoiceStorage(Path(self.temp_dir.name))

        self._original_stream_storage = streaming_module.voice_storage
        self._original_reference_storage = reference_module.voice_storage
        streaming_module.voice_storage = self.storage
        reference_module.voice_storage = self.storage

        self.streaming_analyzer = StreamingAnalyzer()
        self.reference_analyzer = ReferenceAnalyzer()
        self.target_preset_library = VoiceTargetPresetLibrary(self.storage)

    def tearDown(self) -> None:
        streaming_module.voice_storage = self._original_stream_storage
        reference_module.voice_storage = self._original_reference_storage
        self.temp_dir.cleanup()

    async def test_streaming_session_summary_tracks_frames_and_persists(self) -> None:
        reference_pcm = synth_voice_pcm(
            [208.0, 224.0, 238.0, 252.0], seconds_per_frequency=1.1
        )
        reference_upload = FakeUpload(
            "target-reference.wav", pcm_to_wav_bytes(reference_pcm)
        )
        reference = await self.reference_analyzer.analyze_upload(
            reference_upload, "cute-feminine"
        )

        session = self.streaming_analyzer.start_session(
            VoiceSessionStartRequest(
                sloaneSessionId="sloane-session-1",
                targetPreset="cute-feminine",
                referenceClipId=reference.clipId,
            )
        )

        live_pcm = synth_voice_pcm(
            [210.0, 226.0, 242.0, 256.0], seconds_per_frequency=0.16
        )
        frames = []
        for offset in range(0, len(live_pcm), 2048):
            chunk = live_pcm[offset : offset + 2048]
            frames.append(
                self.streaming_analyzer.register_frame(session.voiceSessionId, chunk)
            )

        self.assertTrue(all(frame is not None for frame in frames))
        self.assertGreater(len(frames), 4)
        self.assertEqual(self.storage.session_count(), 1)

        summary = self.streaming_analyzer.summarize_session(session.voiceSessionId)
        self.assertIsNotNone(summary)
        self.assertEqual(summary.analysisVersion, VOICE_ANALYSIS_VERSION)
        self.assertGreater(summary.durationMs, 0)
        self.assertGreater(summary.metrics.meanPitchHz, 200.0)
        self.assertLess(summary.metrics.meanPitchHz, 265.0)
        self.assertGreater(summary.metrics.pitchRangeSt, 1.5)
        self.assertGreaterEqual(summary.metrics.targetHitPct, 0.0)
        self.assertLessEqual(summary.metrics.targetHitPct, 1.0)
        self.assertGreater(summary.metrics.similarityScore, 0.55)
        self.assertIn(summary.targetPreset, {"cute-feminine"})
        self.assertIsNotNone(summary.metrics.advanced)
        self.assertGreater(summary.metrics.advanced.pitchP10Hz, 0.0)
        self.assertGreaterEqual(summary.metrics.advanced.metricSimilarity, 0.0)
        self.assertLessEqual(summary.metrics.advanced.metricSimilarity, 1.0)
        self.assertIsInstance(summary.metrics.advanced.reliabilityFlags, list)
        self.assertIsNotNone(summary.metrics.advanced.quality)
        self.assertGreater(summary.metrics.advanced.quality.harmonicStrength, -20.0)
        self.assertGreaterEqual(summary.metrics.advanced.quality.breathyRisk, 0.0)
        self.assertLessEqual(summary.metrics.advanced.quality.breathyRisk, 1.0)
        self.assertGreaterEqual(summary.metrics.advanced.quality.strainRisk, 0.0)
        self.assertLessEqual(summary.metrics.advanced.quality.strainRisk, 1.0)
        if summary.metrics.advanced.formantLite is not None:
            self.assertGreater(summary.metrics.advanced.formantLite.f2MedianHz, 1100.0)
            self.assertGreaterEqual(
                summary.metrics.advanced.formantLite.frontnessScore, 0.0
            )
            self.assertLessEqual(
                summary.metrics.advanced.formantLite.frontnessScore, 1.0
            )

        ended = self.streaming_analyzer.end_session(
            session.voiceSessionId,
            reference_clip_id=reference.clipId,
            client_attempt_id="attempt-1",
            rep_context=VoiceRepContext(
                lessonId="lesson-1",
                drillId="cute-vocalise-sustained",
                kind="sustained",
                targetPreset="cute-feminine",
                targetSource="custom-reference",
                referenceClipId=reference.clipId,
                referenceClipName="target-reference.wav",
                forecastPhrase="hello there",
                targetProfileId="profile-1",
                targetProfileSource="target-reference.wav",
                tags=["vocalise", "stability"],
                drill={
                    "id": "cute-vocalise-sustained",
                    "kind": "sustained",
                    "tags": ["vocalise", "stability"],
                },
            ),
            self_report=VoiceSelfReport(
                effort=3,
                strain=2,
                perceivedDifficulty=4,
                confidence=5,
                metadata={"source": "voice-tab-self-report"},
            ),
        )
        self.assertIsNotNone(ended)
        self.assertEqual(ended.status, "ended")
        self.assertIsNotNone(ended.summary)
        self.assertIsNotNone(ended.attemptArtifact)
        self.assertEqual(ended.attemptArtifact.clientAttemptId, "attempt-1")
        self.assertEqual(ended.attemptArtifact.selfReport.effort, 3)
        self.assertEqual(ended.attemptArtifact.selfReport.strain, 2)
        self.assertEqual(
            ended.attemptArtifact.selfReport.metadata["source"], "voice-tab-self-report"
        )
        self.assertEqual(ended.attemptArtifact.repContext.lessonId, "lesson-1")
        self.assertEqual(ended.attemptArtifact.repContext.kind, "sustained")
        self.assertEqual(
            ended.attemptArtifact.repContext.drill["kind"],
            "sustained",
        )
        self.assertEqual(
            ended.attemptArtifact.repContext.targetSource, "custom-reference"
        )
        self.assertEqual(ended.attemptArtifact.repContext.forecastPhrase, "hello there")
        self.assertTrue(ended.attemptArtifact.includesRawAudio)
        retained_audio = self.storage.get_attempt_audio(
            ended.attemptArtifact.attemptArtifactId
        )
        self.assertIsNotNone(retained_audio)
        self.assertTrue(retained_audio.exists())
        self.assertTrue(
            (
                Path(self.temp_dir.name)
                / "summaries"
                / f"{session.voiceSessionId}.json"
            ).exists()
        )
        self.assertTrue(
            (
                Path(self.temp_dir.name)
                / "attempt_artifacts"
                / f"{ended.attemptArtifact.attemptArtifactId}.json"
            ).exists()
        )

    async def test_streaming_session_preserves_handmade_target_profile(self) -> None:
        profile = build_custom_target_profile()
        profile_payload = (
            profile.model_dump(exclude_none=True)
            if hasattr(profile, "model_dump")
            else profile.dict(exclude_none=True)
        )
        session = self.streaming_analyzer.start_session(
            VoiceSessionStartRequest(
                sloaneSessionId="custom-session",
                targetPreset="everyday-feminine",
                targetVoiceProfile=profile_payload,
                targetSource="custom-handmade",
            )
        )
        self.assertEqual(session.targetVoiceProfile.profileId, "custom-asymmetric")
        self.assertEqual(session.targetSource, "custom-handmade")
        expected_bands = {
            "pitchFloorHz": 121.2345,
            "pitchCeilingHz": 287.6543,
            "resonanceFloor": 0.12345,
            "resonanceCeiling": 0.67891,
            "weightFloor": 0.23456,
            "weightCeiling": 0.78912,
        }
        for field_name, expected_value in expected_bands.items():
            self.assertEqual(
                getattr(session.targetVoiceProfile, field_name),
                expected_value,
            )

        pcm = synth_voice_pcm([205.0, 210.0, 215.0], seconds_per_frequency=0.2)
        for offset in range(0, len(pcm), 2048):
            self.streaming_analyzer.register_frame(
                session.voiceSessionId,
                pcm[offset : offset + 2048],
            )
        summary = self.streaming_analyzer.summarize_session(session.voiceSessionId)
        self.assertEqual(summary.target.source, "custom-handmade")
        self.assertEqual(summary.target.targetProfileId, "custom-asymmetric")
        for field_name, expected_value in expected_bands.items():
            self.assertEqual(getattr(summary.target, field_name), expected_value)

        finalized = self.streaming_analyzer.finalize_take(session.voiceSessionId)
        self.assertIsNotNone(finalized.attemptArtifact.target)
        self.assertEqual(finalized.attemptArtifact.target.source, "custom-handmade")
        self.assertEqual(finalized.attemptArtifact.target.direction, "feminine")
        self.assertEqual(
            finalized.attemptArtifact.target.targetProfileId,
            "custom-asymmetric",
        )
        for field_name, expected_value in expected_bands.items():
            self.assertEqual(
                getattr(finalized.attemptArtifact.target, field_name),
                expected_value,
            )
        artifact_path = (
            self.storage.attempt_artifacts_dir
            / f"{finalized.attemptArtifact.attemptArtifactId}.json"
        )
        persisted_artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
        for field_name, expected_value in expected_bands.items():
            self.assertEqual(
                persisted_artifact["target"][field_name],
                expected_value,
            )

    async def test_streaming_reference_target_requires_canonical_stored_profile(
        self,
    ) -> None:
        unverified_profile = build_custom_target_profile(
            profileId="unverified-reference-profile",
            clipId="unverified-reference-clip",
        ).model_dump(exclude_none=True)
        with self.assertLogs(
            "src.services.streaming_analyzer",
            level="WARNING",
        ) as captured_logs:
            with self.assertRaisesRegex(ValueError, "stored trustworthy reference"):
                self.streaming_analyzer.start_session(
                    VoiceSessionStartRequest(
                        sloaneSessionId="unverified-reference-session",
                        targetPreset="everyday-feminine",
                        referenceClipId="unverified-reference-clip",
                        targetVoiceProfile=unverified_profile,
                        targetSource="custom-reference",
                    )
                )
        rejection_log = " ".join(captured_logs.output)
        self.assertIn("reason=missing_reference_analysis", rejection_log)
        self.assertIn("target_source=custom-reference", rejection_log)
        self.assertIn("reference_present=True", rejection_log)
        self.assertIn("profile_present=True", rejection_log)
        self.assertNotIn("unverified-reference-clip", rejection_log)
        self.assertEqual(self.storage.session_count(), 0)

        reference = await self.reference_analyzer.analyze_upload(
            FakeUpload(
                "verified-reference.wav",
                pcm_to_wav_bytes(
                    synth_voice_pcm(
                        [208.0, 224.0, 238.0, 252.0],
                        seconds_per_frequency=1.1,
                    )
                ),
            ),
            "everyday-feminine",
        )
        expected_profile = build_target_voice_profile(
            reference,
            "everyday-feminine",
        )
        tampered_profile = expected_profile.model_dump(exclude_none=True)
        tampered_profile["pitchFloorHz"] += 1.0
        with self.assertRaisesRegex(ValueError, "does not match"):
            self.streaming_analyzer.start_session(
                VoiceSessionStartRequest(
                    sloaneSessionId="tampered-reference-session",
                    targetPreset="everyday-feminine",
                    referenceClipId=reference.clipId,
                    targetVoiceProfile=tampered_profile,
                    targetSource="custom-reference",
                )
            )
        self.assertEqual(self.storage.session_count(), 0)

        exact_session = self.streaming_analyzer.start_session(
            VoiceSessionStartRequest(
                sloaneSessionId="verified-reference-session",
                targetPreset="everyday-feminine",
                referenceClipId=reference.clipId,
                targetVoiceProfile=expected_profile.model_dump(exclude_none=True),
                targetSource="custom-reference",
            )
        )
        self.assertEqual(exact_session.targetSource, "custom-reference")
        self.assertEqual(exact_session.referenceClipId, reference.clipId)
        self.assertEqual(
            exact_session.targetVoiceProfile.model_dump(exclude_none=True),
            expected_profile.model_dump(exclude_none=True),
        )
        self.assertEqual(self.storage.session_count(), 1)

    async def test_streaming_session_rejects_malformed_exact_target_bands(self) -> None:
        profile = build_custom_target_profile()
        valid_payload = profile.model_dump(exclude_none=True)
        invalid_cases = {
            "non_finite_pitch": {"pitchFloorHz": float("nan")},
            "infinite_pitch": {"pitchCeilingHz": float("inf")},
            "pitch_below_tracker": {"pitchFloorHz": 79.99},
            "pitch_above_tracker": {"pitchCeilingHz": 400.01},
            "inverted_pitch": {"pitchFloorHz": 250.0, "pitchCeilingHz": 200.0},
            "resonance_out_of_range": {"resonanceFloor": -0.01},
            "inverted_resonance": {"resonanceFloor": 0.8, "resonanceCeiling": 0.2},
            "weight_out_of_range": {"weightCeiling": 1.01},
            "inverted_weight": {"weightFloor": 0.9, "weightCeiling": 0.1},
            "zero_width_weight": {"weightFloor": 0.5, "weightCeiling": 0.5},
        }

        for case_name, changes in invalid_cases.items():
            with self.subTest(case_name=case_name):
                malformed_payload = {**valid_payload, **changes}
                with self.assertRaises(ValueError):
                    self.streaming_analyzer.start_session(
                        VoiceSessionStartRequest(
                            sloaneSessionId=f"malformed-{case_name}",
                            targetPreset="everyday-feminine",
                            targetVoiceProfile=malformed_payload,
                            targetSource="custom-handmade",
                        )
                    )

    async def test_self_report_rejects_out_of_range_scores(self) -> None:
        with self.assertRaises(ValueError):
            VoiceSelfReport(effort=6)

    async def test_reference_analysis_generates_timeline_and_saved_artifacts(
        self,
    ) -> None:
        upload_bytes = pcm_to_wav_bytes(
            synth_voice_pcm(
                [214.0, 228.0, 246.0, 236.0, 252.0], seconds_per_frequency=0.22
            )
        )
        upload = FakeUpload(
            "reference clip.wav",
            upload_bytes,
        )
        analysis = await self.reference_analyzer.analyze_upload(
            upload, "bright-playful"
        )

        self.assertEqual(analysis.filename, "reference clip.wav")
        self.assertEqual(analysis.targetPreset, "bright-playful")
        self.assertEqual(analysis.analysisVersion, VOICE_ANALYSIS_VERSION)
        self.assertGreater(len(analysis.timeline), 20)
        self.assertGreater(analysis.durationMs, 0)
        self.assertGreater(analysis.metrics.meanPitchHz, 205.0)
        self.assertGreater(analysis.metrics.pitchRangeSt, 2.0)
        self.assertGreaterEqual(analysis.metrics.similarityScore, 0.0)
        self.assertLessEqual(analysis.metrics.similarityScore, 1.0)
        self.assertIsNotNone(analysis.metrics.advanced)
        self.assertGreater(analysis.metrics.advanced.voicedFramePct, 0.0)
        self.assertGreater(
            analysis.metrics.advanced.pitchP90Hz, analysis.metrics.advanced.pitchP10Hz
        )
        self.assertIsNotNone(analysis.metrics.advanced.formantLite)
        self.assertGreater(analysis.metrics.advanced.formantLite.f2MedianHz, 1100.0)
        self.assertGreaterEqual(
            analysis.metrics.advanced.formantLite.frontnessScore, 0.0
        )
        self.assertLessEqual(analysis.metrics.advanced.formantLite.frontnessScore, 1.0)
        self.assertIsNotNone(analysis.metrics.advanced.quality)
        self.assertGreater(analysis.metrics.advanced.quality.cppsLike, 0.0)
        self.assertGreater(analysis.metrics.advanced.quality.harmonicStrength, -20.0)
        self.assertGreaterEqual(analysis.metrics.advanced.quality.breathyRisk, 0.0)
        self.assertLessEqual(analysis.metrics.advanced.quality.breathyRisk, 1.0)
        self.assertGreaterEqual(analysis.metrics.advanced.quality.strainRisk, 0.0)
        self.assertLessEqual(analysis.metrics.advanced.quality.strainRisk, 1.0)
        self.assertEqual(self.storage.reference_count(), 1)

        saved_analysis = self.storage.get_reference(analysis.clipId)
        self.assertIsNotNone(saved_analysis)
        self.assertEqual(saved_analysis.clipId, analysis.clipId)
        self.assertEqual(
            saved_analysis.metrics.similarityScore, analysis.metrics.similarityScore
        )

        stored_audio_path = self.storage.get_reference_file_path(analysis.clipId)
        self.assertIsNotNone(stored_audio_path)
        self.assertEqual(stored_audio_path.read_bytes(), upload_bytes)

        raw_files = list(
            (Path(self.temp_dir.name) / "references" / "raw").glob(
                f"{analysis.clipId}_*"
            )
        )
        self.assertEqual(len(raw_files), 1)

    async def test_target_profile_and_phrase_forecast_follow_reference_shape(
        self,
    ) -> None:
        upload = FakeUpload(
            "idol-reference.wav",
            pcm_to_wav_bytes(
                synth_voice_pcm(
                    [214.0, 228.0, 246.0, 236.0, 252.0], seconds_per_frequency=0.9
                )
            ),
        )
        analysis = await self.reference_analyzer.analyze_upload(
            upload, "bright-playful"
        )
        profile = build_target_voice_profile(analysis, "bright-playful")
        self.storage.save_target_profile(profile)

        self.assertEqual(profile.clipId, analysis.clipId)
        self.assertEqual(profile.targetPreset, "bright-playful")
        self.assertEqual(profile.analysisVersion, VOICE_ANALYSIS_VERSION)
        self.assertIn("Pitch center sits around", profile.notes[0])
        self.assertIn("intonation", profile.stylePrompt.lower())
        self.assertIsNotNone(profile.advancedBands)
        self.assertGreater(profile.advancedBands.pitchP10HzFloor, 0.0)
        self.assertIsNotNone(profile.advancedBands.formantLite)
        self.assertGreater(profile.advancedBands.formantLite.f2FloorHz, 1100.0)
        self.assertGreaterEqual(profile.advancedBands.formantLite.frontnessFloor, 0.0)
        self.assertLessEqual(profile.advancedBands.formantLite.frontnessFloor, 1.0)
        self.assertIsNotNone(profile.advancedBands.quality)
        self.assertGreater(profile.advancedBands.quality.cppsLikeFloor, 0.0)
        self.assertGreater(profile.advancedBands.quality.harmonicStrengthFloor, -20.0)
        self.assertGreaterEqual(profile.advancedBands.quality.breathyRiskCeiling, 0.0)
        self.assertLessEqual(profile.advancedBands.quality.breathyRiskCeiling, 1.0)
        self.assertGreaterEqual(profile.advancedBands.quality.strainRiskCeiling, 0.0)
        self.assertLessEqual(profile.advancedBands.quality.strainRiskCeiling, 1.0)

        forecast = build_phrase_forecast(profile, "Could you say that again?")
        voiced = [frame for frame in forecast.timeline if frame.voiced]

        self.assertEqual(forecast.profileId, profile.profileId)
        self.assertEqual(forecast.targetPreset, "bright-playful")
        self.assertEqual(forecast.analysisVersion, VOICE_ANALYSIS_VERSION)
        self.assertGreater(len(voiced), 4)
        self.assertGreater(forecast.estimatedDurationMs, 500)
        self.assertGreater(forecast.metrics.meanPitchHz, 190.0)
        self.assertGreater(voiced[-1].pitchHz, voiced[0].pitchHz)
        self.assertIsNotNone(forecast.metrics.advanced)
        self.assertGreater(forecast.metrics.advanced.pitchP10Hz, 0.0)
        self.assertIsNotNone(forecast.metrics.advanced.formantLite)
        self.assertGreater(forecast.metrics.advanced.formantLite.f2MedianHz, 1100.0)
        self.assertIsNotNone(forecast.metrics.advanced.quality)
        self.assertGreater(forecast.metrics.advanced.quality.harmonicStrength, -20.0)
        # A phrase forecast is a SYNTHESIZED pitch contour — its frames carry no
        # per-frame advanced metrics and there is no audio to analyze, so there
        # is nothing to measure breathiness or strain from. Updated 2026-07-26:
        # these used to assert a numeric range, which only held because missing
        # inputs were coerced to their worst case (`float(x or 0.0)`) and
        # manufactured a ~0.575 breathy floor out of nothing.
        self.assertIsNone(forecast.metrics.advanced.quality.breathyRisk)
        self.assertIsNone(forecast.metrics.advanced.quality.strainRisk)
        self.assertIn("lifted ending", forecast.summary)

    async def test_australian_bright_feminine_target_preset_is_supported(self) -> None:
        upload = FakeUpload(
            "australian-bright-reference.wav",
            pcm_to_wav_bytes(
                synth_voice_pcm(
                    [196.0, 214.0, 232.0, 224.0], seconds_per_frequency=1.1
                )
            ),
        )
        analysis = await self.reference_analyzer.analyze_upload(
            upload, "australian-bright-feminine"
        )
        profile = build_target_voice_profile(analysis, "australian-bright-feminine")

        self.assertEqual(
            normalize_target_preset("australian-bright-feminine"),
            "australian-bright-feminine",
        )
        self.assertEqual(analysis.targetPreset, "australian-bright-feminine")
        self.assertEqual(profile.targetPreset, "australian-bright-feminine")
        self.assertIn("australian-bright-feminine", profile.profileId)

    async def test_custom_target_preset_library_persists_reference_and_handmade_targets(
        self,
    ) -> None:
        upload = FakeUpload(
            "reference-save.wav",
            pcm_to_wav_bytes(
                synth_voice_pcm([208.0, 224.0, 238.0, 252.0], seconds_per_frequency=1.1)
            ),
        )
        analysis = await self.reference_analyzer.analyze_upload(upload, "cute-feminine")
        reference_preset = self.target_preset_library.save_reference_preset(
            VoiceReferenceTargetPresetSaveRequest(
                name="Saved Reference Voice",
                basePreset="cute-feminine",
                referenceClipId=analysis.clipId,
            )
        )

        self.assertEqual(reference_preset.kind, "reference")
        self.assertEqual(reference_preset.referenceClipId, analysis.clipId)
        self.assertEqual(reference_preset.referenceClipName, analysis.filename)
        self.assertIsNotNone(reference_preset.referenceAnalysis)
        self.assertEqual(reference_preset.referenceAnalysis.clipId, analysis.clipId)
        self.assertIsNotNone(reference_preset.targetVoiceProfile)
        self.assertEqual(reference_preset.targetVoiceProfile.clipId, analysis.clipId)

        renamed_reference_preset = self.target_preset_library.save_preset(
            {
                "id": reference_preset.id,
                "name": "Renamed Reference Voice",
            }
        )

        self.assertEqual(renamed_reference_preset.name, "Renamed Reference Voice")
        self.assertEqual(renamed_reference_preset.referenceClipId, analysis.clipId)
        self.assertEqual(
            renamed_reference_preset.targetVoiceProfile.clipId, analysis.clipId
        )

        handmade_preset = self.target_preset_library.save_handmade_preset(
            VoiceHandmadeTargetPresetSaveRequest(
                name="Small Sweet Custom",
                basePreset="bright-playful",
                pitchFloorHz="178",
                pitchCeilingHz="246",
                resonanceFloor="0.58",
                resonanceCeiling="0.76",
                weightFloor="0.22",
                weightCeiling="0.4",
                stylePrompt="Keep it small, sweet, and bright.",
                notesText="small dog\nsweet",
            )
        )

        self.assertEqual(handmade_preset.kind, "handmade")
        self.assertTrue(
            handmade_preset.targetVoiceProfile.profileId.startswith("custom-profile-")
        )
        self.assertTrue(
            handmade_preset.targetVoiceProfile.clipId.startswith("custom-preset-")
        )
        self.assertEqual(handmade_preset.targetVoiceProfile.durationMs, 0)
        self.assertGreater(handmade_preset.targetVoiceProfile.metrics.meanPitchHz, 0.0)
        self.assertGreater(handmade_preset.targetVoiceProfile.metrics.pitchRangeSt, 1.0)
        self.assertEqual(handmade_preset.notes, ["small dog", "sweet"])

        renamed_handmade_preset = self.target_preset_library.save_preset(
            {
                "id": handmade_preset.id,
                "name": "Renamed Handmade Voice",
            }
        )

        self.assertEqual(renamed_handmade_preset.name, "Renamed Handmade Voice")
        self.assertEqual(
            renamed_handmade_preset.targetVoiceProfile.pitchFloorHz,
            handmade_preset.targetVoiceProfile.pitchFloorHz,
        )
        self.assertEqual(
            renamed_handmade_preset.targetVoiceProfile.stylePrompt,
            handmade_preset.targetVoiceProfile.stylePrompt,
        )

        legacy_handmade_preset = self.target_preset_library.save_preset(
            {
                "name": "Legacy Handmade Voice",
                "kind": "handmade",
                "basePreset": "cute-feminine",
                "targetVoiceProfile": {
                    "pitchFloorHz": 188,
                    "pitchCeilingHz": 252,
                    "resonanceFloor": 0.56,
                    "resonanceCeiling": 0.74,
                    "weightFloor": 0.2,
                    "weightCeiling": 0.36,
                    "stylePrompt": "Legacy handmade payload still works.",
                    "notes": ["legacy", "handmade"],
                },
            }
        )

        self.assertEqual(legacy_handmade_preset.kind, "handmade")
        self.assertEqual(legacy_handmade_preset.notes, ["legacy", "handmade"])
        duplicated_reference_preset = self.target_preset_library.duplicate_preset(
            reference_preset.id,
            VoiceCustomTargetPresetDuplicateRequest(
                name="Saved Reference Voice Copy",
                expectedUpdatedAt=renamed_reference_preset.updatedAt,
            ),
        )

        self.assertNotEqual(duplicated_reference_preset.id, reference_preset.id)
        self.assertEqual(
            duplicated_reference_preset.referenceClipId,
            reference_preset.referenceClipId,
        )
        self.assertFalse(duplicated_reference_preset.archived)

        archived_reference_preset = self.target_preset_library.archive_preset(
            reference_preset.id,
            VoiceCustomTargetPresetMutationRequest(
                expectedUpdatedAt=renamed_reference_preset.updatedAt
            ),
        )
        self.assertIsNotNone(archived_reference_preset)
        self.assertTrue(archived_reference_preset.archived)
        self.assertIsNotNone(archived_reference_preset.archivedAt)

        listed_presets = self.target_preset_library.list_presets()
        self.assertEqual(len(listed_presets), 3)
        self.assertNotIn(reference_preset.id, {entry.id for entry in listed_presets})

        all_presets = self.target_preset_library.list_presets(include_archived=True)
        self.assertEqual(len(all_presets), 4)
        self.assertEqual(all_presets[0].id, archived_reference_preset.id)

        restored_reference_preset = self.target_preset_library.restore_preset(
            reference_preset.id,
            VoiceCustomTargetPresetMutationRequest(
                expectedUpdatedAt=archived_reference_preset.updatedAt
            ),
        )
        self.assertIsNotNone(restored_reference_preset)
        self.assertFalse(restored_reference_preset.archived)
        self.assertIsNone(restored_reference_preset.archivedAt)

        with self.assertRaises(VoiceTargetPresetConflictError):
            self.target_preset_library.save_preset(
                {
                    "id": restored_reference_preset.id,
                    "name": "Conflict Rename",
                    "expectedUpdatedAt": archived_reference_preset.updatedAt,
                }
            )

        self.assertEqual(self.storage.custom_preset_count(), 4)

        deleted_preset = self.target_preset_library.delete_preset(
            reference_preset.id,
            {"expectedUpdatedAt": restored_reference_preset.updatedAt},
        )
        self.assertIsNotNone(deleted_preset)
        self.assertEqual(deleted_preset.id, reference_preset.id)
        self.assertEqual(self.storage.custom_preset_count(), 3)

    async def test_rejected_reference_cannot_derive_or_persist_a_voice_target(
        self,
    ) -> None:
        silence_pcm = b"\x00\x00" * (16000 * 5)
        rejected = await self.reference_analyzer.analyze_upload(
            FakeUpload("no-voice-reference.wav", pcm_to_wav_bytes(silence_pcm)),
            "cute-feminine",
        )

        self.assertIsNotNone(rejected.quality)
        self.assertEqual(rejected.quality.verdict, "reject")
        self.assertFalse(rejected.metrics.advanced.measurementAvailable)
        self.assertIn(
            "no_voiced_frames",
            rejected.metrics.advanced.measurementRejectionReasons,
        )
        with self.assertRaisesRegex(ValueError, "not reliable enough"):
            build_target_voice_profile(rejected, "cute-feminine")
        with self.assertRaisesRegex(ValueError, "not reliable enough"):
            self.target_preset_library.save_reference_preset(
                {
                    "name": "Rejected reference",
                    "basePreset": "cute-feminine",
                    "referenceClipId": rejected.clipId,
                }
            )

        unverified_profile = build_custom_target_profile(
            clipId="unverified-reference-clip",
        ).model_dump(exclude_none=True)
        with self.assertRaisesRegex(ValueError, "trustworthy reference analysis"):
            self.target_preset_library.save_reference_preset(
                {
                    "name": "Unverified legacy reference",
                    "basePreset": "everyday-feminine",
                    "referenceClipId": "unverified-reference-clip",
                    "targetVoiceProfile": unverified_profile,
                }
            )

        rejected_profile = build_custom_target_profile(
            profileId="rejected-reference-profile",
            clipId=rejected.clipId,
            targetPreset="cute-feminine",
        ).model_dump(exclude_none=True)
        with self.assertRaisesRegex(ValueError, "not reliable enough"):
            self.streaming_analyzer.start_session(
                VoiceSessionStartRequest(
                    sloaneSessionId="rejected-reference-session",
                    targetPreset="cute-feminine",
                    referenceClipId=rejected.clipId,
                    targetVoiceProfile=rejected_profile,
                    targetSource="custom-reference",
                )
            )

        self.assertEqual(self.storage.custom_preset_count(), 0)
        self.assertEqual(self.storage.session_count(), 0)

    async def test_stale_reference_calibration_cannot_be_selected_or_rederived(
        self,
    ) -> None:
        upload = FakeUpload(
            "stale-calibration.wav",
            pcm_to_wav_bytes(
                synth_voice_pcm([208.0, 224.0, 238.0], seconds_per_frequency=1.1)
            ),
        )
        analysis = await self.reference_analyzer.analyze_upload(
            upload,
            "cute-feminine",
        )
        preset = self.target_preset_library.save_reference_preset(
            VoiceReferenceTargetPresetSaveRequest(
                name="Current reference",
                basePreset="cute-feminine",
                referenceClipId=analysis.clipId,
            )
        )
        stale_analysis = analysis.model_copy(
            update={"analysisVersion": "voice-metrics-v2"}
        )
        stale_profile = preset.targetVoiceProfile.model_copy(
            update={"analysisVersion": "voice-metrics-v2"}
        )
        stale_preset = preset.model_copy(
            update={
                "id": "stale-reference-preset",
                "referenceAnalysis": stale_analysis,
                "targetVoiceProfile": stale_profile,
            }
        )
        self.storage.save_custom_preset(stale_preset)

        with self.assertRaisesRegex(
            VoiceTargetPresetCalibrationError,
            "older or unknown acoustic calibration",
        ):
            self.target_preset_library.get_preset(stale_preset.id)
        with self.assertRaisesRegex(ValueError, "older or unknown acoustic calibration"):
            build_target_voice_profile(stale_analysis, "cute-feminine")

    async def test_custom_target_preset_storage_tolerates_bad_files_and_failed_writes(
        self,
    ) -> None:
        preset = self.target_preset_library.save_preset(
            {
                "name": "Stable Handmade Voice",
                "kind": "handmade",
                "basePreset": "cute-feminine",
                "pitchFloorHz": 182,
                "pitchCeilingHz": 248,
                "resonanceFloor": 0.54,
                "resonanceCeiling": 0.72,
                "weightFloor": 0.2,
                "weightCeiling": 0.34,
            }
        )

        (self.storage.custom_presets_dir / "corrupt-preset.json").write_text(
            "{bad json", encoding="utf-8"
        )

        listed_presets = self.storage.list_custom_presets()
        self.assertEqual([entry.id for entry in listed_presets], [preset.id])
        self.assertIsNone(self.storage.get_custom_preset("corrupt-preset"))

        original_write_json = self.storage._write_json

        def fail_write(*args, **kwargs):
            raise OSError("disk full")

        self.storage._write_json = fail_write
        try:
            with self.assertRaises(OSError):
                self.storage.save_custom_preset(
                    preset.model_copy(update={"name": "Broken Save"})
                )
        finally:
            self.storage._write_json = original_write_json

        stored_preset = self.storage.get_custom_preset(preset.id)
        self.assertIsNotNone(stored_preset)
        self.assertEqual(stored_preset.name, preset.name)

    async def test_custom_target_presets_reject_explicit_invalid_bands(self) -> None:
        with self.assertRaisesRegex(ValueError, "pitchFloorHz.*pitchCeilingHz"):
            self.target_preset_library.save_handmade_preset(
                {
                    "name": "Inverted Handmade Voice",
                    "basePreset": "cute-feminine",
                    "pitchFloorHz": 260,
                    "pitchCeilingHz": 180,
                }
            )

        malformed_reference = build_custom_target_profile().model_dump(exclude_none=True)
        malformed_reference["resonanceCeiling"] = 1.5
        with self.assertRaisesRegex(ValueError, "resonanceCeiling"):
            self.target_preset_library.save_reference_preset(
                {
                    "name": "Invalid Saved Reference",
                    "basePreset": "everyday-feminine",
                    "targetVoiceProfile": malformed_reference,
                }
            )

        self.assertEqual(self.storage.custom_preset_count(), 0)

    # ------------------------------------------------------------------
    # Calibration self-healing (2026-07-26)
    #
    # When VOICE_ANALYSIS_VERSION moves, every stored reference analysis from
    # the previous version stops being able to derive a voice target, and every
    # reference-target session start 400s (reason=rejected_reference_analysis)
    # until the retained audio is re-analyzed. These three tests pin the
    # durable self-heal: heal when the raw audio is there, reject EXACTLY as
    # before when it is not, and never re-analyze a clip that is already
    # current.
    # ------------------------------------------------------------------

    async def _stored_analysis_json(self, clip_id: str) -> dict:
        path = self.storage.references_analysis_dir / f"{clip_id}.json"
        return json.loads(path.read_text())

    async def test_stale_reference_calibration_self_heals_on_session_start(
        self,
    ) -> None:
        upload = FakeUpload(
            "self-heal.wav",
            pcm_to_wav_bytes(
                synth_voice_pcm([208.0, 224.0, 238.0], seconds_per_frequency=1.1)
            ),
        )
        analysis = await self.reference_analyzer.analyze_upload(upload, "cute-feminine")
        expected_profile = build_target_voice_profile(analysis, "cute-feminine")

        # Age the STORED analysis to the previous calibration, exactly like the
        # 170 references the v3-yin bump stranded in the field.
        self.storage.save_reference(
            analysis.model_copy(update={"analysisVersion": "voice-metrics-v2"})
        )
        self.assertEqual(
            (await self._stored_analysis_json(analysis.clipId))["analysisVersion"],
            "voice-metrics-v2",
        )

        with self.assertLogs("src.services.streaming_analyzer", level="INFO") as logs:
            session = self.streaming_analyzer.start_session(
                VoiceSessionStartRequest(
                    sloaneSessionId="self-heal-session",
                    targetPreset="cute-feminine",
                    referenceClipId=analysis.clipId,
                    targetVoiceProfile=expected_profile.model_dump(exclude_none=True),
                    targetSource="custom-reference",
                )
            )

        # The start survived instead of 400ing the phone into a retry loop.
        self.assertEqual(session.status, "ready")
        self.assertEqual(session.referenceClipId, analysis.clipId)
        self.assertEqual(
            session.targetVoiceProfile.analysisVersion, VOICE_ANALYSIS_VERSION
        )

        # The stored analysis is re-stamped IN PLACE on disk: same clip
        # identity, current calibration.
        stored = await self._stored_analysis_json(analysis.clipId)
        self.assertEqual(stored["analysisVersion"], VOICE_ANALYSIS_VERSION)
        self.assertEqual(stored["clipId"], analysis.clipId)
        self.assertEqual(stored["filename"], analysis.filename)
        self.assertEqual(stored["targetPreset"], analysis.targetPreset)

        witness = next(
            line for line in logs.output if "voice_reference_reanalyzed" in line
        )
        self.assertIn(f"clip_id={analysis.clipId}", witness)
        self.assertIn("from_version=voice-metrics-v2", witness)
        self.assertIn(f"to_version={VOICE_ANALYSIS_VERSION}", witness)

    async def test_self_heal_still_rejects_a_stale_fingerprint_verbatim(self) -> None:
        """The real field sequence, end to end.

        A stale stored analysis AND a stale caller fingerprint (the gateway's
        persisted profile, derived under the old calibration with different
        bands). The analysis self-heals, but the fingerprint law still rejects
        the supplied profile — and it must reject with the EXACT sentence the
        gateway matches to trigger its rebind, since the machine-readable
        reason token never reaches the wire."""
        upload = FakeUpload(
            "stale-fingerprint.wav",
            pcm_to_wav_bytes(
                synth_voice_pcm([208.0, 224.0, 238.0], seconds_per_frequency=1.1)
            ),
        )
        analysis = await self.reference_analyzer.analyze_upload(upload, "cute-feminine")
        fresh_profile = build_target_voice_profile(analysis, "cute-feminine")

        # The old calibration produced different bands for the same clip.
        stale_profile = fresh_profile.model_copy(
            update={
                "analysisVersion": "voice-metrics-v2",
                "pitchFloorHz": round(fresh_profile.pitchFloorHz - 3.75, 2),
            }
        )
        self.storage.save_reference(
            analysis.model_copy(update={"analysisVersion": "voice-metrics-v2"})
        )

        with self.assertRaises(ValueError) as rejected:
            self.streaming_analyzer.start_session(
                VoiceSessionStartRequest(
                    sloaneSessionId="stale-fingerprint-session",
                    targetPreset="cute-feminine",
                    referenceClipId=analysis.clipId,
                    targetVoiceProfile=stale_profile.model_dump(exclude_none=True),
                    targetSource="custom-reference",
                )
            )

        # Verbatim: backend/voice-standalone-runtime.js matches this sentence to
        # decide that a 400 is a rebindable calibration rejection.
        self.assertEqual(
            str(rejected.exception),
            "Reference target profile does not match the stored reference analysis.",
        )
        # The self-heal still happened, so the gateway's re-derivation will now
        # return a profile that matches.
        stored = await self._stored_analysis_json(analysis.clipId)
        self.assertEqual(stored["analysisVersion"], VOICE_ANALYSIS_VERSION)
        self.assertEqual(self.storage.session_count(), 0)

    async def test_stale_reference_without_retained_audio_rejects_unchanged(
        self,
    ) -> None:
        upload = FakeUpload(
            "no-raw.wav",
            pcm_to_wav_bytes(
                synth_voice_pcm([208.0, 224.0, 238.0], seconds_per_frequency=1.1)
            ),
        )
        analysis = await self.reference_analyzer.analyze_upload(upload, "cute-feminine")
        profile = build_target_voice_profile(analysis, "cute-feminine")
        self.storage.save_reference(
            analysis.model_copy(update={"analysisVersion": "voice-metrics-v2"})
        )

        # The retained raw audio is gone, so there is nothing to re-analyze.
        raw_path = self.storage.get_reference_file_path(analysis.clipId)
        self.assertIsNotNone(raw_path)
        raw_path.unlink()

        with self.assertLogs("src.services.streaming_analyzer", level="WARNING") as logs:
            with self.assertRaisesRegex(
                ValueError, "older or unknown acoustic calibration"
            ):
                self.streaming_analyzer.start_session(
                    VoiceSessionStartRequest(
                        sloaneSessionId="no-raw-session",
                        targetPreset="cute-feminine",
                        referenceClipId=analysis.clipId,
                        targetVoiceProfile=profile.model_dump(exclude_none=True),
                        targetSource="custom-reference",
                    )
                )

        rejection = next(
            line for line in logs.output if "voice_session_start_rejected" in line
        )
        self.assertIn("reason=rejected_reference_analysis", rejection)
        self.assertEqual(self.storage.session_count(), 0)
        # A failed self-heal must not mutate the stored analysis.
        stored = await self._stored_analysis_json(analysis.clipId)
        self.assertEqual(stored["analysisVersion"], "voice-metrics-v2")

    async def test_current_calibration_never_triggers_reanalysis(self) -> None:
        upload = FakeUpload(
            "already-current.wav",
            pcm_to_wav_bytes(
                synth_voice_pcm([208.0, 224.0, 238.0], seconds_per_frequency=1.1)
            ),
        )
        analysis = await self.reference_analyzer.analyze_upload(upload, "cute-feminine")
        self.assertEqual(analysis.analysisVersion, VOICE_ANALYSIS_VERSION)
        profile = build_target_voice_profile(analysis, "cute-feminine")

        with mock.patch.object(
            streaming_module.reference_analyzer,
            "reanalyze_stored",
            wraps=streaming_module.reference_analyzer.reanalyze_stored,
        ) as reanalyze_spy:
            session = self.streaming_analyzer.start_session(
                VoiceSessionStartRequest(
                    sloaneSessionId="already-current-session",
                    targetPreset="cute-feminine",
                    referenceClipId=analysis.clipId,
                    targetVoiceProfile=profile.model_dump(exclude_none=True),
                    targetSource="custom-reference",
                )
            )

        self.assertEqual(session.status, "ready")
        reanalyze_spy.assert_not_called()


class CppsRegressionTests(unittest.TestCase):
    """Phase 1.6: regression tests for the Praat-matching CPPS rebuild.

    These tests protect against the previous implementation bugs:
      - log(magnitude) instead of log(power)
      - wrong pitch quefrency band
      - magic ×28.0 multiplier
      - no smoothing line
    """

    SAMPLE_RATE = 16000

    def _synthesize_voiced(
        self, fundamental_hz: float, duration_s: float, noise_amp: float = 0.05
    ) -> np.ndarray:
        """Return a float64 mono signal with a 5-harmonic stack + small noise floor."""
        n = int(self.SAMPLE_RATE * duration_s)
        t = np.arange(n, dtype=np.float64) / float(self.SAMPLE_RATE)
        signal = (
            1.0 * np.sin(2 * math.pi * fundamental_hz * t)
            + 0.5 * np.sin(2 * math.pi * (2 * fundamental_hz) * t + 0.3)
            + 0.25 * np.sin(2 * math.pi * (3 * fundamental_hz) * t + 0.7)
            + 0.12 * np.sin(2 * math.pi * (4 * fundamental_hz) * t + 1.2)
            + 0.06 * np.sin(2 * math.pi * (5 * fundamental_hz) * t + 1.8)
        )
        if noise_amp > 0:
            signal = signal + noise_amp * np.random.RandomState(42).randn(n)
        return signal

    def test_clean_voiced_signal_produces_healthy_cpps(self) -> None:
        """A healthy voiced signal at 200 Hz with realistic noise should yield
        a CPPS in the Praat healthy range (10–22 dB)."""
        signal = self._synthesize_voiced(200.0, 0.5, noise_amp=0.05)
        cpps = _cpps_like(signal, self.SAMPLE_RATE)
        self.assertGreater(
            cpps, 8.0, f"CPPS too low for healthy voiced signal: {cpps:.2f} dB"
        )
        self.assertLess(
            cpps,
            25.0,
            f"CPPS too high for voiced signal (should be Praat-healthy): {cpps:.2f} dB",
        )

    def test_white_noise_produces_low_cpps(self) -> None:
        """White noise should give a low CPPS — there is no periodic structure."""
        rng = np.random.RandomState(42)
        signal = 0.1 * rng.randn(self.SAMPLE_RATE // 2)
        cpps = _cpps_like(signal, self.SAMPLE_RATE)
        # Praat would give 3–8 dB for short-window noise. Allow up to 12 dB
        # to keep this test robust while still catching the previous bug
        # (where noise produced 18+ dB).
        self.assertLess(cpps, 12.0, f"CPPS for white noise too high: {cpps:.2f} dB")

    def test_too_short_window_returns_none(self) -> None:
        """Below 256 samples the function reports NOT MEASURED, not 0.0.

        Updated 2026-07-26: this used to assert 0.0, which contradicted the
        function's own docstring and — because 0 dB is the WORST possible CPPS
        — let an unmeasurable window manufacture a maximal breathiness term.
        Absence must be None so the caller can drop the term instead of
        scoring it."""
        signal = self._synthesize_voiced(200.0, duration_s=0.005)  # 80 samples
        cpps = _cpps_like(signal, self.SAMPLE_RATE)
        self.assertIsNone(cpps)

    def test_empty_window_returns_none(self) -> None:
        """The degenerate empty/near-empty window is also 'not measured'."""
        self.assertIsNone(_cpps_like(np.zeros(0), self.SAMPLE_RATE))
        self.assertIsNone(_cpps_like(np.zeros(64), self.SAMPLE_RATE))

    def test_f0_changes_move_peak(self) -> None:
        """Different fundamentals should still produce a healthy CPPS — i.e.
        the search band is wide enough to catch pitches from 60–333 Hz."""
        for f0 in (75.0, 150.0, 220.0, 290.0):
            signal = self._synthesize_voiced(f0, 0.5, noise_amp=0.05)
            cpps = _cpps_like(signal, self.SAMPLE_RATE)
            self.assertGreater(cpps, 5.0, f"CPPS too low for f0={f0}Hz: {cpps:.2f} dB")


if __name__ == "__main__":
    unittest.main()
