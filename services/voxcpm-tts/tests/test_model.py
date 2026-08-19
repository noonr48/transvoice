from dataclasses import replace
from types import SimpleNamespace
import sys

import numpy as np
import pytest
import torch

from app.model import VoxCPMEngine, synthesis_cache_context
from app.settings import settings
from app.voice_profiles import VoiceProfile


class _FakeModel:
    def __init__(self):
        self.calls = []

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        return np.zeros(480, dtype=np.float32)

    def generate_streaming(self, **kwargs):
        self.calls.append(kwargs)
        yield np.zeros(480, dtype=np.float32)


def _profile(**overrides):
    base = VoiceProfile(
        id="coach_v1",
        mode="design",
        description="A built-in feminine voice description",
        reference_audio_path=None,
        cfg_value=2.0,
        inference_timesteps=8,
        normalize=True,
        denoise=False,
    )
    return replace(base, **overrides)


def _engine_with_fake_model():
    engine = VoxCPMEngine(settings)
    engine._loaded = True
    engine._model = _FakeModel()
    return engine


def test_reference_clone_uses_target_text_without_builtin_voice_description():
    engine = _engine_with_fake_model()
    profile = _profile(reference_audio_path="/tmp/selected-reference.wav")

    engine.generate("Keep the sound forward.", profile)

    assert engine._model.calls[0]["text"] == "Keep the sound forward."
    assert engine._model.calls[0]["reference_wav_path"] == "/tmp/selected-reference.wav"


def test_reference_path_is_not_written_to_logs(caplog):
    engine = _engine_with_fake_model()
    reference_path = "/tmp/stable-private-reference-id.wav"

    with caplog.at_level("INFO", logger="voxcpm.engine"):
        engine.generate(
            "Keep the sound forward.",
            _profile(reference_audio_path=reference_path),
        )

    assert "reference_present=true" in caplog.text
    assert reference_path not in caplog.text


def test_reference_clone_streaming_uses_the_same_voice_identity_rule():
    engine = _engine_with_fake_model()
    profile = _profile(reference_audio_path="/tmp/selected-reference.wav")

    list(engine.generate_streaming("Let the ending settle.", profile))

    assert engine._model.calls[0]["text"] == "Let the ending settle."
    assert engine._model.calls[0]["reference_wav_path"] == "/tmp/selected-reference.wav"


def test_profile_synthesis_keeps_its_design_description_without_a_reference():
    engine = _engine_with_fake_model()

    engine.generate("Keep the sound forward.", _profile())

    assert engine._model.calls[0]["text"] == (
        "(A built-in feminine voice description)Keep the sound forward."
    )


def test_cache_context_separates_reference_identity_from_design_description():
    designed = _profile()
    referenced = _profile(reference_audio_path="/tmp/selected-reference.wav")

    assert synthesis_cache_context(designed) != synthesis_cache_context(referenced)
    assert "A built-in feminine voice description" in synthesis_cache_context(designed)
    assert "A built-in feminine voice description" not in synthesis_cache_context(referenced)


def test_reference_features_are_encoded_once_per_reference_content(tmp_path):
    class _PromptCachedModel:
        def __init__(self):
            self.builds = 0
            self.generations = 0

        def build_prompt_cache(self, **_kwargs):
            self.builds += 1
            return {"mode": "reference", "ref_audio_feat": torch.zeros(1)}

        def generate_with_prompt_cache(self, **_kwargs):
            self.generations += 1
            return torch.zeros((1, 480), dtype=torch.float32), None, None

    class _Wrapper:
        def __init__(self):
            self.tts_model = _PromptCachedModel()
            self.text_normalizer = None

    reference = tmp_path / "selected-reference.wav"
    reference.write_bytes(b"reference-content-a")
    engine = VoxCPMEngine(settings)
    engine._loaded = True
    engine._model = _Wrapper()
    profile = _profile(
        reference_audio_path=str(reference),
        normalize=False,
        denoise=False,
    )

    engine.generate("First tutor line.", profile)
    engine.generate("Second tutor line.", profile)
    assert engine._model.tts_model.builds == 1
    assert engine._model.tts_model.generations == 2

    reference.write_bytes(b"reference-content-b")
    engine.generate("Third tutor line.", profile)
    assert engine._model.tts_model.builds == 2


def test_reference_features_can_be_prepared_without_generating_audio(tmp_path):
    class _PromptCachedModel:
        def __init__(self):
            self.builds = 0

        def build_prompt_cache(self, **_kwargs):
            self.builds += 1
            return {"mode": "reference", "ref_audio_feat": torch.zeros(1)}

    class _Wrapper:
        def __init__(self):
            self.tts_model = _PromptCachedModel()

    reference = tmp_path / "selected-reference.wav"
    reference.write_bytes(b"reference-content-a")
    engine = VoxCPMEngine(settings)
    engine._loaded = True
    engine._model = _Wrapper()

    assert engine.prepare_reference(str(reference)) is False
    assert engine.prepare_reference(str(reference)) is True
    assert engine._model.tts_model.builds == 1

    reference.write_bytes(b"reference-content-b")
    assert engine.prepare_reference(str(reference)) is False
    assert engine._model.tts_model.builds == 2


def test_model_load_failure_remains_unavailable(monkeypatch):
    class _FailingVoxCpm:
        @classmethod
        def from_pretrained(cls, **_kwargs):
            raise RuntimeError("deliberate load failure")

    monkeypatch.setitem(sys.modules, "voxcpm", SimpleNamespace(VoxCPM=_FailingVoxCpm))
    engine = VoxCPMEngine(settings)

    engine.load()

    assert engine.loaded is False
    assert engine._model is None
    with pytest.raises(RuntimeError, match="model not loaded"):
        engine.generate("This must remain unavailable.", _profile())
