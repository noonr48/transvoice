"""Comprehensive integration tests for the VoxCPM TTS service.

Uses httpx.AsyncClient with ASGITransport to exercise every endpoint
through the ASGI interface. Tests install a deterministic fake model object;
the production engine itself has no mock-audio fallback.
"""

import asyncio
import threading
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from httpx import ASGITransport, AsyncClient

import app.main as main_mod
from app.main import app, engine


def _make_client():
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    return AsyncClient(transport=transport, base_url="http://test")


# ===================================================================
# 1. Health & Status Endpoints (4 tests)
# ===================================================================


@pytest.mark.asyncio
async def test_health_returns_ok():
    async with _make_client() as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ok"] is True
    assert data["model_loaded"] is True
    assert isinstance(data["cache_size"], int)
    assert isinstance(data["voice_profiles"], list)
    assert "coach_v1" in data["voice_profiles"]


@pytest.mark.asyncio
async def test_ready_returns_true():
    async with _make_client() as client:
        resp = await client.get("/ready")
    assert resp.status_code == 200
    assert resp.json()["ready"] is True


@pytest.mark.asyncio
async def test_model_absence_fails_health_readiness_and_generation(monkeypatch):
    monkeypatch.setattr(engine, "_loaded", True)
    monkeypatch.setattr(engine, "_model", None)

    async with _make_client() as client:
        health_resp = await client.get("/health")
        ready_resp = await client.get("/ready")
        generate_resp = await client.post(
            "/generate",
            json={
                "target_text": "This must never become placeholder audio.",
                "reference_audio_path": "/tmp/voxcpm-refs/ref-unavailable.wav",
            },
        )

    assert health_resp.status_code == 503
    assert ready_resp.status_code == 503
    assert generate_resp.status_code == 503
    assert generate_resp.headers.get("X-TTS-Generation-Mode") is None
    assert generate_resp.headers.get("X-Reference-Audio-Role") is None
    assert generate_resp.headers["content-type"].startswith("application/json")


@pytest.mark.asyncio
async def test_info_returns_details():
    async with _make_client() as client:
        resp = await client.get("/info")
    assert resp.status_code == 200
    data = resp.json()
    assert data["engine"] == "voxcpm2"
    assert "model_id" in data
    assert "device" in data
    assert data["sample_rate"] == 48000
    assert data["loaded"] is True
    assert isinstance(data["voice_profiles"], list)


@pytest.mark.asyncio
async def test_metrics_returns_stats():
    async with _make_client() as client:
        resp = await client.get("/metrics")
    assert resp.status_code == 200
    data = resp.json()
    assert "request_count" in data
    assert "cache_hits" in data
    assert "cache_misses" in data
    assert "cache_hit_rate" in data
    assert "uptime_seconds" in data
    assert data["uptime_seconds"] >= 0


# ===================================================================
# 2. TTS Stream Endpoint (5 tests)
# ===================================================================


@pytest.mark.asyncio
async def test_stream_happy_path():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/tts/stream",
            json={"text": "Hello, this is a test."},
        )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/octet-stream"
    assert "X-Audio-Format" in resp.headers
    assert len(resp.content) > 0


@pytest.mark.asyncio
async def test_stream_empty_text_rejected():
    async with _make_client() as client:
        resp = await client.post("/v1/tts/stream", json={"text": ""})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_stream_max_text():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/tts/stream",
            json={"text": "A" * 700},
        )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_stream_over_max_text():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/tts/stream",
            json={"text": "A" * 701},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_stream_custom_profile():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/tts/stream",
            json={"text": "Testing custom profile.", "voice_profile_id": "coach_v1"},
        )
    assert resp.status_code == 200


# ===================================================================
# 3. TTS WAV Endpoint (4 tests)
# ===================================================================


@pytest.mark.asyncio
async def test_wav_happy_path():
    async with _make_client() as client:
        resp = await client.post("/v1/tts/wav", json={"text": "Hello world."})
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/wav"
    assert len(resp.content) > 0
    assert resp.content[:4] == b"RIFF"


@pytest.mark.asyncio
async def test_wav_with_cfg_override():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/tts/wav",
            json={"text": "CFG override test.", "cfg_value": 3.0},
        )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_wav_with_timesteps_override():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/tts/wav",
            json={"text": "Timesteps override test.", "inference_timesteps": 12},
        )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_wav_invalid_profile():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/tts/wav",
            json={"text": "This should fail.", "voice_profile_id": "nonexistent"},
        )
    assert resp.status_code == 404


# ===================================================================
# 4. Generate Compatibility Endpoint (4 tests)
# ===================================================================


@pytest.mark.asyncio
async def test_generate_happy_path():
    async with _make_client() as client:
        resp = await client.post(
            "/generate", json={"target_text": "Hello from bridge."}
        )
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/octet-stream"
    assert resp.headers.get("X-Voice-Speech-Provider") == "voxcpm"
    assert resp.headers.get("X-Speaking-Rate-Applied") == "0.76"
    assert resp.headers.get("X-TTS-Generation-Mode") == "profile-synthesis"
    assert resp.headers.get("X-Reference-Audio-Role") == "none"
    assert len(resp.content) > 0


@pytest.mark.asyncio
async def test_generate_applies_requested_speaking_rate(monkeypatch):
    seen_rates = []
    unique_text = f"Speaking rate wiring {time.time_ns()}"

    monkeypatch.setattr(
        main_mod.engine,
        "generate",
        lambda _text, _profile: np.zeros(4800, dtype=np.float32),
    )

    def capture_rate(pcm, sample_rate, speaking_rate):
        seen_rates.append((sample_rate, speaking_rate))
        return pcm

    monkeypatch.setattr(main_mod.audio_utils, "apply_speaking_rate", capture_rate)

    async with _make_client() as client:
        resp = await client.post(
            "/generate",
            json={"target_text": unique_text, "speakingRate": 0.76},
        )

    assert resp.status_code == 200
    assert resp.headers.get("X-Speaking-Rate-Applied") == "0.76"
    assert seen_rates == [(48000, 0.76)]


@pytest.mark.asyncio
async def test_generate_synthesizes_complete_coach_sentences_separately(monkeypatch):
    generated_segments = []
    unique = time.time_ns()
    first = f"The first measured sentence is complete {unique}."
    second = f"The second sentence now gives one clear vocal cue {unique}."

    def capture_segment(text, _profile):
        generated_segments.append(text)
        return np.zeros(4800, dtype=np.float32)

    monkeypatch.setattr(main_mod.engine, "generate", capture_segment)
    monkeypatch.setattr(
        main_mod.audio_utils,
        "apply_speaking_rate",
        lambda pcm, _sample_rate, _speaking_rate: pcm,
    )

    async with _make_client() as client:
        resp = await client.post(
            "/generate",
            json={"target_text": f"{first} {second}", "speakingRate": 0.76},
        )

    assert resp.status_code == 200
    assert generated_segments == [first, second]


@pytest.mark.asyncio
async def test_generate_rejects_out_of_range_speaking_rate():
    async with _make_client() as client:
        resp = await client.post(
            "/generate",
            json={"target_text": "Too fast must be rejected.", "speakingRate": 2.0},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_empty_text():
    async with _make_client() as client:
        resp = await client.post("/generate", json={"target_text": ""})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_generate_with_reference_path():
    async with _make_client() as client:
        resp = await client.post(
            "/generate",
            json={"target_text": "With ref path.", "reference_audio_path": None},
        )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_generate_missing_text():
    async with _make_client() as client:
        resp = await client.post("/generate", json={})
    assert resp.status_code == 422


# ===================================================================
# 5. Reference Audio Endpoints (4 tests)
# ===================================================================


@pytest.mark.asyncio
async def test_reference_upload_too_small():
    async with _make_client() as client:
        resp = await client.post("/v1/reference-audio", content=b"\x00" * 50)
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_reference_upload_happy_path():
    async with _make_client() as client:
        resp = await client.post("/v1/reference-audio", content=b"\x00" * 1000)
    assert resp.status_code == 200
    data = resp.json()
    assert "path" in data
    assert data["size"] == 1000


@pytest.mark.asyncio
async def test_reference_download_bad_url():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/reference-audio/download",
            json={"url": "http://localhost:1/nonexistent"},
        )
    assert resp.status_code == 500


@pytest.mark.asyncio
async def test_reference_download_nonexistent():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/reference-audio/download",
            json={"url": "http://httpbin.org/status/404"},
        )
    assert resp.status_code == 502


@pytest.mark.asyncio
async def test_reference_prime_prepares_features_without_generating_audio(
    tmp_path, monkeypatch
):
    reference = tmp_path / "selected-reference.wav"
    reference.write_bytes(b"RIFF" + b"\x00" * 256)
    calls = []

    def prepare_reference(path):
        calls.append(path)
        return len(calls) > 1

    monkeypatch.setattr(engine, "prepare_reference", prepare_reference)
    async with _make_client() as client:
        first = await client.post(
            "/v1/reference-audio/prime",
            json={"reference_audio_path": str(reference)},
        )
        second = await client.post(
            "/v1/reference-audio/prime",
            json={"reference_audio_path": str(reference)},
        )

    assert first.status_code == 200
    assert first.json()["prepared"] is True
    assert first.json()["cache_hit"] is False
    assert second.status_code == 200
    assert second.json()["cache_hit"] is True
    assert calls == [str(reference), str(reference)]


@pytest.mark.asyncio
async def test_reference_prime_rejects_missing_audio(tmp_path):
    async with _make_client() as client:
        response = await client.post(
            "/v1/reference-audio/prime",
            json={"reference_audio_path": str(tmp_path / "missing.wav")},
        )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_reference_prime_respects_single_worker_admission(tmp_path):
    reference = tmp_path / "selected-reference.wav"
    reference.write_bytes(b"RIFF" + b"\x00" * 256)

    async with _make_client() as client:
        async with main_mod.semaphore:
            response = await client.post(
                "/v1/reference-audio/prime",
                json={"reference_audio_path": str(reference)},
            )

    assert response.status_code == 429


# ===================================================================
# 6. Cache Prime Endpoint (3 tests)
# ===================================================================


@pytest.mark.asyncio
async def test_prime_happy_path():
    uid = int(time.monotonic_ns())
    async with _make_client() as client:
        resp = await client.post(
            "/v1/cache/prime",
            json={
                "phrases": [
                    f"cache prime test one {uid}",
                    f"cache prime test two {uid}",
                ]
            },
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["primed"] == 2
    assert data["total_phrases"] == 2


@pytest.mark.asyncio
async def test_prime_empty_phrases():
    async with _make_client() as client:
        resp = await client.post("/v1/cache/prime", json={"phrases": []})
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_prime_idempotent():
    uid = int(time.monotonic_ns())
    phrases = [f"idempotent alpha {uid}", f"idempotent beta {uid}"]
    async with _make_client() as client:
        resp1 = await client.post("/v1/cache/prime", json={"phrases": phrases})
        assert resp1.status_code == 200
        assert resp1.json()["primed"] == 2

        resp2 = await client.post("/v1/cache/prime", json={"phrases": phrases})
        assert resp2.status_code == 200
        assert resp2.json()["primed"] == 0


# ===================================================================
# 7. Cache Behavior (3 tests)
# ===================================================================


@pytest.mark.asyncio
async def test_cache_hit_avoids_a_second_synthesis(monkeypatch):
    uid = int(time.monotonic_ns())
    text = f"Speed comparison cache test {uid}."
    generate_calls = 0
    real_generate = engine.generate

    def counted_generate(*args, **kwargs):
        nonlocal generate_calls
        generate_calls += 1
        return real_generate(*args, **kwargs)

    monkeypatch.setattr(engine, "generate", counted_generate)
    async with _make_client() as client:
        resp1 = await client.post("/v1/tts/wav", json={"text": text})
        assert resp1.status_code == 200

        resp2 = await client.post("/v1/tts/wav", json={"text": text})
        assert resp2.status_code == 200

    assert generate_calls == 1


@pytest.mark.asyncio
async def test_compat_cache_can_be_disabled_for_reproducible_benchmarks(monkeypatch):
    text = f"Uncached compatibility benchmark {time.time_ns()}."
    generate_calls = 0
    real_generate = engine.generate

    def counted_generate(*args, **kwargs):
        nonlocal generate_calls
        generate_calls += 1
        return real_generate(*args, **kwargs)

    monkeypatch.setattr(engine, "generate", counted_generate)
    async with _make_client() as client:
        first = await client.post("/generate", json={"target_text": text, "cache": False})
        second = await client.post("/generate", json={"target_text": text, "cache": False})

    assert first.status_code == 200
    assert second.status_code == 200
    assert generate_calls == 2


@pytest.mark.asyncio
async def test_cache_includes_reference_in_key(tmp_path):
    ref_path = tmp_path / "ref.wav"
    audio = np.sin(2 * np.pi * 440 * np.arange(48000) / 48000).astype(np.float32) * 0.3
    sf.write(str(ref_path), audio, 48000)

    uid = int(time.monotonic_ns())
    text = f"Reference key test {uid}."
    async with _make_client() as client:
        resp_no_ref = await client.post("/v1/tts/wav", json={"text": text})
        assert resp_no_ref.status_code == 200

        resp_with_ref = await client.post(
            "/v1/tts/wav",
            json={
                "text": text,
                "reference_audio_path": str(ref_path),
            },
        )
        assert resp_with_ref.status_code == 200


@pytest.mark.asyncio
async def test_cache_invalidates_when_reference_bytes_change_at_same_path(
    tmp_path, monkeypatch
):
    ref_path = tmp_path / "replaceable-ref.wav"
    sf.write(str(ref_path), np.zeros(4800, dtype=np.float32), 48000)
    text = f"Changed reference bytes must change the voice cache {time.time_ns()}."
    generate_calls = 0

    def counted_generate(_text, _profile):
        nonlocal generate_calls
        generate_calls += 1
        return np.zeros(4800, dtype=np.float32)

    monkeypatch.setattr(engine, "generate", counted_generate)
    payload = {"text": text, "reference_audio_path": str(ref_path)}
    async with _make_client() as client:
        first = await client.post("/v1/tts/wav", json=payload)
        assert first.status_code == 200

        sf.write(str(ref_path), np.ones(4800, dtype=np.float32) * 0.1, 48000)
        second = await client.post("/v1/tts/wav", json=payload)
        assert second.status_code == 200

    assert generate_calls == 2


@pytest.mark.asyncio
async def test_cache_size_grows():
    uid = int(time.monotonic_ns())
    async with _make_client() as client:
        health_before = await client.get("/health")
        size_before = health_before.json()["cache_size"]

        await client.post(
            "/v1/cache/prime",
            json={
                "phrases": [
                    f"grows test phrase alpha {uid}",
                    f"grows test phrase beta {uid}",
                ]
            },
        )

        health_after = await client.get("/health")
        size_after = health_after.json()["cache_size"]

    assert size_after >= size_before


# ===================================================================
# 8. Text Segmentation (4 tests)
# ===================================================================


@pytest.mark.asyncio
async def test_segmenter_short_text():
    async with _make_client() as client:
        resp = await client.post("/v1/tts/wav", json={"text": "Short."})
    assert resp.status_code == 200
    assert len(resp.content) > 0


@pytest.mark.asyncio
async def test_segmenter_long_text():
    long_text = "This is a sentence for segmentation testing. " * 10
    async with _make_client() as client:
        resp = await client.post("/v1/tts/wav", json={"text": long_text[:700]})
    assert resp.status_code == 200
    assert len(resp.content) > 0


@pytest.mark.asyncio
async def test_segmenter_sentence_boundaries():
    from app.segmenter import segment_text

    text = "First sentence is here. Second sentence is here. Third sentence is here."
    segments = segment_text(text, max_chars=220, min_chars=40)
    assert len(segments) >= 1
    joined = " ".join(segments)
    assert "First" in joined
    assert "Third" in joined


@pytest.mark.asyncio
async def test_segmenter_empty():
    from app.segmenter import segment_text

    assert segment_text("") == []
    assert segment_text("   ") == []


# ===================================================================
# 9. Voice Profiles (3 tests)
# ===================================================================


@pytest.mark.asyncio
async def test_coach_v1_profile_loaded():
    async with _make_client() as client:
        resp = await client.get("/health")
    profiles = resp.json()["voice_profiles"]
    assert "coach_v1" in profiles


@pytest.mark.asyncio
async def test_profile_override_cfg():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/tts/wav",
            json={"text": "Override cfg test.", "cfg_value": 5.0},
        )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_invalid_profile_returns_404():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/tts/wav",
            json={"text": "Fail test.", "voice_profile_id": "nonexistent_profile"},
        )
    assert resp.status_code == 404


# ===================================================================
# 10. Schema Validation (4 tests)
# ===================================================================


@pytest.mark.asyncio
async def test_control_chars_stripped():
    text_with_ctrl = "Hello\x00\x01\x02 World"
    async with _make_client() as client:
        resp = await client.post("/v1/tts/stream", json={"text": text_with_ctrl})
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_reference_path_must_be_absolute():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/tts/wav",
            json={"text": "Path test.", "reference_audio_path": "relative/path.wav"},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_reference_path_valid_extensions(tmp_path):
    audio = np.sin(2 * np.pi * 440 * np.arange(48000) / 48000).astype(np.float32) * 0.3
    formats = {
        ".wav": ("WAV", "PCM_16"),
        ".flac": ("FLAC", None),
        ".ogg": ("OGG", "VORBIS"),
    }
    async with _make_client() as client:
        for ext in [".wav", ".mp3", ".flac", ".ogg", ".m4a"]:
            fpath = tmp_path / f"test{ext}"
            if ext in formats:
                fmt, subtype = formats[ext]
                kw = {"format": fmt}
                if subtype:
                    kw["subtype"] = subtype
                sf.write(str(fpath), audio, 48000, **kw)
            else:
                fpath.write_bytes(b"\x00" * 200)
            resp = await client.post(
                "/v1/tts/wav",
                json={
                    "text": f"Extension {ext} test.",
                    "reference_audio_path": str(fpath),
                },
            )
            assert resp.status_code != 422, (
                f"Extension {ext} should be accepted by schema"
            )


@pytest.mark.asyncio
async def test_reference_path_invalid_extension():
    async with _make_client() as client:
        resp = await client.post(
            "/v1/tts/wav",
            json={"text": "Bad extension.", "reference_audio_path": "/tmp/test.txt"},
        )
    assert resp.status_code == 422


# ===================================================================
# 11. Error Handling (3 tests)
# ===================================================================


@pytest.mark.asyncio
async def test_concurrent_requests_queued():
    """With TTS_SEMAPHORE_CONCURRENCY=1, a request while semaphore is held gets 429."""
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        await main_mod.semaphore.acquire()
        try:
            resp = await client.post("/v1/tts/wav", json={"text": "Should be 429."})
            assert resp.status_code == 429
        finally:
            main_mod.semaphore.release()


@pytest.mark.asyncio
async def test_cancelled_synthesis_stays_busy_until_worker_finishes():
    started = threading.Event()
    release = threading.Event()

    def blocking_generate():
        started.set()
        release.wait(timeout=5)
        return np.zeros(4800, dtype=np.float32)

    task = asyncio.create_task(
        main_mod._run_synthesis_job(blocking_generate, timeout=5)
    )
    assert await asyncio.to_thread(started.wait, 1)

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert main_mod._synthesis_is_busy() is True
    assert main_mod._service_is_busy() is True

    release.set()
    assert await main_mod._drain_synthesis(timeout=1) is True
    await asyncio.sleep(0)
    assert main_mod._synthesis_is_busy() is False


@pytest.mark.asyncio
async def test_timed_out_worker_failure_is_consumed_and_logged_categorically(caplog):
    started = threading.Event()
    release = threading.Event()
    secret = "PRIVATE_REFERENCE_PATH_AND_TEXT"

    def delayed_failure():
        started.set()
        release.wait(timeout=5)
        raise RuntimeError(secret)

    with caplog.at_level("ERROR", logger="voxcpm.main"):
        task = asyncio.create_task(
            main_mod._run_synthesis_job(delayed_failure, timeout=0.01)
        )
        assert await asyncio.to_thread(started.wait, 1)
        with pytest.raises(asyncio.TimeoutError):
            await task

        assert main_mod._synthesis_is_busy() is True
        release.set()
        assert await main_mod._drain_synthesis(timeout=1) is True
        await asyncio.sleep(0)

    assert "synthesis worker failed error_type=RuntimeError" in caplog.text
    assert secret not in caplog.text
    assert main_mod._synthesis_is_busy() is False


@pytest.mark.asyncio
async def test_generate_with_none_body():
    async with _make_client() as client:
        resp = await client.post(
            "/generate",
            content=b"null",
            headers={"content-type": "application/json"},
        )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_unknown_endpoint_returns_404():
    async with _make_client() as client:
        resp = await client.get("/nonexistent")
    assert resp.status_code == 404
