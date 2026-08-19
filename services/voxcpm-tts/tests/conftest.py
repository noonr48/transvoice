import asyncio
import time

import numpy as np
import pytest


class DeterministicTestModel:
    def generate(self, **kwargs):
        text = str(kwargs.get("text") or "")
        return np.zeros(max(4800, len(text) * 240), dtype=np.float32)

    def generate_streaming(self, **kwargs):
        yield self.generate(**kwargs)


@pytest.fixture(autouse=True)
def _install_deterministic_test_model(monkeypatch):
    import app.main as main_mod

    monkeypatch.setattr(main_mod.engine, "_loaded", True)
    monkeypatch.setattr(main_mod.engine, "_model", DeterministicTestModel())
    if main_mod.semaphore is None:
        main_mod.semaphore = asyncio.Semaphore(
            main_mod.settings.TTS_SEMAPHORE_CONCURRENCY
        )
    if main_mod._start_time == 0.0:
        main_mod._start_time = time.monotonic()
    yield


@pytest.fixture(autouse=True)
def _reset_voice_profiles():
    from app.voice_profiles import _profiles

    _profiles.clear()
    yield
    _profiles.clear()
