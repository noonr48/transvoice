import hashlib
import os
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

import pytest
import numpy as np
from httpx import ASGITransport, AsyncClient

from app.cache import AudioCache
from app.main import _REF_DIR, _cleanup_old_refs, app
from app.schemas import (
    ReferenceAudioDownloadRequest,
    TTSRequest,
    TTSWavRequest,
    VoxCpmBridgeRequest,
    _validate_reference_audio_path,
)


# ---------------------------------------------------------------------------
# Schema validation tests
# ---------------------------------------------------------------------------


class TestReferenceAudioPathValidation:
    def test_none_is_allowed(self):
        assert _validate_reference_audio_path(None) is None

    def test_valid_wav_path(self):
        path = "/tmp/voxcpm-refs/ref-abc123.wav"
        assert _validate_reference_audio_path(path) == path

    def test_valid_mp3_path(self):
        assert _validate_reference_audio_path("/tmp/test.mp3") == "/tmp/test.mp3"

    def test_valid_flac_path(self):
        assert _validate_reference_audio_path("/tmp/test.flac") == "/tmp/test.flac"

    def test_valid_ogg_path(self):
        assert _validate_reference_audio_path("/tmp/test.ogg") == "/tmp/test.ogg"

    def test_valid_m4a_path(self):
        assert _validate_reference_audio_path("/tmp/test.m4a") == "/tmp/test.m4a"

    def test_relative_path_rejected(self):
        with pytest.raises(ValueError, match="absolute path"):
            _validate_reference_audio_path("relative/path.wav")

    def test_unsupported_extension_rejected(self):
        with pytest.raises(ValueError, match="unsupported audio extension"):
            _validate_reference_audio_path("/tmp/test.txt")

    def test_unsupported_wav_like_extension_rejected(self):
        with pytest.raises(ValueError, match="unsupported audio extension"):
            _validate_reference_audio_path("/tmp/test.xyz")

    def test_path_traversal_stripped(self):
        result = _validate_reference_audio_path("/tmp/../../../etc/passwd.wav")
        assert ".." not in result

    def test_tts_request_accepts_reference_audio_path(self):
        req = TTSRequest(text="hello", reference_audio_path="/tmp/ref.wav")
        assert req.reference_audio_path == "/tmp/ref.wav"

    def test_tts_request_rejects_bad_path(self):
        with pytest.raises(ValueError):
            TTSRequest(text="hello", reference_audio_path="not-absolute.wav")

    def test_tts_wav_request_accepts_reference_audio_path(self):
        req = TTSWavRequest(text="hello", reference_audio_path="/tmp/ref.wav")
        assert req.reference_audio_path == "/tmp/ref.wav"

    def test_voxcpm_bridge_request_accepts_reference_audio_path(self):
        req = VoxCpmBridgeRequest(
            target_text="hello", reference_audio_path="/tmp/ref.wav"
        )
        assert req.reference_audio_path == "/tmp/ref.wav"

    def test_voxcpm_bridge_request_none_by_default(self):
        req = VoxCpmBridgeRequest(target_text="hello")
        assert req.reference_audio_path is None

    def test_download_request_model(self):
        req = ReferenceAudioDownloadRequest(
            url="http://example.com/audio.wav", clip_id="clip1"
        )
        assert req.url == "http://example.com/audio.wav"
        assert req.clip_id == "clip1"

    def test_download_request_no_clip_id(self):
        req = ReferenceAudioDownloadRequest(url="http://example.com/audio.wav")
        assert req.clip_id is None


# ---------------------------------------------------------------------------
# Cache key tests
# ---------------------------------------------------------------------------


class TestCacheKeyIncludesReferenceAudio:
    def test_keys_differ_with_different_reference_paths(self):
        key_no_ref = AudioCache.make_key("m", "v", 2.0, 8, True, "hello", "")
        key_with_ref = AudioCache.make_key(
            "m", "v", 2.0, 8, True, "hello", "/tmp/ref.wav"
        )
        assert key_no_ref != key_with_ref

    def test_keys_differ_between_different_references(self):
        key_a = AudioCache.make_key("m", "v", 2.0, 8, True, "hello", "/tmp/ref_a.wav")
        key_b = AudioCache.make_key("m", "v", 2.0, 8, True, "hello", "/tmp/ref_b.wav")
        assert key_a != key_b

    def test_same_params_same_key(self):
        key_a = AudioCache.make_key("m", "v", 2.0, 8, True, "hello", "/tmp/ref.wav")
        key_b = AudioCache.make_key("m", "v", 2.0, 8, True, "hello", "/tmp/ref.wav")
        assert key_a == key_b

    def test_default_empty_string_matches_old_behavior(self):
        key_default = AudioCache.make_key("m", "v", 2.0, 8, True, "hello")
        key_empty = AudioCache.make_key("m", "v", 2.0, 8, True, "hello", "")
        assert key_default == key_empty

    def test_key_is_sha256(self):
        key = AudioCache.make_key("m", "v", 2.0, 8, True, "test", "/tmp/r.wav")
        raw = "m|v|2.0|8|True|/tmp/r.wav||test"
        expected = hashlib.sha256(raw.encode("utf-8")).hexdigest()
        assert key == expected


# ---------------------------------------------------------------------------
# Upload endpoint tests
# ---------------------------------------------------------------------------


class TestReferenceAudioUpload:
    @pytest.mark.asyncio
    async def test_upload_returns_path(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            body = b"\x00" * 200  # 200 bytes, above 100 minimum
            resp = await client.post("/v1/reference-audio", content=body)
        assert resp.status_code == 200
        data = resp.json()
        assert "path" in data
        assert data["path"].startswith("/tmp/voxcpm-refs/ref-")
        assert data["path"].endswith(".wav")
        assert data["size"] == 200

    @pytest.mark.asyncio
    async def test_upload_too_small(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            body = b"\x00" * 50  # below 100 minimum
            resp = await client.post("/v1/reference-audio", content=body)
        assert resp.status_code == 400

    @pytest.mark.asyncio
    async def test_upload_empty_body(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post("/v1/reference-audio", content=b"")
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Cleanup tests
# ---------------------------------------------------------------------------


class TestCleanupOldRefs:
    def test_cleanup_removes_old_files(self):
        _REF_DIR.mkdir(parents=True, exist_ok=True)
        old_file = _REF_DIR / "ref-old-test.wav"
        old_file.write_bytes(b"\x00" * 200)
        old_time = time.time() - 7200  # 2 hours ago
        os.utime(old_file, (old_time, old_time))

        new_file = _REF_DIR / "ref-new-test.wav"
        new_file.write_bytes(b"\x00" * 200)

        _cleanup_old_refs()

        assert not old_file.exists()
        assert new_file.exists()

        new_file.unlink(missing_ok=True)

    def test_cleanup_no_op_if_dir_missing(self):
        with patch("app.main._REF_DIR", Path("/tmp/nonexistent-dir-12345")):
            _cleanup_old_refs()


# ---------------------------------------------------------------------------
# /generate endpoint reference audio override test
# ---------------------------------------------------------------------------


class TestGenerateWithReferenceAudio:
    @pytest.mark.asyncio
    async def test_generate_accepts_reference_audio_path(self):
        import asyncio

        import app.main as main_mod

        previous_loaded = main_mod.engine._loaded
        previous_model = main_mod.engine._model
        previous_semaphore = main_mod.semaphore
        main_mod.engine._loaded = True
        class _FakeModel:
            def generate(self, **_kwargs):
                return np.zeros(4800, dtype=np.float32)

        main_mod.engine._model = _FakeModel()
        main_mod.semaphore = asyncio.Semaphore(1)
        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/generate",
                    json={
                        "target_text": "Hello world",
                        "reference_audio_path": "/tmp/voxcpm-refs/ref-test12345678.wav",
                    },
                )
            assert resp.status_code == 200
        finally:
            main_mod.engine._loaded = previous_loaded
            main_mod.engine._model = previous_model
            main_mod.semaphore = previous_semaphore

    @pytest.mark.asyncio
    async def test_generate_refuses_reference_audio_without_real_model(self):
        import asyncio

        import app.main as main_mod

        previous_loaded = main_mod.engine._loaded
        previous_model = main_mod.engine._model
        previous_semaphore = main_mod.semaphore
        main_mod.engine._loaded = True
        main_mod.engine._model = None
        main_mod.semaphore = asyncio.Semaphore(1)
        try:
            transport = ASGITransport(app=app)
            async with AsyncClient(
                transport=transport, base_url="http://test"
            ) as client:
                resp = await client.post(
                    "/generate",
                    json={
                        "target_text": "No placeholder audio",
                        "reference_audio_path": "/tmp/voxcpm-refs/ref-test12345678.wav",
                    },
                )
            assert resp.status_code == 503
            assert "X-TTS-Generation-Mode" not in resp.headers
            assert "X-Reference-Audio-Role" not in resp.headers
        finally:
            main_mod.engine._loaded = previous_loaded
            main_mod.engine._model = previous_model
            main_mod.semaphore = previous_semaphore

    @pytest.mark.asyncio
    async def test_generate_rejects_relative_path(self):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            resp = await client.post(
                "/generate",
                json={
                    "target_text": "Hello world",
                    "reference_audio_path": "relative/path.wav",
                },
            )
        assert resp.status_code == 422
