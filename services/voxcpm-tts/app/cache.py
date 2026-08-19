import hashlib
import logging
import threading
from collections import OrderedDict
from pathlib import Path
from typing import Callable

import numpy as np

from app.settings import settings

logger = logging.getLogger("voxcpm.cache")


class AudioCache:
    def __init__(self, cache_dir: str, max_entries: int):
        self._dir = Path(cache_dir) / "audio"
        self._dir.mkdir(parents=True, exist_ok=True)
        self._max = max_entries
        self._index: OrderedDict[str, Path] = OrderedDict()
        self._lock = threading.Lock()
        self._scan_existing()

    def _scan_existing(self) -> None:
        for f in sorted(self._dir.glob("*.npy"), key=lambda p: p.stat().st_mtime):
            self._index[f.stem] = f
            if len(self._index) > self._max:
                oldest_key, oldest_path = self._index.popitem(last=False)
                oldest_path.unlink(missing_ok=True)

    @staticmethod
    def make_key(
        model_id: str,
        voice_profile_id: str,
        cfg_value: float,
        timesteps: int,
        normalize: bool,
        text: str,
        reference_audio_digest: str = "",
        synthesis_context: str = "",
    ) -> str:
        raw = (
            f"{model_id}|{voice_profile_id}|{cfg_value}|{timesteps}|{normalize}|"
            f"{reference_audio_digest}|{synthesis_context}|{text}"
        )
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def get(self, key: str) -> np.ndarray | None:
        path = self._dir / f"{key}.npy"
        if not path.exists():
            return None
        try:
            data = np.load(str(path), allow_pickle=False)
            with self._lock:
                self._index.move_to_end(key)
            return data
        except Exception:
            logger.warning("cache read failed for %s", key, exc_info=True)
            path.unlink(missing_ok=True)
            with self._lock:
                self._index.pop(key, None)
            return None

    def put(self, key: str, audio: np.ndarray) -> None:
        with self._lock:
            while len(self._index) >= self._max:
                oldest_key, oldest_path = self._index.popitem(last=False)
                oldest_path.unlink(missing_ok=True)
        path = self._dir / f"{key}.npy"
        np.save(str(path), audio, allow_pickle=False)
        with self._lock:
            self._index[key] = path

    @property
    def size(self) -> int:
        with self._lock:
            return len(self._index)

    @property
    def cache_dir(self) -> str:
        return str(self._dir)

    def prime(
        self,
        phrases: list[str],
        generate_fn: Callable[[str], np.ndarray],
        model_id: str = "",
        voice_profile_id: str = "",
        cfg_value: float = 2.0,
        timesteps: int = 8,
        normalize: bool = True,
    ) -> int:
        count = 0
        for phrase in phrases:
            try:
                key = self.make_key(
                    model_id, voice_profile_id, cfg_value, timesteps, normalize, phrase
                )
                if self.get(key) is not None:
                    continue
                audio = generate_fn(phrase)
                self.put(key, audio)
                count += 1
            except Exception:
                logger.warning(
                    "prime failed for phrase: %s", phrase[:60], exc_info=True
                )
        return count


_cache: AudioCache | None = None


def get_cache() -> AudioCache:
    global _cache
    if _cache is None:
        _cache = AudioCache(settings.TTS_CACHE_DIR, settings.TTS_CACHE_MAX_ENTRIES)
    return _cache
