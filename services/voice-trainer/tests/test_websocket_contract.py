from __future__ import annotations

import asyncio
from pathlib import Path
import socket
import tempfile
import unittest

import uvicorn
import websockets

from src.api.main import app
from src.services.contracts import VoiceSessionStartRequest
from src.services.storage import VoiceStorage

import src.services.streaming_analyzer as streaming_module


def _find_free_port() -> int:
  with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
    sock.bind(('127.0.0.1', 0))
    return int(sock.getsockname()[1])


class WebsocketContractTests(unittest.IsolatedAsyncioTestCase):
  async def asyncSetUp(self) -> None:
    self.temp_dir = tempfile.TemporaryDirectory()
    self.storage = VoiceStorage(Path(self.temp_dir.name))

    self._original_stream_storage = streaming_module.voice_storage
    streaming_module.voice_storage = self.storage

    port = _find_free_port()
    self._server = uvicorn.Server(
      uvicorn.Config(
        app,
        host='127.0.0.1',
        port=port,
        log_level='error',
        lifespan='off',
      )
    )
    self._server_task = asyncio.create_task(self._server.serve())

    # Wait for Uvicorn to bind.
    for _ in range(200):
      if getattr(self._server, 'started', False):
        break
      await asyncio.sleep(0.01)

    if not getattr(self._server, 'started', False):
      self._server.should_exit = True
      await self._server_task
      raise RuntimeError('Uvicorn server did not start in time')

    self.port = port

  async def asyncTearDown(self) -> None:
    streaming_module.voice_storage = self._original_stream_storage

    self._server.should_exit = True
    await asyncio.wait_for(self._server_task, timeout=5)

    self.temp_dir.cleanup()

  async def test_websocket_rejects_text_frames_with_1003(self) -> None:
    session = streaming_module.streaming_analyzer.start_session(
      VoiceSessionStartRequest(
        sloaneSessionId='sloane-session-ws-text',
        targetPreset='cute-feminine',
      )
    )

    url = f'ws://127.0.0.1:{self.port}/api/v1/voice/sessions/{session.voiceSessionId}/stream'
    async with websockets.connect(url) as websocket:
      await websocket.send('not pcm16')
      await asyncio.wait_for(websocket.wait_closed(), timeout=2)
      self.assertEqual(websocket.close_code, 1003)

  async def test_websocket_accepts_misaligned_chunks(self) -> None:
    # Real browser producers (AudioWorklet quanta, Opus packets, MTU-sized TCP
    # writes) almost never deliver exact 1024-sample PCM blocks. The server must
    # re-frame a stream of odd-sized chunks instead of disconnecting.
    session = streaming_module.streaming_analyzer.start_session(
      VoiceSessionStartRequest(
        sloaneSessionId='sloane-session-ws-misaligned',
        targetPreset='cute-feminine',
      )
    )

    url = f'ws://127.0.0.1:{self.port}/api/v1/voice/sessions/{session.voiceSessionId}/stream'
    async with websockets.connect(url) as websocket:
      # ~3 frames of audio, in 700-byte chunks that never align to 2048.
      total = 2048 * 3
      sent = 0
      chunk = b'\x11' * 700
      while sent < total:
        await websocket.send(chunk)
        sent += len(chunk)

      frames = []
      for _ in range(3):
        msg = await asyncio.wait_for(websocket.recv(), timeout=2)
        self.assertIn('"t"', msg)  # a VoiceFrame JSON, not an error
        frames.append(msg)
      self.assertEqual(len(frames), 3)
      # Connection is still open (not disconnected by a size check).
      self.assertIsNone(websocket.close_code)

  async def test_websocket_rejects_frames_after_session_end(self) -> None:
    session = streaming_module.streaming_analyzer.start_session(
      VoiceSessionStartRequest(
        sloaneSessionId='sloane-session-ws-ended',
        targetPreset='cute-feminine',
      )
    )

    url = f'ws://127.0.0.1:{self.port}/api/v1/voice/sessions/{session.voiceSessionId}/stream'
    async with websockets.connect(url) as websocket:
      await websocket.send(b'\x00' * 2048)
      # The server responds with a JSON analysis frame (text message). Drain one message.
      await asyncio.wait_for(websocket.recv(), timeout=2)

      streaming_module.streaming_analyzer.end_session(session.voiceSessionId)

      await websocket.send(b'\x00' * 2048)
      await asyncio.wait_for(websocket.wait_closed(), timeout=2)
      self.assertEqual(websocket.close_code, 1008)


if __name__ == '__main__':
  unittest.main()

