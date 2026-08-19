"""The single-stream slot: who holds it, and whether it is ever LEAKED (2026-07-27).

FIELD EVIDENCE that produced this file. During a live coach session the
gateway's per-turn analyzer take came back `http_409` and the coach turn
proceeded with no take evidence. The trainer journal for that exact second:

    00:10:14  WebSocket /api/v1/voice/sessions/<id>/stream [accepted]
    00:10:14  connection open
    00:10:18  POST   /api/v1/voice/sessions/<id>/take-oneshot  409 Conflict
    00:10:27  connection closed

So the slot was held by a genuinely OPEN practice socket for those 13 seconds,
and the one-shot refused to interleave — the guard doing exactly its job. The
suspected cause (a slot leaked by the session-start reanalysis / rebind path,
or by a one-shot that failed) was NOT what happened, and these tests exist so
that stays checkable rather than re-argued:

  * `acquire_stream` is reached from exactly two places (the /stream socket and
    `analyze_take_oneshot`), and BOTH release in a `finally`.
  * A 409 is therefore only ever a live holder, never a stuck flag — including
    after a socket that died abruptly, and after a one-shot that raised.

If a future change makes a 409 survive its holder, one of these goes red.
"""
from __future__ import annotations

import base64
import math
from pathlib import Path
import tempfile
import unittest

import numpy as np

from fastapi.testclient import TestClient

import src.services.streaming_analyzer as streaming_module
from src.api.main import app
from src.services.audio_analysis import LIVE_FRAME_SIZE, SAMPLE_RATE
from src.services.contracts import VoiceSessionStartRequest
from src.services.storage import VoiceStorage
from src.services.streaming_analyzer import (
    VoiceStreamBusyError,
    streaming_analyzer,
)


def vowel_pcm(duration_ms: int = 900, f0_hz: float = 196.0) -> bytes:
    """A deterministic voiced segment, long enough to register whole frames."""
    samples = int(SAMPLE_RATE * duration_ms / 1000)
    t = np.arange(samples, dtype=np.float64) / SAMPLE_RATE
    wave = np.zeros(samples, dtype=np.float64)
    for harmonic, gain in ((1, 1.0), (2, 0.5), (3, 0.35), (4, 0.2), (5, 0.12)):
        wave += gain * np.sin(2 * math.pi * f0_hz * harmonic * t)
    wave /= np.max(np.abs(wave)) or 1.0
    return (wave * 0.6 * 32767).astype('<i2').tobytes()


class StreamSlotHygieneTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._orig_storage = streaming_module.voice_storage
        streaming_module.voice_storage = VoiceStorage(Path(self._tmp.name))
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        streaming_module.voice_storage = self._orig_storage
        self._tmp.cleanup()

    def _start_session(self) -> str:
        return streaming_analyzer.start_session(
            VoiceSessionStartRequest(sloaneSessionId='slot', targetPreset='everyday-feminine')
        ).voiceSessionId

    def _oneshot(self, voice_session_id: str, pcm: bytes, reason: str = 'coach-turn'):
        return self.client.post(
            f'/api/v1/voice/sessions/{voice_session_id}/take-oneshot',
            json={'pcm16Base64': base64.b64encode(pcm).decode('ascii'), 'reason': reason},
        )

    def test_a_fresh_session_answers_a_coach_one_shot_immediately(self):
        """No holder, no 409. The baseline the field case failed to match."""
        sid = self._start_session()
        response = self._oneshot(sid, vowel_pcm())
        self.assertEqual(response.status_code, 200, response.text)

    def test_the_409_is_a_LIVE_holder_and_clears_the_moment_it_goes(self):
        """The exact field sequence, and its recovery.

        While the practice socket owns the session the coach's take is refused;
        the instant that socket closes the very next take succeeds. A 409 that
        outlived its socket would be the leak this file is here to catch.
        """
        sid = self._start_session()
        pcm = vowel_pcm()
        frame_bytes = LIVE_FRAME_SIZE * 2
        with self.client.websocket_connect(
            f'/api/v1/voice/sessions/{sid}/stream'
        ) as socket:
            socket.send_bytes(pcm[:frame_bytes])
            socket.receive_json()
            busy = self._oneshot(sid, pcm)
            self.assertEqual(busy.status_code, 409, busy.text)
            self.assertIn('active stream', busy.json()['detail'])
            socket.close()

        recovered = self._oneshot(sid, pcm)
        self.assertEqual(recovered.status_code, 200, recovered.text)

    def test_an_ABRUPTLY_dropped_socket_does_not_strand_the_slot(self):
        """A client that vanishes mid-frame (the normal mobile case).

        The socket handler's release lives in a `finally`, so a disconnect that
        never reaches a clean close still frees the session. Without that, one
        dropped connection would 409 every coach take for the rest of the
        session — which is what a real leak would look like in the field.
        """
        sid = self._start_session()
        pcm = vowel_pcm()
        frame_bytes = LIVE_FRAME_SIZE * 2
        socket_ctx = self.client.websocket_connect(f'/api/v1/voice/sessions/{sid}/stream')
        socket = socket_ctx.__enter__()
        socket.send_bytes(pcm[:frame_bytes])
        socket.receive_json()
        # Drop it without draining, the way a closed tab or a lost radio does.
        socket_ctx.__exit__(None, None, None)

        recovered = self._oneshot(sid, pcm)
        self.assertEqual(recovered.status_code, 200, recovered.text)

    def test_a_one_shot_that_RAISES_still_releases_the_slot(self):
        """The only leak a one-shot could cause, proven closed.

        `analyze_take_oneshot` claims the slot and releases it in a `finally`.
        If that ever became a plain post-call release, one failed take would
        wedge the session permanently — every later coach take 409, forever,
        with the socket long gone. This forces the failure and then proves the
        NEXT take still lands.
        """
        sid = self._start_session()
        pcm = vowel_pcm()
        original = streaming_analyzer.finalize_take

        def exploding_finalize(*args, **kwargs):
            raise RuntimeError('DSP blew up mid-take')

        streaming_analyzer.finalize_take = exploding_finalize
        try:
            with self.assertRaises(RuntimeError):
                streaming_analyzer.analyze_take_oneshot(sid, pcm, None, 'boom')
        finally:
            streaming_analyzer.finalize_take = original

        self.assertNotIn(sid, streaming_analyzer._active_streams)
        recovered = self._oneshot(sid, pcm)
        self.assertEqual(recovered.status_code, 200, recovered.text)

    def test_two_concurrent_one_shots_cannot_interleave(self):
        """The guard still has TEETH — this is not a test that only ever passes."""
        sid = self._start_session()
        self.assertTrue(streaming_analyzer.acquire_stream(sid))
        try:
            with self.assertRaises(VoiceStreamBusyError):
                streaming_analyzer.analyze_take_oneshot(sid, vowel_pcm(), None, 'second')
        finally:
            streaming_analyzer.release_stream(sid)

    def test_session_start_never_claims_the_slot(self):
        """Starting (or restarting) a session leaves the slot free.

        The field hypothesis was that the rebind sequence — a rejected start,
        a target refresh, then a second start — left the slot held. It does not:
        `start_session` never touches `_active_streams` at all, and the take
        that follows lands.
        """
        sid = self._start_session()
        self.assertNotIn(sid, streaming_analyzer._active_streams)
        # The rebind shape: a second start for the same sloane session.
        second = streaming_analyzer.start_session(
            VoiceSessionStartRequest(sloaneSessionId='slot', targetPreset='everyday-feminine')
        ).voiceSessionId
        self.assertNotIn(second, streaming_analyzer._active_streams)
        self.assertEqual(self._oneshot(second, vowel_pcm()).status_code, 200)


if __name__ == '__main__':
    unittest.main()
