"""Regression tests for the streaming-path hardening (E1/E2/E3)."""
from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

import numpy as np

import src.services.streaming_analyzer as sm
from src.services.streaming_analyzer import (
    SESSION_PERSIST_INTERVAL_FRAMES,
    StreamingAnalyzer,
)
from src.services.storage import VoiceStorage
from src.services.contracts import VoiceSessionStartRequest
from src.services.audio_analysis import LIVE_FRAME_SIZE, SAMPLE_RATE


class StreamingHardeningTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._orig_storage = sm.voice_storage
        sm.voice_storage = VoiceStorage(Path(self._tmp.name))
        self.analyzer = StreamingAnalyzer()
        self.session = self.analyzer.start_session(
            VoiceSessionStartRequest(
                sloaneSessionId="s", targetPreset="everyday-feminine"
            )
        )

    def tearDown(self):
        sm.voice_storage = self._orig_storage
        self._tmp.cleanup()

    def _frame_bytes(self):
        rng = np.random.default_rng(0)
        return rng.integers(-2000, 2000, LIVE_FRAME_SIZE, dtype=np.int16).tobytes()

    def test_session_cache_stays_current_despite_throttled_disk_writes(self):
        # E1: full session JSON is flushed only every N frames, but get_session
        # (cache-first) must still reflect every frame, and the append-only frame
        # log must hold the full take.
        sid = self.session.voiceSessionId
        n = SESSION_PERSIST_INTERVAL_FRAMES + 5
        for _ in range(n):
            self.analyzer.register_frame(sid, self._frame_bytes())
        self.assertEqual(self.analyzer.get_session(sid).frameCount, n)
        self.assertEqual(len(sm.voice_storage.get_session_frames(sid)), n)

    def test_cold_start_offset_is_contiguous_not_duplicated(self):
        # E3: after a cache eviction the next frame's timestamp must continue
        # from the true write position, not duplicate the last frame's start.
        sid = self.session.voiceSessionId
        for _ in range(4):
            self.analyzer.register_frame(sid, self._frame_bytes())
        self.analyzer._sample_offset.pop(sid, None)
        self.analyzer._frame_index.pop(sid, None)
        frame = self.analyzer.register_frame(sid, self._frame_bytes())
        expected_ms = int(round(4 * LIVE_FRAME_SIZE * 1000 / SAMPLE_RATE))
        self.assertEqual(frame.t, expected_ms)

    def test_concurrent_stream_guard(self):
        # E2: only one active stream per session.
        sid = self.session.voiceSessionId
        self.assertTrue(self.analyzer.acquire_stream(sid))
        self.assertFalse(self.analyzer.acquire_stream(sid))
        self.analyzer.release_stream(sid)
        self.assertTrue(self.analyzer.acquire_stream(sid))


if __name__ == "__main__":
    unittest.main()
