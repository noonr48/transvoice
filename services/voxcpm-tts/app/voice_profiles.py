import json
import logging
from dataclasses import dataclass
from pathlib import Path

logger = logging.getLogger("voxcpm.profiles")

VOICES_DIR = Path(__file__).resolve().parent.parent / "voices"


@dataclass
class VoiceProfile:
    id: str
    mode: str
    description: str
    reference_audio_path: str | None
    cfg_value: float
    inference_timesteps: int
    normalize: bool
    denoise: bool


_profiles: dict[str, VoiceProfile] = {}


def _load_profiles() -> None:
    for p in VOICES_DIR.glob("*.json"):
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
            profile = VoiceProfile(
                id=raw["id"],
                mode=raw["mode"],
                description=raw["description"],
                reference_audio_path=raw.get("reference_audio_path"),
                cfg_value=raw.get("cfg_value", 2.0),
                inference_timesteps=raw.get("inference_timesteps", 8),
                normalize=raw.get("normalize", True),
                denoise=raw.get("denoise", False),
            )
            _profiles[profile.id] = profile
            logger.info("loaded voice profile: %s", profile.id)
        except Exception:
            logger.error("failed to load profile %s", p, exc_info=True)


def get_profile(profile_id: str) -> VoiceProfile | None:
    if not _profiles:
        _load_profiles()
    return _profiles.get(profile_id)


def list_profile_ids() -> list[str]:
    if not _profiles:
        _load_profiles()
    return list(_profiles.keys())
