import os
import re

from pydantic import BaseModel, Field, field_validator

from app.audio import (
    DEFAULT_SPEAKING_RATE,
    MAX_SPEAKING_RATE,
    MIN_SPEAKING_RATE,
)


_CONTROL_CHAR_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_AUDIO_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}


def _strip_control_chars(v: str) -> str:
    return _CONTROL_CHAR_RE.sub("", v)


def _validate_reference_audio_path(v: str | None) -> str | None:
    if v is None:
        return None
    v = os.path.normpath(v)
    if not os.path.isabs(v):
        raise ValueError("reference_audio_path must be an absolute path")
    ext = os.path.splitext(v)[1].lower()
    if ext not in _AUDIO_EXTENSIONS:
        raise ValueError(
            f"unsupported audio extension: {ext} (allowed: {', '.join(sorted(_AUDIO_EXTENSIONS))})"
        )
    return v


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=700)
    voice_profile_id: str | None = None
    format: str = "pcm_s16le"
    sample_rate: int = 48000
    cache: bool = True
    cfg_value: float | None = None
    inference_timesteps: int | None = None
    reference_audio_path: str | None = Field(
        None, description="Local filesystem path to reference WAV for voice cloning"
    )

    @field_validator("text", mode="before")
    @classmethod
    def sanitize_text(cls, v: str) -> str:
        return _strip_control_chars(v)

    @field_validator("reference_audio_path", mode="before")
    @classmethod
    def validate_reference_audio_path(cls, v: str | None) -> str | None:
        return _validate_reference_audio_path(v)


class TTSWavRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=700)
    voice_profile_id: str | None = None
    format: str = "wav"
    sample_rate: int = 48000
    cache: bool = True
    cfg_value: float | None = None
    inference_timesteps: int | None = None
    reference_audio_path: str | None = Field(
        None, description="Local filesystem path to reference WAV for voice cloning"
    )

    @field_validator("text", mode="before")
    @classmethod
    def sanitize_text(cls, v: str) -> str:
        return _strip_control_chars(v)

    @field_validator("reference_audio_path", mode="before")
    @classmethod
    def validate_reference_audio_path(cls, v: str | None) -> str | None:
        return _validate_reference_audio_path(v)


class HealthResponse(BaseModel):
    ok: bool
    engine: str
    model_loaded: bool
    sample_rate: int
    device: str
    voice_profiles: list[str]
    cache_size: int = 0
    cache_dir: str = ""


class CachePrimeRequest(BaseModel):
    phrases: list[str] = Field(..., min_length=1)
    voice_profile_id: str | None = None

    @field_validator("phrases", mode="before")
    @classmethod
    def sanitize_phrases(cls, v: list[str]) -> list[str]:
        return [_strip_control_chars(p) for p in v]


class VoxCpmBridgeRequest(BaseModel):
    """Request schema matching the existing VoxCPM bridge contract."""

    target_text: str = Field(..., min_length=1, max_length=700)
    speakingRate: float = Field(
        default=DEFAULT_SPEAKING_RATE,
        ge=MIN_SPEAKING_RATE,
        le=MAX_SPEAKING_RATE,
        allow_inf_nan=False,
    )
    cache: bool = True
    prompt_latents_base64: str | None = None
    prompt_text: str | None = None
    ref_audio_latents_base64: str | None = None
    reference_audio_path: str | None = Field(
        None, description="Local filesystem path to reference WAV for voice cloning"
    )

    @field_validator("target_text", mode="before")
    @classmethod
    def sanitize_target_text(cls, v: str) -> str:
        return _strip_control_chars(v)

    @field_validator("reference_audio_path", mode="before")
    @classmethod
    def validate_reference_audio_path(cls, v: str | None) -> str | None:
        return _validate_reference_audio_path(v)


class ReferenceAudioDownloadRequest(BaseModel):
    url: str = Field(..., description="URL to download reference audio from")
    clip_id: str | None = Field(None, description="Optional clip ID for filename")


class ReferenceAudioPrimeRequest(BaseModel):
    reference_audio_path: str = Field(
        ..., description="Local reference WAV to encode into the model prompt cache"
    )

    @field_validator("reference_audio_path", mode="before")
    @classmethod
    def validate_reference_audio_path(cls, v: str) -> str:
        return _validate_reference_audio_path(v)
