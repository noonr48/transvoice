"""Regression tests for the Tier-4 security/robustness fixes."""
from __future__ import annotations

from pathlib import Path
import tempfile
import unittest

from src.config import _parse_cors_origins, http_authorized, token_matches
from src.services.storage import VoiceStorage


class CorsFailClosedTests(unittest.TestCase):
    def test_blank_fails_closed(self):
        self.assertEqual(_parse_cors_origins(""), ())
        self.assertEqual(_parse_cors_origins("   "), ())
        self.assertEqual(_parse_cors_origins(" , , "), ())

    def test_wildcard_must_be_explicit(self):
        self.assertEqual(_parse_cors_origins("*"), ("*",))

    def test_list_parsed(self):
        self.assertEqual(
            _parse_cors_origins("http://a, http://b"), ("http://a", "http://b")
        )


class TokenAuthTests(unittest.TestCase):
    def test_auth_disabled_allows_all(self):
        self.assertTrue(token_matches("", ""))
        self.assertTrue(token_matches("anything", ""))
        self.assertTrue(http_authorized("", ""))

    def test_token_match(self):
        self.assertTrue(token_matches("secret", "secret"))
        self.assertFalse(token_matches("nope", "secret"))
        self.assertFalse(token_matches("", "secret"))

    def test_http_requires_bearer_header_not_query(self):
        # Bearer header authorizes...
        self.assertTrue(http_authorized("Bearer secret", "secret"))
        self.assertFalse(http_authorized("Bearer wrong", "secret"))
        self.assertFalse(http_authorized("secret", "secret"))  # missing 'Bearer '
        # ...and there is structurally no way to pass the token via query string
        # on HTTP (the function only accepts the Authorization header).


class ReferenceFilePathTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.storage = VoiceStorage(Path(self._tmp.name))

    def tearDown(self):
        self._tmp.cleanup()

    def test_rejects_path_traversal_clip_id(self):
        with self.assertRaises(ValueError):
            self.storage.store_reference_file("../../etc/passwd", "x.wav", b"data")
        with self.assertRaises(ValueError):
            self.storage.store_reference_file("not-hex", "x.wav", b"data")

    def test_accepts_valid_clip_id_and_writes_atomically(self):
        clip_id = "a" * 32
        path = self.storage.store_reference_file(clip_id, "voice.wav", b"\x00\x01\x02")
        self.assertTrue(path.exists())
        self.assertEqual(path.read_bytes(), b"\x00\x01\x02")
        # path stays inside the references_raw_dir
        self.assertEqual(path.parent, self.storage.references_raw_dir)
        # no leftover temp files
        leftovers = [p for p in self.storage.references_raw_dir.iterdir() if p.name.startswith(".")]
        self.assertEqual(leftovers, [])


if __name__ == "__main__":
    unittest.main()
