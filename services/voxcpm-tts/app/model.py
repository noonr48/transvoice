import hashlib
import logging
import re
import time
from collections import OrderedDict
from typing import Generator

import numpy as np
import torch

from app.settings import Settings
from app.voice_profiles import VoiceProfile

logger = logging.getLogger("voxcpm.engine")
SYNTHESIS_POLICY_VERSION = "selected-reference-identity-v1"


def reference_content_digest(reference_audio_path: str | None) -> str:
    """Return a cache identity that changes when reference bytes change."""
    if not reference_audio_path:
        return ""
    digest = hashlib.sha256()
    try:
        with open(reference_audio_path, "rb") as reference_file:
            for chunk in iter(lambda: reference_file.read(1024 * 1024), b""):
                digest.update(chunk)
    except FileNotFoundError:
        # Synthesis will still fail honestly when the engine opens the missing
        # reference. Keep cache identity deterministic without exposing paths.
        digest.update(b"missing-reference\0")
        digest.update(reference_audio_path.encode("utf-8"))
    return digest.hexdigest()


def synthesis_text(text: str, voice_profile: VoiceProfile) -> str:
    if (
        not voice_profile.reference_audio_path
        and voice_profile.mode == "design"
        and voice_profile.description
    ):
        return f"({voice_profile.description}){text}"
    return text


def synthesis_cache_context(voice_profile: VoiceProfile) -> str:
    if voice_profile.reference_audio_path:
        return f"{SYNTHESIS_POLICY_VERSION}|reference-only"
    return (
        f"{SYNTHESIS_POLICY_VERSION}|{voice_profile.mode}|"
        f"{voice_profile.description}"
    )


class VoxCPMEngine:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._model = None
        self._loaded = False
        # VoxCPM otherwise re-encodes the selected reference WAV for every new
        # tutor sentence. Keep a tiny content-addressed GPU cache; selected
        # presets are few, and content hashing prevents stale voice identity
        # when a path is reused for a newly uploaded sample.
        self._reference_prompt_caches: OrderedDict[str, dict] = OrderedDict()
        self._reference_prompt_cache_limit = 4

    @property
    def loaded(self) -> bool:
        # Readiness means the real VoxCPM model is present. A boolean flag on
        # its own must never authorize mock or placeholder audio as tutor TTS.
        return self._loaded and self._model is not None

    @property
    def sample_rate(self) -> int:
        return self._settings.TTS_SAMPLE_RATE

    @property
    def device(self) -> str:
        return self._settings.VOXCPM_DEVICE

    def load(self) -> None:
        logger.info(
            "loading VoxCPM model=%s device=%s optimize=%s denoiser=%s",
            self._settings.VOXCPM_MODEL_ID,
            self._settings.VOXCPM_DEVICE,
            self._settings.VOXCPM_OPTIMIZE,
            self._settings.VOXCPM_LOAD_DENOISER,
        )
        t0 = time.monotonic()
        self._model = None
        self._loaded = False
        try:
            from voxcpm import VoxCPM

            self._model = VoxCPM.from_pretrained(
                hf_model_id=self._settings.VOXCPM_MODEL_ID,
                load_denoiser=self._settings.VOXCPM_LOAD_DENOISER,
                optimize=self._settings.VOXCPM_OPTIMIZE,
                device=self._settings.VOXCPM_DEVICE,
            )
            logger.info("VoxCPM model loaded successfully")
            self._loaded = True
        except Exception as exc:
            logger.error(
                "voxcpm model load failed (%s); synthesis remains unavailable",
                exc,
            )
            self._model = None
            self._loaded = False
        elapsed = time.monotonic() - t0
        logger.info("model init completed in %.2fs", elapsed)

    def unload(self) -> None:
        """Release model and GPU resources."""
        self._reference_prompt_caches.clear()
        self._model = None
        self._loaded = False
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
        logger.info("VoxCPM engine unloaded")

    @staticmethod
    def _reference_content_key(reference_audio_path: str) -> str:
        return reference_content_digest(reference_audio_path)

    def _get_reference_prompt_cache(self, reference_audio_path: str) -> dict:
        cache_key = self._reference_content_key(reference_audio_path)
        cached = self._reference_prompt_caches.get(cache_key)
        if cached is not None:
            self._reference_prompt_caches.move_to_end(cache_key)
            logger.info("reference feature cache hit prepare_ms=0")
            return cached

        started = time.monotonic()
        prompt_cache = self._model.tts_model.build_prompt_cache(
            reference_wav_path=reference_audio_path,
        )
        self._reference_prompt_caches[cache_key] = prompt_cache
        self._reference_prompt_caches.move_to_end(cache_key)
        while len(self._reference_prompt_caches) > self._reference_prompt_cache_limit:
            self._reference_prompt_caches.popitem(last=False)
        logger.info(
            "reference feature cache miss prepare_ms=%d entries=%d",
            round((time.monotonic() - started) * 1000),
            len(self._reference_prompt_caches),
        )
        return prompt_cache

    def prepare_reference(self, reference_audio_path: str) -> bool:
        """Encode a selected voice without synthesizing or exposing audio.

        Returns ``True`` when the content-addressed prompt features were already
        present and ``False`` when this call built them.
        """
        if not self.loaded:
            raise RuntimeError("model not loaded")
        tts_model = getattr(self._model, "tts_model", None)
        if tts_model is None or not hasattr(tts_model, "build_prompt_cache"):
            raise RuntimeError("reference prompt caching is unavailable")
        cache_key = self._reference_content_key(reference_audio_path)
        cache_hit = cache_key in self._reference_prompt_caches
        self._get_reference_prompt_cache(reference_audio_path)
        return cache_hit

    def _generate_with_cached_reference(
        self, text: str, voice_profile: VoiceProfile
    ) -> np.ndarray:
        synth_text = re.sub(r"\s+", " ", text.replace("\n", " ")).strip()
        if voice_profile.normalize:
            if self._model.text_normalizer is None:
                from voxcpm.utils.text_normalize import TextNormalizer

                self._model.text_normalizer = TextNormalizer()
            synth_text = self._model.text_normalizer.normalize(synth_text)

        prompt_cache = self._get_reference_prompt_cache(
            voice_profile.reference_audio_path
        )
        wav, _, _ = self._model.tts_model.generate_with_prompt_cache(
            target_text=synth_text,
            prompt_cache=prompt_cache,
            min_len=2,
            max_len=4096,
            inference_timesteps=voice_profile.inference_timesteps,
            cfg_value=voice_profile.cfg_value,
            retry_badcase=True,
            retry_badcase_max_times=3,
            retry_badcase_ratio_threshold=6.0,
        )
        return wav.squeeze(0).cpu().numpy()

    def generate(self, text: str, voice_profile: VoiceProfile) -> np.ndarray:
        if not self.loaded:
            raise RuntimeError("model not loaded")

        # A selected reference is the complete voice identity. Never mix a
        # built-in design description into cloned synthesis; it can bias a
        # masculine, neutral, or custom preset toward the default profile.
        synth_text = synthesis_text(text, voice_profile)

        if voice_profile.reference_audio_path:
            logger.info("voice cloning mode: reference_present=true")

        try:
            if (
                voice_profile.reference_audio_path
                and not voice_profile.denoise
                and hasattr(self._model, "tts_model")
                and hasattr(self._model.tts_model, "build_prompt_cache")
                and hasattr(self._model.tts_model, "generate_with_prompt_cache")
            ):
                return self._generate_with_cached_reference(synth_text, voice_profile)
            return self._model.generate(
                text=synth_text,
                reference_wav_path=voice_profile.reference_audio_path or None,
                cfg_value=voice_profile.cfg_value,
                inference_timesteps=voice_profile.inference_timesteps,
                normalize=voice_profile.normalize,
                denoise=voice_profile.denoise,
            )
        except torch.cuda.OutOfMemoryError:
            torch.cuda.empty_cache()
            raise RuntimeError("GPU out of memory during synthesis") from None

    def generate_streaming(
        self, text: str, voice_profile: VoiceProfile
    ) -> Generator[np.ndarray, None, None]:
        """Generate audio as streaming PCM chunks.

        Uses VoxCPM's native streaming if available, otherwise falls back
        to chunking the full waveform.
        """
        if not self.loaded:
            raise RuntimeError("model not loaded")
        synth_text = synthesis_text(text, voice_profile)

        for chunk in self._model.generate_streaming(
            text=synth_text,
            reference_wav_path=voice_profile.reference_audio_path or None,
            cfg_value=voice_profile.cfg_value,
            inference_timesteps=voice_profile.inference_timesteps,
            normalize=voice_profile.normalize,
            denoise=voice_profile.denoise,
        ):
            # VoxCPM streaming yields float32 arrays, convert to int16
            yield self._float32_to_pcm(chunk)

    def _float32_to_pcm(self, wav: np.ndarray) -> np.ndarray:
        clipped = np.clip(wav, -1.0, 1.0)
        return (clipped * 32767.0).astype(np.int16)
