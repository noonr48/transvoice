"""One-shot take endpoint — the coach loop's door into the analyzer (2026-07-26).

The gateway's coach surface never opens a WebSocket to this service: by the time
it has a take, it holds a finished trimmed PCM segment. POST
/api/v1/voice/sessions/{id}/take-oneshot lets that segment become a real take.

The load-bearing property under test is IDENTITY: a one-shot take and a streamed
take of the SAME audio must produce the same artifact, because they run the same
internals. If these tests ever diverge, a second scoring path has been forked.
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
from src.services.storage import VoiceStorage, model_to_dict
from src.services.streaming_analyzer import (
    ONESHOT_MAX_PCM_BYTES,
    StreamingAnalyzer,
    VoiceSessionEndedError,
    VoiceStreamBusyError,
    streaming_analyzer,
)


def vowel_pcm(duration_ms: int = 1500, f0_hz: float = 196.0) -> bytes:
    """A synthesized sustained vowel: a harmonic stack with formant-ish emphasis.

    Deterministic, voiced enough to score, and rich enough that the analyzer's
    pitch/resonance/weight axes all have something real to read.
    """
    sample_count = int(SAMPLE_RATE * duration_ms / 1000)
    t = np.arange(sample_count, dtype=np.float64) / SAMPLE_RATE
    signal = np.zeros(sample_count, dtype=np.float64)
    # Harmonics with a formant-like envelope peaking near 700 Hz and 1800 Hz.
    for harmonic in range(1, 25):
        freq = f0_hz * harmonic
        if freq >= SAMPLE_RATE / 2:
            break
        envelope = (
            1.0 / (1.0 + ((freq - 700.0) / 260.0) ** 2)
            + 0.55 / (1.0 + ((freq - 1800.0) / 420.0) ** 2)
        )
        signal += envelope * np.sin(2 * math.pi * freq * t)
    peak = float(np.max(np.abs(signal))) or 1.0
    scaled = (signal / peak) * 0.32 * 32767.0
    return scaled.astype(np.int16).tobytes()


def hum_pcm(duration_ms: int = 1500, f0_hz: float = 165.0) -> bytes:
    """A wordless hum: one tone plus a weak second harmonic. No speech in it."""
    sample_count = int(SAMPLE_RATE * duration_ms / 1000)
    t = np.arange(sample_count, dtype=np.float64) / SAMPLE_RATE
    signal = (
        np.sin(2 * math.pi * f0_hz * t)
        + 0.28 * np.sin(2 * math.pi * f0_hz * 2 * t)
    )
    scaled = (signal / 1.28) * 0.30 * 32767.0
    return scaled.astype(np.int16).tobytes()


def stream_take(analyzer: StreamingAnalyzer, voice_session_id: str, pcm: bytes, **kwargs):
    """Drive a take the way api/routers/sessions.py's WebSocket drives one.

    Same re-framing rule (whole LIVE_FRAME_SIZE frames, partial remainder left
    in the buffer and never registered), same finalize call.
    """
    frame_bytes = LIVE_FRAME_SIZE * 2
    offset = 0
    while len(pcm) - offset >= frame_bytes:
        analyzer.register_frame(voice_session_id, pcm[offset:offset + frame_bytes])
        offset += frame_bytes
    return analyzer.finalize_take(voice_session_id, **kwargs)


class TakeOneShotAnalyzerTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._orig_storage = streaming_module.voice_storage
        streaming_module.voice_storage = VoiceStorage(Path(self._tmp.name))
        self.analyzer = StreamingAnalyzer()

    def tearDown(self):
        streaming_module.voice_storage = self._orig_storage
        self._tmp.cleanup()

    def _session(self, preset: str = 'everyday-feminine') -> str:
        return self.analyzer.start_session(
            VoiceSessionStartRequest(sloaneSessionId='s', targetPreset=preset)
        ).voiceSessionId

    def test_oneshot_take_is_identical_to_a_streamed_take_of_the_same_audio(self):
        pcm = vowel_pcm()

        streamed_sid = self._session()
        streamed = stream_take(self.analyzer, streamed_sid, pcm, reason='streamed')
        oneshot_sid = self._session()
        oneshot = self.analyzer.analyze_take_oneshot(oneshot_sid, pcm, reason='oneshot')

        self.assertIsNotNone(streamed)
        self.assertIsNotNone(oneshot)
        streamed_artifact = streamed.attemptArtifact
        oneshot_artifact = oneshot.attemptArtifact
        self.assertIsNotNone(streamed_artifact)
        self.assertIsNotNone(oneshot_artifact)

        # Timeline shape: same frames in, same frames out, same compression.
        self.assertGreater(oneshot_artifact.frameCount, 0)
        for field in (
            'frameCount',
            'timelineFrameCount',
            'timelineSampledFrameCount',
            'timelineCompression',
            'durationMs',
            'analysisVersion',
            'targetPreset',
            'includesRawAudio',
        ):
            self.assertEqual(
                getattr(oneshot_artifact, field),
                getattr(streamed_artifact, field),
                f'{field} diverged between the one-shot and streamed paths',
            )

        # Metrics: the whole block, value for value.
        self.assertEqual(
            model_to_dict(oneshot_artifact.metrics),
            model_to_dict(streamed_artifact.metrics),
        )
        # Timeline frames: same timestamps and same per-frame readings.
        self.assertEqual(
            [model_to_dict(frame) for frame in oneshot_artifact.timeline],
            [model_to_dict(frame) for frame in streamed_artifact.timeline],
        )
        # Downstream coaching payloads derived from the take.
        self.assertEqual(oneshot_artifact.issues, streamed_artifact.issues)
        self.assertEqual(oneshot_artifact.nextDrills, streamed_artifact.nextDrills)
        self.assertEqual(
            model_to_dict(oneshot_artifact.target),
            model_to_dict(streamed_artifact.target),
        )
        # And the summary the caller reads back.
        streamed_summary = model_to_dict(streamed.summary)
        oneshot_summary = model_to_dict(oneshot.summary)
        for volatile in ('voiceSessionId',):
            streamed_summary.pop(volatile, None)
            oneshot_summary.pop(volatile, None)
        self.assertEqual(oneshot_summary, streamed_summary)

    def test_trailing_partial_frame_is_discarded_exactly_as_the_socket_discards_it(self):
        # Two whole frames plus 300 leftover samples. The WebSocket carries that
        # remainder in its buffer and never registers it; so must the one-shot.
        pcm = vowel_pcm()[: (LIVE_FRAME_SIZE * 2 + 300) * 2]
        sid = self._session()
        session = self.analyzer.analyze_take_oneshot(sid, pcm)
        self.assertEqual(session.attemptArtifact.frameCount, 2)

    def test_wordless_hum_still_yields_a_scored_take(self):
        # There is no transcript concept on this path — a hum is a full take.
        sid = self._session()
        session = self.analyzer.analyze_take_oneshot(sid, hum_pcm(), take_kind='hum_sovt')
        artifact = session.attemptArtifact
        self.assertIsNotNone(artifact)
        self.assertGreater(artifact.frameCount, 0)
        self.assertGreater(len(artifact.timeline), 0)
        self.assertGreater(artifact.durationMs, 0)
        self.assertIsNotNone(artifact.metrics)
        metrics = model_to_dict(artifact.metrics)
        self.assertTrue(metrics, 'a hum must still produce a metrics block')
        # take_kind lands where a streamed take carries it.
        self.assertIsNotNone(artifact.repContext)
        self.assertEqual(artifact.repContext.kind, 'hum_sovt')

    def test_explicit_rep_context_keeps_its_own_kind(self):
        from src.services.contracts import VoiceRepContext

        sid = self._session()
        session = self.analyzer.analyze_take_oneshot(
            sid,
            hum_pcm(),
            rep_context=VoiceRepContext(kind='siren', drillId='masc-vocalise-siren'),
            take_kind='hum_sovt',
        )
        self.assertEqual(session.attemptArtifact.repContext.kind, 'siren')

    def test_an_ended_session_stays_ended(self):
        # register_frame raises for an ended session, but only once a whole
        # frame exists. A sub-frame payload used to register nothing, fall
        # through to finalize_take, and RESURRECT the session (ended -> ready,
        # endedAt -> None). The coach leg fires automatically on every turn, so
        # that had to become impossible rather than merely unlikely.
        sid = self._session()
        self.analyzer.end_session(sid, reason='learner ended')
        self.assertEqual(self.analyzer.get_session(sid).status, 'ended')

        for payload in (vowel_pcm(), vowel_pcm()[: (LIVE_FRAME_SIZE - 8) * 2]):
            with self.assertRaises(VoiceSessionEndedError):
                self.analyzer.analyze_take_oneshot(sid, payload)

        after = self.analyzer.get_session(sid)
        self.assertEqual(after.status, 'ended')
        self.assertIsNotNone(after.endedAt)
        # And the refused attempts left the stream slot free.
        self.assertTrue(self.analyzer.acquire_stream(sid))

    def test_unknown_session_returns_none(self):
        self.assertIsNone(self.analyzer.analyze_take_oneshot('no-such-session', vowel_pcm()))

    def test_active_stream_blocks_a_one_shot_take(self):
        sid = self._session()
        self.assertTrue(self.analyzer.acquire_stream(sid))
        with self.assertRaises(VoiceStreamBusyError):
            self.analyzer.analyze_take_oneshot(sid, vowel_pcm())
        self.analyzer.release_stream(sid)
        # Slot released cleanly by the failed attempt: the next take works.
        self.assertIsNotNone(self.analyzer.analyze_take_oneshot(sid, vowel_pcm()))
        # ...and leaves the slot free again.
        self.assertTrue(self.analyzer.acquire_stream(sid))


class TakeOneShotRouteTests(unittest.TestCase):
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
            VoiceSessionStartRequest(sloaneSessionId='route', targetPreset='everyday-feminine')
        ).voiceSessionId

    def _post(self, voice_session_id: str, **body):
        return self.client.post(
            f'/api/v1/voice/sessions/{voice_session_id}/take-oneshot',
            json=body,
        )

    def test_one_shot_matches_a_take_driven_through_the_REAL_websocket_route(self):
        """The identity proof that can actually catch drift.

        The analyzer-level test above re-implements the socket's re-framing rule
        inside the test, so if the real route ever changed that rule the test
        and the code would drift together and still agree. This one drives the
        actual `/stream` WebSocket endpoint and the actual `/take` route, then
        compares against the actual `/take-oneshot` route on the same audio.
        """
        pcm = vowel_pcm()

        streamed_sid = self._start_session()
        frame_bytes = LIVE_FRAME_SIZE * 2
        with self.client.websocket_connect(
            f'/api/v1/voice/sessions/{streamed_sid}/stream'
        ) as socket:
            # Chunked at a size that is NOT a frame multiple, exactly as a real
            # browser client sends: the route must re-frame it itself.
            #
            # Drain in lockstep. The route emits exactly one JSON frame per
            # REGISTERED analysis frame, so after N bytes have been sent it has
            # emitted N // frame_bytes of them. Closing without draining loses
            # the ones still queued and truncates the take.
            sent = 0
            received = 0
            for offset in range(0, len(pcm), 700):
                chunk = pcm[offset:offset + 700]
                socket.send_bytes(chunk)
                sent += len(chunk)
                while received < sent // frame_bytes:
                    socket.receive_json()
                    received += 1
            self.assertEqual(received, len(pcm) // frame_bytes)
            socket.close()
        streamed = self.client.post(
            f'/api/v1/voice/sessions/{streamed_sid}/take',
            json={'reason': 'streamed'},
        )
        self.assertEqual(streamed.status_code, 200, streamed.text)

        oneshot_sid = self._start_session()
        oneshot = self._post(
            oneshot_sid,
            pcm16Base64=base64.b64encode(pcm).decode('ascii'),
            reason='oneshot',
        )
        self.assertEqual(oneshot.status_code, 200, oneshot.text)

        streamed_body = streamed.json()
        oneshot_body = oneshot.json()
        self.assertEqual(sorted(streamed_body.keys()), sorted(oneshot_body.keys()))

        s_art = streamed_body['attemptArtifact']
        o_art = oneshot_body['attemptArtifact']
        self.assertGreater(o_art['frameCount'], 0)
        for field in (
            'frameCount',
            'timelineFrameCount',
            'timelineSampledFrameCount',
            'timelineCompression',
            'durationMs',
            'analysisVersion',
            'targetPreset',
            'metrics',
            'timeline',
            'issues',
            'nextDrills',
            'target',
        ):
            self.assertEqual(
                o_art[field],
                s_art[field],
                f'{field} diverged between the REAL websocket route and the one-shot route',
            )

    def test_one_shot_take_returns_the_streamed_take_payload_shape(self):
        sid = self._start_session()
        response = self._post(
            sid,
            pcm16Base64=base64.b64encode(vowel_pcm()).decode('ascii'),
            sloaneSessionId='route',
            takeKind='phrase',
        )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(
            sorted(payload.keys()),
            ['attemptArtifact', 'status', 'streamUrl', 'summary', 'voiceSessionId'],
        )
        self.assertEqual(payload['voiceSessionId'], sid)
        self.assertEqual(payload['status'], 'ready')
        self.assertIsNotNone(payload['summary'])
        self.assertIsNotNone(payload['attemptArtifact'])
        self.assertTrue(payload['attemptArtifact']['attemptArtifactId'])
        self.assertGreater(payload['attemptArtifact']['frameCount'], 0)

    def test_unknown_session_is_404(self):
        response = self._post(
            'ffffffffffffffffffffffffffffffff',
            pcm16Base64=base64.b64encode(vowel_pcm(duration_ms=200)).decode('ascii'),
        )
        self.assertEqual(response.status_code, 404)

    def test_odd_length_payload_is_400(self):
        sid = self._start_session()
        response = self._post(sid, pcm16Base64=base64.b64encode(b'\x01\x02\x03').decode('ascii'))
        self.assertEqual(response.status_code, 400)
        self.assertIn('16-bit', response.json()['detail'])

    def test_invalid_base64_is_400(self):
        sid = self._start_session()
        response = self._post(sid, pcm16Base64='not base64 !!!')
        self.assertEqual(response.status_code, 400)

    def test_empty_payload_is_400(self):
        sid = self._start_session()
        response = self._post(sid, pcm16Base64='')
        self.assertEqual(response.status_code, 400)

    def test_oversized_payload_is_413(self):
        sid = self._start_session()
        oversized = base64.b64encode(b'\x00' * (ONESHOT_MAX_PCM_BYTES + 2)).decode('ascii')
        response = self._post(sid, pcm16Base64=oversized)
        self.assertEqual(response.status_code, 413)

    def test_active_stream_is_409(self):
        sid = self._start_session()
        self.assertTrue(streaming_analyzer.acquire_stream(sid))
        try:
            response = self._post(
                sid,
                pcm16Base64=base64.b64encode(vowel_pcm(duration_ms=300)).decode('ascii'),
            )
            self.assertEqual(response.status_code, 409)
        finally:
            streaming_analyzer.release_stream(sid)


if __name__ == '__main__':
    unittest.main()
