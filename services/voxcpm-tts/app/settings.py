from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    VOXCPM_MODEL_ID: str = "openbmb/VoxCPM2"
    VOXCPM_DEVICE: str = "cuda:0"
    VOXCPM_LOAD_DENOISER: bool = False
    VOXCPM_OPTIMIZE: bool = True

    TTS_HOST: str = "127.0.0.1"
    TTS_PORT: int = 8020
    TTS_DEFAULT_VOICE_PROFILE: str = "coach_v1"
    TTS_CFG_VALUE: float = 2.0
    TTS_INFERENCE_TIMESTEPS: int = 8
    TTS_NORMALIZE: bool = True
    TTS_FORMAT: str = "pcm_s16le"
    TTS_SAMPLE_RATE: int = 48000
    TTS_MAX_TEXT_CHARS: int = 700
    TTS_MAX_SEGMENT_CHARS: int = 220
    TTS_MIN_SEGMENT_CHARS: int = 40
    TTS_CACHE_DIR: str = "./runtime-cache"
    TTS_CACHE_MAX_ENTRIES: int = 500
    TTS_SEMAPHORE_CONCURRENCY: int = 1

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
