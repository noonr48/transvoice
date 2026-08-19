from __future__ import annotations

from dataclasses import dataclass
import math
from pathlib import Path
import re
import shutil
import subprocess
import wave

import numpy as np

from src.services.contracts import (
    ReferenceAnalysisResponse,
    VOICE_ANALYSIS_VERSION,
    VOICE_TARGET_PITCH_MAX_HZ,
    VOICE_TARGET_PITCH_MIN_HZ,
    VoiceAttemptAdvancedMetrics,
    VoiceAttemptFormantLiteMetrics,
    VoiceAttemptMetrics,
    VoiceAttemptQualityMetrics,
    VoiceAttemptSummary,
    VoiceAttemptTarget,
    VoiceFrame,
    VoiceFrameAdvancedMetrics,
    VoicePhraseForecastResponse,
    VoiceTargetAdvancedBands,
    VoiceTargetFormantLiteBands,
    VoiceTargetQualityBands,
    VoiceTargetProfile as VoiceTargetVoiceProfile,
)


SAMPLE_RATE = 16000
LIVE_FRAME_SIZE = 1024  # 64ms at 16kHz — legacy live-path frame size
LIVE_HOP_SIZE = LIVE_FRAME_SIZE
REFERENCE_HOP_SIZE = 512  # 32ms at 16kHz — reference/forecast path hop

# Phase 1.8: analysis-quality windowing (dense voiced detection).
# Smaller windows + overlap give 10× higher frame rate (100 fps vs ~16 fps),
# which improves voiced-region boundary detection, jitter/shimmer precision,
# and CPPS temporal resolution. This is the app's dense analysis window; Praat's
# autocorrelation pitch window is pitch-floor-dependent, not a fixed 30 ms.
ANALYSIS_FRAME_SIZE = 480  # 30ms at 16kHz
ANALYSIS_HOP_SIZE = 160  # 10ms at 16kHz — 100 fps frame rate
MAX_REFERENCE_TIMELINE_POINTS = 360
MIN_PITCH_HZ = VOICE_TARGET_PITCH_MIN_HZ
MAX_PITCH_HZ = VOICE_TARGET_PITCH_MAX_HZ
MIN_VOICED_RMS = 0.008
EPSILON = 1e-8
# LPC order for formant estimation is derived from the sample rate inside
# _estimate_lpc_formants (~2 + Fs/1000 => 18 at 16 kHz); the old fixed order
# of 10 under-modelled 16 kHz speech and dropped F2.
MAX_OFFLINE_ANALYSIS_WINDOWS = 48

# Analysis profiles (2026-07-19 LPC gate). 'standard' is byte-identical to the
# behavior before the gate existed. 'no_formants' skips _estimate_lpc_formants
# per frame (the heaviest live op: order-18 Levinson solve + np.roots) and the
# formant-lite offline pass; formant-derived fields come back null and the
# per-frame resonance/weight fall back to their existing no-formant spectral /
# pitch paths (the same degraded mode an LPC failure already produces).
ANALYSIS_PROFILE_STANDARD = "standard"
ANALYSIS_PROFILE_NO_FORMANTS = "no_formants"

# Vocalise-proxy tuning (2026-07-19). All proxies are computed from series the
# attempt already carries (per-frame pitch, per-frame rms, per-window F2), so
# their cost is O(frames) against a per-frame path that already runs FFTs and
# an LPC solve per frame.
#  - Glide: smoothness = 1 - std(slope st/s)/30. 30 st/s ~ the slope swing of
#    frame-to-frame pitch jitter at 10 ms hops; clean glides measure < 5.
GLIDE_SLOPE_STD_NORM_ST_PER_SEC = 30.0
#  - Slope pairs must be timeline-adjacent; anything beyond 150 ms apart is a
#    voicing gap, not a continuous glide segment.
GLIDE_MAX_SLOPE_GAP_MS = 150.0
#  - Trill: dominant amplitude modulation of the frame-RMS envelope inside
#    15-45 Hz (alveolar/uvular trills sit ~20-35 Hz; band widened one notch
#    each way for slow/fast trills).
TRILL_MIN_RATE_HZ = 15.0
TRILL_MAX_RATE_HZ = 45.0
#  - Prominence rule: the normalized envelope autocorrelation at the trill lag
#    must be a strict local maximum in lag space (a monotone decay — smoothed
#    noise, envelope drift — has none) AND >= 0.35, i.e. >=35% of envelope
#    variance recurs at that period (~3.5 sigma above chance for the ~100-frame
#    series a short take produces).
TRILL_MIN_AUTOCORR = 0.35
#  - Need enough envelope to see >=3 periods of the slowest trill (240 ms at
#    100 fps) before claiming anything.
TRILL_MIN_FRAMES = 24
#  - Siren honesty flag: >=5% of voiced frames within 2 Hz of the 400 Hz
#    tracker clamp means the measured top may be the tracker's ceiling, not
#    the singer's.
PITCH_CEILING_MARGIN_HZ = 2.0
PITCH_CEILING_MIN_FRACTION = 0.05

# Pitch tracking (YIN cumulative-mean-normalized difference). Candidate search
# is deliberately wider than the public 80-400 Hz target domain so both ends
# are interior troughs. Accepted values above the public ceiling clamp to 400
# and are exposed by `hitPitchCeiling`; values below the floor fail closed.
YIN_THRESHOLD = 0.20
PITCH_SEARCH_MIN_HZ = 70.0
PITCH_SEARCH_MAX_HZ = 450.0
PITCH_BOUNDARY_TOLERANCE_HZ = 0.5


@dataclass(frozen=True)
class VoiceTargetProfile:
    name: str
    pitch_floor_hz: float
    pitch_ceiling_hz: float
    min_target_hit_pct: float
    # `min_resonance_mean` / `max_weight_mean` are the primary resonance/weight
    # thresholds (0-1 model coordinates: higher resonance = brighter, higher
    # weight = heavier). `direction` sets how each is read:
    #   feminine  -> resonance is a FLOOR  (be bright enough), weight a CEILING
    # 2026-07-26: the product is MTF-only; the masculinizing direction and its
    # preset are retired, so "masculine" is no longer a valid direction value.
    # 2026-07-30: "neutral" (both thresholds read as band CENTERS, +-0.14) is
    # retired with the androgynous / gender-neutral presets — no TARGET_PROFILES
    # entry can produce it, so every branch that read it was dead code and has
    # been removed. "feminine" is now the only direction value, and the pitch
    # bands are the literature-grounded part of each profile.
    min_resonance_mean: float
    max_weight_mean: float
    min_pitch_range_st: float
    min_similarity_score: float
    # NOTE: the dataclass default below is PARSED by backend/voice-direction-parity
    # .test.js (/^\s{4}direction:\s*str\s*=\s*"([a-z-]+)"/m). Keep the line shape.
    direction: str = "feminine"  # "feminine" — the only live value (2026-07-30)
    # Exact full bands are present for handmade/reference-derived profiles.
    # Static presets intentionally retain threshold semantics unless resolved
    # through `_target_timbre_bands` below.
    resonance_floor: float | None = None
    resonance_ceiling: float | None = None
    weight_floor: float | None = None
    weight_ceiling: float | None = None
    source: str = "preset"
    profile_id: str | None = None


# REMOVED 2026-07-30 — NEUTRAL_TIMBRE_TOLERANCE = 0.14. It was the resonance/
# weight band half-width applied when direction == "neutral", i.e. it turned a
# threshold into a centred band in `_target_timbre_bands`. With the neutral lane
# retired no profile can reach that branch, so the constant had no reader.


TARGET_PROFILES: dict[str, VoiceTargetProfile] = {
    "cute-feminine": VoiceTargetProfile(
        name="cute-feminine",
        pitch_floor_hz=188.0,
        pitch_ceiling_hz=255.0,
        min_target_hit_pct=0.28,
        min_resonance_mean=0.32,
        max_weight_mean=0.40,
        min_pitch_range_st=2.8,
        min_similarity_score=0.58,
    ),
    "everyday-feminine": VoiceTargetProfile(
        name="everyday-feminine",
        pitch_floor_hz=168.0,
        pitch_ceiling_hz=235.0,
        min_target_hit_pct=0.25,
        min_resonance_mean=0.24,
        max_weight_mean=0.46,
        min_pitch_range_st=2.4,
        min_similarity_score=0.54,
    ),
    "bright-playful": VoiceTargetProfile(
        name="bright-playful",
        pitch_floor_hz=198.0,
        pitch_ceiling_hz=275.0,
        min_target_hit_pct=0.30,
        min_resonance_mean=0.34,
        max_weight_mean=0.38,
        min_pitch_range_st=3.4,
        min_similarity_score=0.62,
    ),
    "australian-bright-feminine": VoiceTargetProfile(
        name="australian-bright-feminine",
        pitch_floor_hz=178.0,
        pitch_ceiling_hz=255.0,
        min_target_hit_pct=0.25,
        min_resonance_mean=0.38,
        max_weight_mean=0.42,
        min_pitch_range_st=2.8,
        min_similarity_score=0.58,
    ),
    # Soft-feminine: feminine via higher pitch + light weight rather than bright
    # forward resonance. Calibrated against real voices that are clearly feminine
    # but NOT bright — e.g. Indian-English females (high pitch ~230 Hz but darker
    # F2 ~1470), and anyone who doesn't want a bright tone. The inclusive,
    # low-brightness feminine target so the preset library isn't all-bright.
    "soft-feminine": VoiceTargetProfile(
        name="soft-feminine",
        pitch_floor_hz=175.0,
        pitch_ceiling_hz=255.0,
        min_target_hit_pct=0.25,
        min_resonance_mean=0.20,
        max_weight_mean=0.44,
        min_pitch_range_st=2.4,
        min_similarity_score=0.52,
    ),
    # REMOVED 2026-07-30 — "androgynous" and "gender-neutral".
    #
    # The app is male-to-female only. Owner's words: "our app is specialised male
    # to female voice now. there's no other options the only thing the user should
    # be focused on it getting a bright female voice."
    #
    # THIS DICT IS THE SOURCE OF TRUTH for the offered set. `normalize_target_preset`
    # and `get_target_profile` both derive their enum from `TARGET_PROFILES.keys()`,
    # so removing the entries narrows both automatically, and `get_target_profile`
    # then raises ValueError for the removed ids — surfaced as HTTP 400.
    #
    # Five JS registries hand-copy this list and NOTHING keeps them in sync
    # (policy.STYLE_TARGETS, policy.PRESET_DIRECTIONS, cue-sheet.PRESET_PROFILES,
    # drills.VOICE_DRILL_PACKS, cockpit.LINE_LIBRARY). Two tests DO parse this file
    # to pin their copies — frontend/src/voice/preset-parity.test.ts and
    # backend/voice-student-preset-dsp-parity.test.js — so treat all eight tables
    # as one edit. `direction="neutral"` now has no producer; the branches that
    # read it are dead and are removed with it.
}


def clamp(value: float, lower: float = 0.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def get_target_profile(target_preset: str) -> VoiceTargetProfile:
    """Resolve a built-in target profile, FAILING CLOSED on anything unknown.

    2026-07-27 MTF-ONLY (round 4). This used to be
    ``TARGET_PROFILES.get(target_preset, TARGET_PROFILES["cute-feminine"])`` —
    a silent substitution. Measured consequence: ``build_attempt_summary(
    target_preset="masculine")`` returned the cute-feminine bands under the
    label "masculine" (direction "feminine", pitchFloorHz 188.0,
    resonanceFloor 0.32, weightCeiling 0.4), i.e. it CLAIMED a feminizing
    direction for a target the learner never chose. That is precisely the
    wrong-way substitution the house law bans, and it slipped past the JS
    identity layer because ``canonicalizeDirection('feminine')`` short-circuits
    before ``directionFromPreset`` ever sees the retired id.

    The gate is placed HERE rather than at each caller because this is the one
    choke point every read funnels through. Its in-module callers are
    ``_resolve_target_profile`` — which backs ``analyze_pcm_frame``,
    ``build_attempt_metrics`` and ``build_attempt_summary`` alike, so the
    streaming resume/finalize paths (``streaming_analyzer`` frame analysis and
    ``_build_summary_from_frames``, which pass ``session.targetPreset``
    straight through) are closed without a normalize call at each of them — and
    ``build_phrase_forecast``, which calls it directly (behind its own
    idempotent ``normalize_target_preset`` boundary check). An earlier revision
    of this paragraph called ``_resolve_target_profile`` the sole in-module
    consumer; corrected 2026-07-27 (round 5) after grepping the module.

    ``normalize_target_preset`` is reused rather than reimplemented, so the
    live enum has exactly one definition. Behaviour is UNCHANGED for every live
    preset and for the empty/None default (both still resolve to
    "cute-feminine"); it changes only for a non-empty unrecognised or retired
    id, which now raises ValueError.

    ROUTER MAPPING (corrected 2026-07-27, round 5 — an earlier revision here
    claimed the routers "already" mapped this; measured, three did not, and a
    corrupt stored preset produced HTTP 500 on them). Enumerated by grepping
    every caller of ``get_target_profile``/``normalize_target_preset`` back to
    its route, the reaching routes and their arms are: ``POST /sessions/start``,
    ``POST /sessions/{id}/end``, ``POST /sessions/{id}/take``, ``POST
    /sessions/{id}/take-oneshot`` (the last three ADDED in round 5), ``POST
    /target/profile``, ``POST /target/forecast``, ``POST /reference/analyze``
    and the ``/presets`` save/duplicate family via
    ``_save_custom_target_preset`` — all HTTP 400; the streaming WebSocket
    closes 1008. Any NEW caller must add its own arm; the mapping is not
    automatic.
    """
    return TARGET_PROFILES[normalize_target_preset(target_preset)]


def _target_timbre_bands(
    profile: VoiceTargetProfile,
) -> tuple[float, float, float, float]:
    """Return exact coordinate bands for deterministic scoring/reporting.

    Custom/reference profiles carry explicit bounds. Built-in profiles keep
    their historical one-sided semantics and are expanded to the corresponding
    0..1 band here, avoiding a second target table downstream.

    2026-07-30 MTF-ONLY: the `direction == "neutral"` arms (which centred a band
    on the threshold with NEUTRAL_TIMBRE_TOLERANCE) are REMOVED as dead code —
    no TARGET_PROFILES entry carries that direction any more. Every built-in
    profile now falls through to the one-sided `else`, which is deliberately a
    FALLBACK rather than an `== "feminine"` test: a stray direction value lands
    on the feminizing band instead of on an unhandled path.
    """
    if profile.resonance_floor is not None and profile.resonance_ceiling is not None:
        resonance_floor = clamp(profile.resonance_floor)
        resonance_ceiling = clamp(profile.resonance_ceiling)
    else:
        resonance_floor, resonance_ceiling = clamp(profile.min_resonance_mean), 1.0

    if profile.weight_floor is not None and profile.weight_ceiling is not None:
        weight_floor = clamp(profile.weight_floor)
        weight_ceiling = clamp(profile.weight_ceiling)
    else:
        weight_floor, weight_ceiling = 0.0, clamp(profile.max_weight_mean)

    return resonance_floor, resonance_ceiling, weight_floor, weight_ceiling


def _resolve_target_profile(
    target_preset: str,
    target_voice_profile: VoiceTargetVoiceProfile | None = None,
    source: str | None = None,
) -> VoiceTargetProfile:
    """Resolve one scoring authority from a base preset and optional full profile."""
    base = get_target_profile(target_preset)
    if target_voice_profile is None:
        return base

    resonance_floor = float(target_voice_profile.resonanceFloor)
    resonance_ceiling = float(target_voice_profile.resonanceCeiling)
    weight_floor = float(target_voice_profile.weightFloor)
    weight_ceiling = float(target_voice_profile.weightCeiling)

    # Collapse the custom/reference band back to the single threshold the
    # legacy scalar fields carry, on the side the base preset reads them from.
    # 2026-07-30 MTF-ONLY: the `base.direction == "neutral"` arm (which took the
    # band MIDPOINT for both) is REMOVED as dead code — `base` comes from
    # get_target_profile, and no surviving TARGET_PROFILES entry is neutral.
    # The feminine reading stands, unconditionally, as the fallback for any
    # direction: resonance is a floor, weight is a ceiling.
    resonance_threshold = resonance_floor
    weight_threshold = weight_ceiling

    return VoiceTargetProfile(
        name=base.name,
        pitch_floor_hz=float(target_voice_profile.pitchFloorHz),
        pitch_ceiling_hz=float(target_voice_profile.pitchCeilingHz),
        min_target_hit_pct=base.min_target_hit_pct,
        min_resonance_mean=resonance_threshold,
        max_weight_mean=weight_threshold,
        min_pitch_range_st=base.min_pitch_range_st,
        min_similarity_score=base.min_similarity_score,
        direction=base.direction,
        resonance_floor=resonance_floor,
        resonance_ceiling=resonance_ceiling,
        weight_floor=weight_floor,
        weight_ceiling=weight_ceiling,
        source=(str(source or "custom").strip() or "custom"),
        profile_id=target_voice_profile.profileId,
    )


def normalize_target_preset(target_preset: str | None) -> str:
    normalized = str(target_preset or "").strip()
    if not normalized:
        return "cute-feminine"
    if normalized in TARGET_PROFILES:
        return normalized
    allowed = ", ".join(sorted(TARGET_PROFILES.keys()))
    raise ValueError(
        f'Unknown target preset "{normalized}". Expected one of: {allowed}'
    )


def normalize_analysis_profile(value: str | None) -> str:
    """Map a request-supplied analysis profile onto a known one.

    Anything that is not exactly 'no_formants' (case/space tolerant) falls back
    to 'standard' instead of erroring: the field is additive, so an old or
    sloppy caller must land on the pre-gate behavior, never on a 422."""
    if (
        isinstance(value, str)
        and value.strip().lower() == ANALYSIS_PROFILE_NO_FORMANTS
    ):
        return ANALYSIS_PROFILE_NO_FORMANTS
    return ANALYSIS_PROFILE_STANDARD


def _resonance_meets_target(resonance_score: float, profile: VoiceTargetProfile) -> bool:
    floor, ceiling, _, _ = _target_timbre_bands(profile)
    return floor <= resonance_score <= ceiling


def _weight_meets_target(weight_score: float, profile: VoiceTargetProfile) -> bool:
    _, _, floor, ceiling = _target_timbre_bands(profile)
    return floor <= weight_score <= ceiling


def _resonance_fit_score(resonance_mean: float, profile: VoiceTargetProfile) -> float:
    if profile.resonance_floor is not None and profile.resonance_ceiling is not None:
        return _band_similarity(
            resonance_mean,
            profile.resonance_floor,
            profile.resonance_ceiling,
            margin=0.28,
        )
    # 2026-07-30 MTF-ONLY: the `direction == "neutral"` arm (distance-from-centre
    # scoring) is REMOVED as dead code. The one-sided ratio below is the fallback
    # every direction now takes: brighter than the floor scores 1.0.
    threshold = max(profile.min_resonance_mean, 1e-6)
    return clamp(resonance_mean / threshold)


def _weight_fit_score(weight_mean: float, profile: VoiceTargetProfile) -> float:
    if profile.weight_floor is not None and profile.weight_ceiling is not None:
        return _band_similarity(
            weight_mean,
            profile.weight_floor,
            profile.weight_ceiling,
            margin=0.28,
        )
    # 2026-07-30 MTF-ONLY: the `direction == "neutral"` arm (distance-from-centre
    # scoring) is REMOVED as dead code. The one-sided penalty below is the
    # fallback every direction now takes: lighter than the ceiling scores 1.0.
    threshold = profile.max_weight_mean
    return clamp(1.0 - max(0.0, weight_mean - threshold) / 0.28)


# Direction-keyed coaching copy. Every key EXCEPT "holding" is an (issue, drill)
# pair; "holding" is the nothing-to-fix case and carries the issue line alone,
# because there is no drill to prescribe when the take is already in band. The
# union type states that rather than declaring a contract the values do not keep.
#
# 2026-07-30 MTF-ONLY: the "neutral" lane is REMOVED (see _coaching_messages
# below). The table stays a dict-of-lanes rather than collapsing into one flat
# dict so `_coaching_messages` keeps its redirect-to-feminine fallback, which is
# what makes an unexpected direction value safe instead of a KeyError.
_COACHING_MESSAGES: dict[str, dict[str, tuple[str, str] | str]] = {
    "feminine": {
        "pitch_low": (
            "Pitch center is still settling low; finish each phrase a little higher and lighter.",
            "5-note sirens from speech into a lighter head-mix placement",
        ),
        "pitch_high": (
            "Pitch is overshooting the target band; keep the sound playful without squeezing upward.",
            "gentle scale repeats that stay buoyant without climbing past the target band",
        ),
        "resonance": (
            "Resonance stays darker than target; push more brightness into ng-to-ee transitions.",
            "ng-to-ee resonance glides on 3 short bright phrases",
        ),
        "weight": (
            "Vocal weight is still heavy; back off chest pressure and soften the onset.",
            "breathy-to-clean onset resets on short cute phrases",
        ),
        "range": (
            "Intonation stayed flat; add more upward playfulness at phrase endings.",
            "statement-vs-question repetitions on the same 3-line prompt",
        ),
        "holding": "Target zone is holding together — keep that light, bright placement while lengthening phrases.",
    },
    # REMOVED 2026-07-30 — the "neutral" lane. It carried band-relative copy
    # ("aim for a balanced tone — neither bright nor dark", "keep it balanced —
    # neither pressed-heavy nor airy-light") for the androgynous /
    # gender-neutral presets, so a gender-neutral learner was never told to be
    # "brighter and lighter". Those presets are gone with the MTF-only
    # narrowing, so no profile can carry direction "neutral" and nothing could
    # select this lane. The `.get` fallback in `_coaching_messages` is the
    # redirect target and STAYS.
}


def _coaching_messages(profile: VoiceTargetProfile) -> dict[str, tuple[str, str] | str]:
    """Select the coaching lane for a profile's direction, feminine as fallback.

    The `.get(..., "feminine")` form is deliberate and OUTLIVES the neutral lane
    it once dispatched to: "feminine" is the only live direction, so this is now
    a fail-safe rather than a router. A profile carrying an unexpected direction
    (a stale pickle, a hand-built VoiceTargetProfile in a test) gets the
    feminizing copy instead of a KeyError at coaching time.
    """
    return _COACHING_MESSAGES.get(profile.direction, _COACHING_MESSAGES["feminine"])


def _coaching_issue_line(profile: VoiceTargetProfile, key: str) -> str:
    """Return just the learner-facing issue line for a coaching key.

    Every key except "holding" stores an (issue, drill) pair; "holding" stores the
    line alone. Callers that render only the issue go through here so the shape
    difference is handled in one place instead of at each call site.
    """
    entry = _coaching_messages(profile)[key]
    return entry[0] if isinstance(entry, tuple) else entry


_TIMBRE_BAND_MESSAGES: dict[str, tuple[str, str]] = {
    "resonance_low": (
        "Resonance is below the selected target band; bring it a little brighter or more forward.",
        "gentle resonance glides that move toward the selected band without extra force",
    ),
    "resonance_high": (
        "Resonance is above the selected target band; let it settle a little darker and farther back.",
        "open, easy phrase loops that let resonance settle toward the selected band",
    ),
    "weight_low": (
        "Vocal weight is below the selected target band; let the sound feel a little fuller and more grounded.",
        "short grounded phrases that add fullness without pressing or getting louder",
    ),
    "weight_high": (
        "Vocal weight is above the selected target band; let it become a little lighter and easier.",
        "easy onset resets that reduce weight without turning airy",
    ),
}


def _timbre_band_coaching_message(
    axis: str,
    value: float,
    profile: VoiceTargetProfile,
) -> tuple[str, str] | None:
    """Return coordinate-side coaching for any built-in or exact custom band."""
    resonance_floor, resonance_ceiling, weight_floor, weight_ceiling = (
        _target_timbre_bands(profile)
    )
    if axis == "resonance":
        if value < resonance_floor:
            return _TIMBRE_BAND_MESSAGES["resonance_low"]
        if value > resonance_ceiling:
            return _TIMBRE_BAND_MESSAGES["resonance_high"]
        return None
    if axis == "weight":
        if value < weight_floor:
            return _TIMBRE_BAND_MESSAGES["weight_low"]
        if value > weight_ceiling:
            return _TIMBRE_BAND_MESSAGES["weight_high"]
    return None


def pcm16_bytes_to_float_samples(raw: bytes) -> np.ndarray:
    if not raw:
        return np.zeros(0, dtype=np.float32)
    if len(raw) % 2:
        raw = raw[:-1]
    if not raw:
        return np.zeros(0, dtype=np.float32)
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def _resample_signal(
    samples: np.ndarray, source_rate: int, target_rate: int
) -> np.ndarray:
    if samples.size == 0 or source_rate == target_rate:
        return samples.astype(np.float32, copy=False)

    target_length = max(1, int(round(samples.shape[0] * (target_rate / source_rate))))
    source_positions = np.linspace(0.0, 1.0, num=samples.shape[0], dtype=np.float64)
    target_positions = np.linspace(0.0, 1.0, num=target_length, dtype=np.float64)
    return np.interp(
        target_positions, source_positions, samples.astype(np.float64)
    ).astype(np.float32)


def _decode_wave_file(path: Path, sample_rate: int) -> np.ndarray:
    with wave.open(str(path), "rb") as handle:
        channel_count = handle.getnchannels()
        sample_width = handle.getsampwidth()
        source_rate = handle.getframerate()
        raw = handle.readframes(handle.getnframes())

    if sample_width == 1:
        samples = (
            np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128.0
        ) / 128.0
    elif sample_width == 2:
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
    elif sample_width == 3:
        unsigned = np.frombuffer(raw, dtype=np.uint8)
        if unsigned.size % 3:
            unsigned = unsigned[: unsigned.size - (unsigned.size % 3)]
        padded = np.zeros((unsigned.size // 3, 4), dtype=np.uint8)
        padded[:, :3] = unsigned.reshape(-1, 3)
        padded[:, 3] = np.where(padded[:, 2] >= 0x80, 0xFF, 0x00)
        samples = padded.view("<i4").reshape(-1).astype(np.float32) / 8388608.0
    elif sample_width == 4:
        samples = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
    else:
        raise ValueError(f"Unsupported WAV sample width: {sample_width} bytes")

    if channel_count > 1:
        samples = samples.reshape(-1, channel_count).mean(axis=1)

    return _resample_signal(
        samples.astype(np.float32, copy=False), source_rate, sample_rate
    )


def decode_audio_file_to_samples(
    path: Path, sample_rate: int = SAMPLE_RATE
) -> np.ndarray:
    ffmpeg_path = shutil.which("ffmpeg")
    if ffmpeg_path is not None:
        result = subprocess.run(
            [
                ffmpeg_path,
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(path),
                "-ac",
                "1",
                "-ar",
                str(sample_rate),
                "-f",
                "s16le",
                "pipe:1",
            ],
            capture_output=True,
            check=False,
        )
        if result.returncode == 0 and result.stdout:
            samples = pcm16_bytes_to_float_samples(result.stdout)
            if samples.size > 0:
                return samples
        elif path.suffix.lower() != ".wav":
            message = (
                result.stderr.decode("utf-8", errors="ignore").strip()
                or f"ffmpeg could not decode {path.name}"
            )
            raise ValueError(message)

    if path.suffix.lower() == ".wav":
        return _decode_wave_file(path, sample_rate)

    raise ValueError(f"Could not decode {path.name}; install ffmpeg or use WAV input")


def _safe_mean(values: list[float], default: float) -> float:
    if not values:
        return default
    return float(sum(values) / len(values))


def _trimmed_mean(
    values: list[float],
    default: float,
    trim_fraction: float = 0.05,
) -> float:
    """Mean after removing a small symmetric boundary/outlier tail."""
    if not values:
        return default
    ordered = sorted(float(value) for value in values)
    trim = int(len(ordered) * max(0.0, min(0.25, trim_fraction)))
    kept = ordered[trim : len(ordered) - trim] if trim > 0 else ordered
    return float(sum(kept) / len(kept))


def _percentile(values: list[float], percentile: float, default: float) -> float:
    if not values:
        return default
    return float(np.percentile(np.asarray(values, dtype=np.float32), percentile))


def _band_similarity(
    value: float, lower: float, upper: float, margin: float = 45.0
) -> float:
    if lower <= value <= upper:
        return 1.0
    if value < lower:
        return clamp(1.0 - ((lower - value) / margin))
    return clamp(1.0 - ((value - upper) / margin))


def _proximity_score(value: float, target: float, scale: float) -> float:
    if scale <= 0:
        return 1.0 if value == target else 0.0
    return clamp(1.0 - (abs(value - target) / scale))


def _estimate_pitch(
    samples: np.ndarray, sample_rate: int
) -> tuple[float | None, float]:
    """Estimate F0 with YIN's cumulative-mean-normalized difference.

    The prior autocorrelation lane treated a strong peak at 2T as proof that T
    was an octave error. Periodic voice normally has strong peaks at T, 2T, and
    3T, so that rule confidently halved high voices. YIN instead selects the
    first sufficiently periodic trough and remains stable at the declared
    80-400 Hz boundaries on the existing 30 ms dense-analysis frames.
    """
    signal = np.asarray(samples, dtype=np.float64).reshape(-1)
    if signal.size < 128 or not np.all(np.isfinite(signal)):
        return None, 0.0

    signal = signal - float(signal.mean())
    n = signal.size
    signal_energy = float(np.dot(signal, signal))
    if signal_energy <= EPSILON:
        return None, 0.0

    min_lag = max(2, int(sample_rate / PITCH_SEARCH_MAX_HZ))
    max_lag = min(n - 2, int(math.ceil(sample_rate / PITCH_SEARCH_MIN_HZ)))
    if max_lag <= min_lag:
        return None, 0.0

    # Vectorized YIN squared-difference function:
    #   d(tau) = sum_j (x[j] - x[j + tau])^2
    #          = E[0:n-tau] + E[tau:n] - 2*ACF[tau].
    autocorrelation = np.correlate(signal, signal, mode="full")[
        n - 1 : n + max_lag
    ]
    energy_prefix = np.concatenate(([0.0], np.cumsum(signal * signal)))
    lags = np.arange(1, max_lag + 1, dtype=np.int64)
    difference = np.zeros(max_lag + 1, dtype=np.float64)
    difference[1:] = np.maximum(
        0.0,
        energy_prefix[n - lags]
        + (energy_prefix[n] - energy_prefix[lags])
        - (2.0 * autocorrelation[1 : max_lag + 1]),
    )

    cmnd = np.ones(max_lag + 1, dtype=np.float64)
    cumulative = np.cumsum(difference[1:])
    cmnd[1:] = difference[1:] * lags / np.maximum(cumulative, EPSILON)

    # Select the first thresholded basin, then descend to its local trough.
    # If an irregular-but-periodic voice misses the strict threshold, retain a
    # compatibility fallback only when the best trough clears the old 0.45
    # voicing-strength floor.
    tau = min_lag
    while tau <= max_lag and cmnd[tau] >= YIN_THRESHOLD:
        tau += 1
    if tau <= max_lag:
        while tau < max_lag and cmnd[tau + 1] < cmnd[tau]:
            tau += 1
    else:
        tau = min_lag + int(np.argmin(cmnd[min_lag : max_lag + 1]))

    strength = float(np.clip(1.0 - cmnd[tau], 0.0, 1.0))
    if strength < 0.45:
        return None, strength

    offset = 0.0
    if min_lag < tau < max_lag:
        offset = _parabolic_interpolation(
            float(cmnd[tau - 1]),
            float(cmnd[tau]),
            float(cmnd[tau + 1]),
        )
    raw_pitch_hz = float(sample_rate / max(tau + offset, EPSILON))
    if raw_pitch_hz < MIN_PITCH_HZ - PITCH_BOUNDARY_TOLERANCE_HZ:
        return None, strength
    if raw_pitch_hz > PITCH_SEARCH_MAX_HZ:
        return None, strength

    # Values above the public ceiling are an intentional saturated
    # measurement, not an octave-down alias. `_hit_pitch_ceiling` witnesses the
    # saturation so siren/custom-target coaching can avoid overstating the top.
    pitch_hz = float(np.clip(raw_pitch_hz, MIN_PITCH_HZ, MAX_PITCH_HZ))
    return pitch_hz, strength


def _estimate_timbre(
    windowed: np.ndarray,
    sample_rate: int,
    pitch_hz: float | None,
    skip_formants: bool = False,
) -> tuple[float, float]:
    """Estimate resonance (brightness/forwardness, 0-1) and vocal weight
    (thickness/heaviness, 0-1) for one frame.

    Grounded in FORMANTS, calibrated against real speech (CMU ARCTIC, 2026-06-08):
    fixed spectral-band energy ratios saturate on real voices (resonance ~0 and
    weight ~0.9 for everyone, with no gender separation), because real speech
    concentrates energy below ~1.7 kHz. Formants, by contrast, cleanly separate
    gender on real speech — F2 ~1380 Hz (masculine) vs ~1690 Hz (feminine); F1
    ~430 vs ~530 — so resonance rides F2 and weight rides F1 + pitch, with the
    spectral high-band only as a fallback when no formant is found.
    """
    spectrum = np.abs(np.fft.rfft(windowed))
    power = spectrum * spectrum
    frequencies = np.fft.rfftfreq(windowed.size, d=1.0 / sample_rate)
    speech_mask = (frequencies >= 80.0) & (frequencies <= 5000.0)
    total_energy = float(power[speech_mask].sum())
    if total_energy <= EPSILON:
        return 0.5, 0.5

    high_ratio = (
        float(power[(frequencies >= 1800.0) & (frequencies <= 5000.0)].sum())
        / total_energy
    )
    bright_spectral = clamp((high_ratio - 0.05) / 0.20)

    # 'no_formants' profile: skip the LPC solve entirely and take the same
    # spectral/pitch fallback branches the code already uses when LPC finds no
    # usable formant — identical degraded mode, zero new behavior.
    # pitch_hz arrives as None on unvoiced frames (the caller passes it only when
    # the frame is voiced), so the formant solver's F0 floor is applied only when
    # F0 is actually trustworthy.
    f1_hz, f2_hz = (
        (None, None)
        if skip_formants
        else _estimate_lpc_formants(windowed, sample_rate, f0_hz=pitch_hz)
    )

    # Resonance: F2 is the dominant brightness/forwardness cue (front vowels /
    # smaller vocal tract -> higher F2). Real: M F2~1380 -> ~0.14, F F2~1690 -> ~0.49.
    if f2_hz is not None:
        resonance_score = clamp(
            0.80 * clamp((f2_hz - 1250.0) / 900.0) + 0.20 * bright_spectral
        )
    else:
        resonance_score = bright_spectral

    # Weight: heavier = larger vocal tract (lower F1) + lower pitch. Real:
    # M F1~430/pitch~143 -> ~0.6, F F1~530/pitch~184 -> ~0.3.
    pitch_value = float(pitch_hz) if pitch_hz else 180.0
    pitch_heavy = clamp((220.0 - pitch_value) / 140.0)
    if f1_hz is not None:
        f1_heavy = clamp((640.0 - f1_hz) / 320.0)
        weight_score = clamp(0.60 * f1_heavy + 0.40 * pitch_heavy)
    else:
        weight_score = clamp(pitch_heavy)

    return float(resonance_score), float(weight_score)


def _spectral_bandwidth_hz(
    frequencies: np.ndarray,
    power: np.ndarray,
    total_energy: float,
    centroid_hz: float,
) -> float:
    if total_energy <= EPSILON:
        return 0.0
    variance = float((((frequencies - centroid_hz) ** 2) * power).sum() / total_energy)
    return math.sqrt(max(0.0, variance))


def _spectral_flux(spectrum: np.ndarray) -> float:
    if spectrum.size <= 1:
        return 0.0
    normalized = spectrum / max(float(spectrum.sum()), EPSILON)
    deltas = np.diff(normalized)
    return float(np.sqrt(np.mean(deltas * deltas)))


def _spectral_tilt_db_per_octave(
    frequencies: np.ndarray,
    power: np.ndarray,
    speech_mask: np.ndarray,
) -> float:
    usable_mask = speech_mask & (frequencies >= 120.0) & (power > EPSILON)
    usable_frequencies = frequencies[usable_mask]
    usable_power = power[usable_mask]
    if usable_frequencies.size < 4:
        return 0.0

    x = np.log2(usable_frequencies)
    y = 10.0 * np.log10(usable_power + EPSILON)
    slope, _ = np.polyfit(x, y, deg=1)
    return float(slope)


def _sample_analysis_windows(
    raw_samples: np.ndarray | None,
    timeline: list[VoiceFrame],
    sample_rate: int,
    frame_size: int = LIVE_FRAME_SIZE,
    max_windows: int = MAX_OFFLINE_ANALYSIS_WINDOWS,
) -> list[tuple[VoiceFrame, np.ndarray]]:
    samples = (
        np.asarray(raw_samples, dtype=np.float32).reshape(-1)
        if raw_samples is not None
        else np.zeros(0, dtype=np.float32)
    )
    if samples.size < max(256, frame_size // 2):
        return []

    candidate_frames = [
        frame
        for frame in timeline
        if frame.voiced and frame.confidence >= 0.20 and frame.pitchHz > 0.0
    ]
    if not candidate_frames:
        return []
    if len(candidate_frames) > max_windows:
        sampled_frames: list[VoiceFrame] = []
        last_index = len(candidate_frames) - 1
        for idx in range(max_windows):
            source_index = round((idx / (max_windows - 1)) * last_index)
            sampled_frames.append(candidate_frames[source_index])
        candidate_frames = sampled_frames

    last_start = max(samples.size - frame_size, 0)
    windows: list[tuple[VoiceFrame, np.ndarray]] = []
    for frame in candidate_frames:
        start = min(max(int(round((frame.t / 1000.0) * sample_rate)), 0), last_start)
        window = samples[start : start + frame_size]
        if window.size < frame_size:
            window = np.pad(window, (0, frame_size - window.size))
        raw_window = window.astype(np.float32, copy=False)
        clipping_fraction = (
            float(np.mean(np.abs(raw_window) >= 0.985)) if raw_window.size else 1.0
        )
        centered = raw_window - float(raw_window.mean())
        if (
            centered.size >= 256
            and float(np.sqrt(np.mean(centered * centered))) >= MIN_VOICED_RMS * 0.7
            # Reject clipped windows: flat-topped distortion fabricates formants
            # and inflates spectral tilt / CPPS, so it must not feed the quality
            # estimators (CPPS, formants, jitter, shimmer).
            and clipping_fraction <= 0.02
        ):
            windows.append((frame, centered))
    return windows


# Formant-lite pole-selection constants. Every value below was measured in the
# lab-031 spike (receipts:
# /home/USER which
# re-derived the recipe on a JOINT objective (accuracy on synthesized vowels of
# known ground truth + frame yield on real recorded speech) instead of on
# synthetic audio alone.
#
# F1's ceiling is 1200 Hz, not the old 1000 Hz: Hillenbrand's adult-female /a/
# averages 936 Hz, so a 1000 Hz ceiling silently rejects a large share of
# genuine open vowels once high-F0 harmonic bias nudges the estimate upward.
#
# The bandwidth caps are deliberately loose. They are sanity caps against
# obvious garbage, not the selector: the spike measured that relaxing them from
# 600/700 Hz all the way to 2000/2400 Hz costs EXACTLY ZERO accuracy against
# synthetic ground truth once prominence ranking is doing the choosing (receipt
# 8E). Tight bandwidth gates were the old code's only defence against junk
# poles, and that defence was broken (see the bandwidth note below); prominence
# is the real discriminator.
FORMANT_F0_FLOOR_MULT = 1.1  # a formant below ~F0 is a harmonic lock, not a formant
# ...but the floor must never rise into the plausible F1 region. The lowest F1
# in the adult vowel space is ~340 Hz (male /i/); Hillenbrand's female /i/ and
# /u/ sit at 437/459 Hz. Uncapped, 1.1 x F0 reaches 437 Hz at F0 = 397 Hz -- and
# reported pitch is CLAMPED to VOICE_TARGET_PITCH_MAX_HZ = 400, so every speaker
# at or above 400 Hz lands exactly there. Measured consequence of leaving it
# uncapped: on /u/ at F0 400 the floor deleted the true 459 Hz F1, the selector
# crowned the 1105 Hz F2 as F1, and F2 was pushed onto F3 -- F2 read 2767 Hz
# against a true 1105 (+150%), which is worse than the defect this pass repairs.
# Capping at 300 Hz keeps the floor active across the whole normal speaking range
# (it binds up to F0 = 273 Hz) while never reaching a real F1.
FORMANT_F0_FLOOR_MAX_HZ = 300.0
FORMANT_MIN_SEPARATION_HZ = 250.0
FORMANT_CANDIDATE_RANGE_HZ = (180.0, 3500.0)
FORMANT_F1_RANGE_HZ = (200.0, 1200.0)
FORMANT_F2_RANGE_HZ = (700.0, 3200.0)
FORMANT_F1_MAX_BANDWIDTH_HZ = 1400.0
FORMANT_F2_MAX_BANDWIDTH_HZ = 1600.0


def _pole_bandwidths_hz(roots: np.ndarray, sample_rate: int) -> np.ndarray:
    """Standard pole -> bandwidth identity: ``BW = -(sr/pi) * ln|z|``.

    McCandless (1974); Snell & Milinazzo (1993). It is the exact inverse of the
    2-pole resonator ``r = exp(-pi*BW/sr)`` used by every source-filter vowel
    synthesizer, so a formant synthesized 100 Hz wide reads back 100 Hz.

    This replaces ``-0.5*(sr/(2*pi))*ln|z|``, which is EXACTLY ONE QUARTER of
    the standard value. Under that quarter-scale expression the old
    ``bandwidth <= 700`` gate actually admitted poles up to ~2800 Hz wide, and
    the ``<= 900`` gate admitted ~3600 Hz -- while real formants are 50-200 Hz
    wide. The bandwidth gate was the old selector's ONLY junk-pole defence, and
    it was inert: spectral-tilt-fitting poles and harmonic locks sailed through.
    Measured on the live function, synthetic /i/ (true F1 437, F2 2761 Hz) at an
    easy 150 Hz F0, it returned F2 = 798 Hz (-71%) because a 1856 Hz-wide junk
    pole at 798 Hz read as "464 Hz wide" and won, while the correct 2750 Hz pole
    (128 Hz wide) sat unselected in the same candidate list.
    (lab-031 receipt probe11-verify-tv.json.)
    """
    return -(sample_rate / math.pi) * np.log(
        np.maximum(np.abs(np.asarray(roots)), EPSILON)
    )


def _pole_prominences_db(
    lpc_polynomial: np.ndarray, frequencies: np.ndarray, sample_rate: int
) -> np.ndarray:
    """Height of the LPC envelope ``20*log10(1/|A(e^jw)|)`` at each pole.

    A real formant is a TALL peak in the all-pole envelope; a junk pole (a
    harmonic lock in an inter-formant gap, or a wide pole fitting overall
    spectral tilt) is not. This is the discriminator that the old
    "first pole in range wins" rule lacked entirely.
    """
    polynomial = np.asarray(lpc_polynomial, dtype=np.float64)
    angular = (2.0 * math.pi * np.asarray(frequencies)) / float(sample_rate)
    response = np.exp(
        -1j * np.outer(angular, np.arange(polynomial.size))
    ) @ polynomial
    return -20.0 * np.log10(np.maximum(np.abs(response), EPSILON))


def _formant_candidates(
    window: np.ndarray,
    sample_rate: int,
    order: int | None = None,
    f0_hz: float | None = None,
) -> list[tuple[float, float, float]]:
    """Solve the LPC poles of one window into formant candidates.

    Returns ``(frequency_hz, bandwidth_hz, prominence_db)`` triples sorted by
    frequency, or ``[]`` when the window cannot be solved. Bandwidths are on the
    STANDARD scale (see :func:`_pole_bandwidths_hz`).
    """
    # LPC order ~= 2 + Fs/1000 (roughly one pole-pair per kHz of bandwidth plus
    # a couple for spectral shaping) => 18 at 16 kHz. The old fixed order of 10
    # gives only 5 pole-pairs across 0-8 kHz, which merges F1/F2 on back vowels
    # and loses F3, corrupting the frontness/resonance signal.
    if order is None:
        order = max(8, int(round(2.0 + sample_rate / 1000.0)))
    signal = np.asarray(window, dtype=np.float64).reshape(-1)
    if signal.size < max(320, order + 2):
        return []

    pre_emphasized = np.empty_like(signal)
    pre_emphasized[0] = signal[0]
    pre_emphasized[1:] = signal[1:] - (0.97 * signal[:-1])
    pre_emphasized *= np.hamming(pre_emphasized.size)

    autocorr = np.correlate(pre_emphasized, pre_emphasized, mode="full")[
        pre_emphasized.size - 1 :
    ]
    if autocorr.size <= order or float(autocorr[0]) <= EPSILON:
        return []

    matrix = autocorr[np.abs(np.subtract.outer(np.arange(order), np.arange(order)))]
    rhs = autocorr[1 : order + 1]
    try:
        coefficients = np.linalg.solve(
            matrix + (np.eye(order) * (1e-6 * float(autocorr[0]))), rhs
        )
    except np.linalg.LinAlgError:
        return []

    lpc_polynomial = np.concatenate(([1.0], -coefficients))
    roots = np.roots(lpc_polynomial)
    roots = roots[np.imag(roots) > 0.01]
    if roots.size == 0:
        return []

    frequencies = np.arctan2(np.imag(roots), np.real(roots)) * (
        sample_rate / (2.0 * math.pi)
    )
    bandwidths = _pole_bandwidths_hz(roots, sample_rate)
    prominences = _pole_prominences_db(lpc_polynomial, frequencies, sample_rate)

    # A pole at or below the fundamental is a harmonic lock, not a formant. The
    # floor only applies when the caller knows F0 (voiced frames); without it the
    # candidate range's own 180 Hz floor stands, exactly as before.
    f0_floor_hz = (
        min(FORMANT_F0_FLOOR_MULT * float(f0_hz), FORMANT_F0_FLOOR_MAX_HZ)
        if f0_hz is not None and math.isfinite(f0_hz) and f0_hz > 0.0
        else 0.0
    )
    # No lower bandwidth bound: sharp, clean formants (the best-case input)
    # produce narrow poles (often <40 Hz). An old 40 Hz floor silently discarded
    # exactly those, dropping F2/resonance coaching on high-quality vowels.
    return sorted(
        (
            (float(freq), float(bandwidth), float(prominence))
            for freq, bandwidth, prominence in zip(
                frequencies, bandwidths, prominences, strict=False
            )
            if float(freq) > f0_floor_hz
            and FORMANT_CANDIDATE_RANGE_HZ[0]
            <= float(freq)
            <= FORMANT_CANDIDATE_RANGE_HZ[1]
            and float(bandwidth) > 0.0
        ),
        key=lambda item: item[0],
    )


def _select_formants_by_prominence(
    candidates: list[tuple[float, float, float]],
) -> tuple[float | None, float | None]:
    """PROMINENCE-RANKED F1/F2 pick over ``_formant_candidates`` output.

    Prominence -- the height of the LPC envelope peak -- decides, replacing the
    old "first candidate in the band wins" rule under which any junk pole sitting
    lower in frequency than the true formant beat it regardless of how
    implausible it was. That is precisely how a 798 Hz tilt-fitting pole came to
    be reported as the F2 of an /i/ whose true F2 was 2761 Hz.

    F1 and F2 are chosen as a PAIR (the pair with the greatest summed
    prominence), not greedily one slot at a time. Greedy per-slot selection has a
    failure mode this avoids: F1's band tops out at 1200 Hz, which contains a
    genuine back-vowel F2 (Hillenbrand /u/ F2 = 1105 Hz). Whenever F1's own pole
    is the weaker of the two -- which happens at high pitch, where the fundamental
    crowds F1 -- greedy selection crowns F2 as F1 and then has to push F2 out
    onto F3. Measured on /u/ at F0 380 Hz: greedy returned F1 1130 / F2 2653
    against a truth of 459 / 1105, while pair selection returns 420 / 1130.
    Scored across 3 vowels x 7 pitches (150-400 Hz), within +-12% on BOTH
    formants: pair selection 17/21, greedy 16/21, the pre-repair code 8/21, and
    pair selection is worse than the pre-repair code on no case at all.
    """
    if not candidates:
        return None, None

    first_band = [
        candidate
        for candidate in candidates
        if FORMANT_F1_RANGE_HZ[0] <= candidate[0] <= FORMANT_F1_RANGE_HZ[1]
        and candidate[1] <= FORMANT_F1_MAX_BANDWIDTH_HZ
    ]
    if not first_band:
        return None, None
    second_band = [
        candidate
        for candidate in candidates
        if FORMANT_F2_RANGE_HZ[0] <= candidate[0] <= FORMANT_F2_RANGE_HZ[1]
        and candidate[1] <= FORMANT_F2_MAX_BANDWIDTH_HZ
    ]

    pairs = [
        (first, second)
        for first in first_band
        for second in second_band
        if second[0] >= first[0] + FORMANT_MIN_SEPARATION_HZ
    ]
    # Null (not a fabricated worst case) when a formant genuinely is not there:
    # callers already fall back to their spectral/pitch degraded paths.
    if not pairs:
        return max(first_band, key=lambda candidate: candidate[2])[0], None
    best = max(pairs, key=lambda pair: pair[0][2] + pair[1][2])
    return best[0][0], best[1][0]


def _estimate_lpc_formants(
    window: np.ndarray,
    sample_rate: int,
    order: int | None = None,
    f0_hz: float | None = None,
) -> tuple[float | None, float | None]:
    """Return ``(F1, F2)`` in Hz for one analysis window, or ``None`` per
    formant that is genuinely not recoverable."""
    return _select_formants_by_prominence(
        _formant_candidates(window, sample_rate, order=order, f0_hz=f0_hz)
    )


# Phase 1.6: Praat-matching CPPS parameters.
# See: Hillenbrand, J. & Houde, R. A. (1996), "Acoustic correlates of breathy
# vocal quality", and Praat's "Sound: To PowerCepstrogram" + "Sound: Get CPPS".
PRAAT_PRE_EMPHASIS_HZ = 50.0  # Praat: pre-emphasis from 50 Hz
PRAAT_CPPS_PITCH_FLOOR_HZ = 60.0  # Praat CPPS pitch floor
PRAAT_CPPS_PITCH_CEILING_HZ = 333.3  # Praat CPPS pitch ceiling
PRAAT_CPPS_TREND_START_S = 0.001  # Trend line starts at 1 ms quefrency
PRAAT_CPPS_TREND_END_S = None  # Trend line runs to the end of the cepstrum
PRAAT_CPPS_NFFT_MIN = 1024  # Praat default: at least 1024-point FFT


def _praat_pre_emphasis(
    x: np.ndarray, sample_rate: int, fc: float = PRAAT_PRE_EMPHASIS_HZ
) -> np.ndarray:
    """Apply Praat's 6 dB/oct pre-emphasis from frequency ``fc``.

    y[n] = x[n] - g * x[n-1]    with g = exp(-2*pi*fc / fs)
    """
    x = np.asarray(x, dtype=np.float64).reshape(-1)
    if x.size < 2:
        return x.copy()
    g = float(np.exp(-2.0 * np.pi * fc / sample_rate))
    y = np.empty_like(x)
    y[0] = x[0]
    y[1:] = x[1:] - g * x[:-1]
    return y


def _power_cepstrum_db_db(window: np.ndarray, nfft: int) -> np.ndarray:
    """Return the real power cepstrum in dB (10 * log10).

    The cepstrum is the inverse FFT of the log power spectrum. The result is
    a 1-D real array of length ``nfft`` (quefrency in samples).
    """
    x = np.asarray(window, dtype=np.float64).reshape(-1)
    if nfft < x.size:
        nfft = x.size
    spec = np.fft.rfft(x, n=nfft)
    power = spec * np.conj(spec)
    # Clamp floor so log doesn't blow up on tiny numerics.
    power = np.maximum(power.real, 1.0e-200)
    log_power = np.log(power)
    # Real cepstrum via irfft of log power.
    c = np.fft.irfft(log_power, n=nfft)
    # Convert to dB.
    c = 10.0 * np.log10(np.maximum(c * c, 1.0e-200))
    return c


def _parabolic_interpolation(y_left: float, y_center: float, y_right: float) -> float:
    """Parabolic peak interpolation offset in [-0.5, 0.5] from the center bin.

    Returns 0.0 if the local curvature is degenerate.
    """
    denom = y_left - 2.0 * y_center + y_right
    if abs(denom) < 1.0e-12:
        return 0.0
    delta = 0.5 * (y_left - y_right) / denom
    # Clamp to the standard interpolation range.
    if delta > 0.5:
        return 0.5
    if delta < -0.5:
        return -0.5
    return float(delta)


def _ols_slope_intercept(x: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    """Plain ordinary-least-squares linear fit y = m*x + b.

    Used for the CPPS trend line. Robust alternatives (Theil–Sen, Huber) are
    documented in Praat but OLS is sufficient for clean speech; outliers from
    the peak region are masked before fitting.
    """
    x = np.asarray(x, dtype=np.float64).reshape(-1)
    y = np.asarray(y, dtype=np.float64).reshape(-1)
    n = x.size
    if n < 2:
        return 0.0, float(y[0]) if n == 1 else 0.0
    sum_x = float(np.sum(x))
    sum_y = float(np.sum(y))
    sum_xx = float(np.sum(x * x))
    sum_xy = float(np.sum(x * y))
    denom = n * sum_xx - sum_x * sum_x
    if abs(denom) < 1.0e-18:
        return 0.0, sum_y / n
    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n
    return float(slope), float(intercept)


def _cpps_like(window: np.ndarray, sample_rate: int) -> float | None:
    """Praat-style Cepstral Peak Prominence Smoothed (CPPS), in dB.

    Returns a non-negative float (dB) on success, or ``None`` when the window
    could not be measured at all: too short, no usable pitch-quefrency band,
    the cepstral peak landing on the search-region edge, or too few points for
    the trend fit.

    ``None`` means "not measured" and must never be coerced to 0.0. A 0 dB CPPS
    is the WORST possible score, so folding absence into zero manufactures a
    breathy verdict out of missing data — the exact defect these paths caused
    before 2026-07-26.

    Implementation follows Praat's "Get CPPS" pipeline:
      1. Pre-emphasis from 50 Hz.
      2. Hamming window.
      3. NFFT at least 1024 (next power of two above window length).
      4. Power cepstrum (log power spectrum → irfft), converted to dB.
      5. Smooth the cepstrum with a 1-bin moving average over 10 quefrency
         bins (Praat's default: ``Smoothing = 0.0001 s`` bin width, but a
         10-bin moving average gives a robust smoothing that is not
         sample-rate sensitive).
      6. Search for the peak within the pitch-quefrency band [60 Hz, 333.3 Hz]
         → quefrency range [1/333.3 s, 1/60 s].
      7. Parabolic interpolation around the integer peak for sub-sample
         accuracy.
      8. OLS trend line on the SMOOTHED cepstrum from 0.001 s to the end
         (peak region masked out via a guard band of ±0.001 s around the
         peak).
      9. CPPS = peak_dB - trend_line(peak_quefrency).

    Compared with the previous implementation, this fixes:
      - Cepstrum now uses log power, not log magnitude.
      - Pitch quefrency band matches Praat exactly (60–333.3 Hz, not the
        module's broader MIN_PITCH_HZ / MAX_PITCH_HZ).
      - Smoothing line + trend line replaces the median floor and the
        magic ×28.0 multiplier.
    """
    x = np.asarray(window, dtype=np.float64).reshape(-1)
    if x.size < 256:
        return None
    x = _praat_pre_emphasis(x, sample_rate)
    w = np.hamming(x.size)
    xw = x * w

    # NFFT at least 1024; round up to next power of two above the window.
    base_nfft = max(
        PRAAT_CPPS_NFFT_MIN, 1 << int(math.ceil(math.log2(max(1, xw.size))))
    )
    cepstrum = _power_cepstrum_db_db(xw, nfft=base_nfft)

    # Smooth the cepstrum with a centered 10-bin moving average. Note this is
    # WIDER than Praat's literal 0.0001 s smoothing (~2 quefrency bins at
    # 16 kHz); the heavier smoothing is deliberate and empirically justified —
    # it suppresses the spurious sharp cepstral peaks that noise produces. A
    # 2-bin kernel lets white noise read ~18 dB CPPS (≈ "healthy"), collapsing
    # the breathy/noise discrimination; 10 bins keeps noise near ~10 dB while
    # preserving the clean→breathy→noise ordering.
    kernel_size = 10
    pad = kernel_size // 2
    if cepstrum.size > pad * 2 + 1:
        kernel = np.ones(kernel_size, dtype=np.float64) / float(kernel_size)
        smoothed = np.convolve(cepstrum, kernel, mode="same")
    else:
        smoothed = cepstrum.copy()

    # Quefrency vector in seconds.
    n_quef = cepstrum.size
    quef = np.arange(n_quef, dtype=np.float64) / float(sample_rate)

    # Pitch-quefrency search band: [1/ceiling, 1/floor] in seconds.
    q_lo = 1.0 / PRAAT_CPPS_PITCH_CEILING_HZ
    q_hi = 1.0 / PRAAT_CPPS_PITCH_FLOOR_HZ
    i_lo = int(np.searchsorted(quef, q_lo))
    i_hi = int(np.searchsorted(quef, q_hi))
    i_hi = min(i_hi, n_quef - 1)
    if i_hi <= i_lo + 1:
        return None

    # Use the smoothed cepstrum for the peak search (more robust), but the
    # raw cepstrum for the parabolic amplitude interpolation.
    region_smooth = smoothed[i_lo : i_hi + 1]
    region_raw = cepstrum[i_lo : i_hi + 1]
    k = int(np.argmax(region_smooth))
    if k <= 0 or k >= region_raw.size - 1:
        return None

    y_left = float(region_raw[k - 1])
    y_center = float(region_raw[k])
    y_right = float(region_raw[k + 1])
    delta = _parabolic_interpolation(y_left, y_center, y_right)
    step_s = float(quef[1] - quef[0]) if n_quef > 1 else 0.0
    peak_quef_s = float(quef[i_lo + k]) + delta * step_s
    # Parabolic amplitude correction: y_peak ≈ y_center - 0.25*(y_left-y_right)*delta
    peak_db = y_center - 0.25 * (y_left - y_right) * delta

    # OLS trend line on the SMOOTHED cepstrum from trend_start_s onward, with
    # the peak region masked (±0.001 s) so the peak itself doesn't bias the
    # fit. Smoothing + trend together give Praat's "Smoothing line".
    i_tr = int(np.searchsorted(quef, PRAAT_CPPS_TREND_START_S))
    i_tr = max(0, i_tr)
    peak_idx = i_lo + k
    guard_bins = max(1, int(round(0.001 / step_s))) if step_s > 0 else 1
    mask = np.ones(n_quef - i_tr, dtype=bool)
    lo_excl = max(0, peak_idx - guard_bins - i_tr)
    hi_excl = min(mask.size, peak_idx + guard_bins + 1 - i_tr)
    if hi_excl > lo_excl:
        mask[lo_excl:hi_excl] = False
    x_trend = quef[i_tr:][mask]
    y_trend = smoothed[i_tr:][mask]
    if x_trend.size < 2:
        return None

    slope, intercept = _ols_slope_intercept(x_trend, y_trend)
    trend_at_peak = slope * peak_quef_s + intercept
    cpps = peak_db - trend_at_peak
    # A tiny negative value here is float roundoff on a REAL measurement (CPPS
    # is non-negative by construction), not a failure — so it stays 0.0 rather
    # than becoming None. The attempt-level aggregate drops non-positive values
    # anyway, so this never reaches a risk score either way.
    if cpps < 0.0:
        return 0.0
    return float(cpps)


def _build_formant_lite_metrics(
    analysis_windows: list[tuple[VoiceFrame, np.ndarray]],
    sample_rate: int,
) -> tuple[VoiceAttemptFormantLiteMetrics | None, list[float]]:
    """Return formant-lite summary plus its already-computed per-window F2s.

    Reliability fields below are descriptive estimator evidence, not a product
    validity threshold. In particular, a high valid-window fraction does not by
    itself make this LPC estimate safe for beginner-facing resonance coaching.
    """
    if not analysis_windows:
        return None, []

    f1_values: list[float] = []
    f2_values: list[float] = []
    window_pitch_values = [
        float(frame.pitchHz)
        for frame, _ in analysis_windows
        if frame.pitchHz is not None
        and math.isfinite(float(frame.pitchHz))
        and float(frame.pitchHz) > 0.0
    ]
    for frame, window in analysis_windows:
        # These windows come from _sample_analysis_windows, which keeps only
        # voiced frames with pitchHz > 0. F0 is used only to reject harmonic-lock
        # poles; it is not evidence that the formant solve itself is trustworthy.
        f1_hz, f2_hz = _estimate_lpc_formants(
            window, sample_rate, f0_hz=frame.pitchHz
        )
        if f1_hz is not None and f2_hz is not None:
            f1_values.append(f1_hz)
            f2_values.append(f2_hz)

    if len(f2_values) < 3:
        return None, f2_values

    analysis_window_count = len(analysis_windows)
    valid_window_count = len(f2_values)
    valid_window_pct = valid_window_count / analysis_window_count
    f1_median = _percentile(f1_values, 50.0, f1_values[0]) if f1_values else None
    f2_median = _percentile(f2_values, 50.0, f2_values[0])
    f2_p10 = _percentile(f2_values, 10.0, f2_median)
    f2_p25 = _percentile(f2_values, 25.0, f2_median)
    f2_p75 = _percentile(f2_values, 75.0, f2_median)
    f2_p90 = _percentile(f2_values, 90.0, f2_median)
    f2_iqr = max(0.0, f2_p75 - f2_p25)
    f2_abs_deviations = [abs(value - f2_median) for value in f2_values]
    f2_mad = _percentile(f2_abs_deviations, 50.0, 0.0)
    median_window_pitch = (
        _percentile(window_pitch_values, 50.0, window_pitch_values[0])
        if window_pitch_values else None
    )
    max_window_pitch = max(window_pitch_values) if window_pitch_values else None
    frontness_score = clamp((f2_median - 1200.0) / 1200.0)
    frontness_shift = (f2_median - 1700.0) / 600.0
    return (
        VoiceAttemptFormantLiteMetrics(
            f1MedianHz=round(float(f1_median), 2) if f1_median is not None else None,
            f2MedianHz=round(float(f2_median), 2),
            frontnessScore=round(float(frontness_score), 3),
            frontnessShift=round(float(frontness_shift), 3),
            analysisWindowCount=analysis_window_count,
            validWindowCount=valid_window_count,
            validWindowPct=round(float(valid_window_pct), 3),
            f2P10Hz=round(float(f2_p10), 2),
            f2P90Hz=round(float(f2_p90), 2),
            f2IqrHz=round(float(f2_iqr), 2),
            f2MadHz=round(float(f2_mad), 2),
            medianWindowPitchHz=round(float(median_window_pitch), 2)
            if median_window_pitch is not None else None,
            maxWindowPitchHz=round(float(max_window_pitch), 2)
            if max_window_pitch is not None else None,
        ),
        f2_values,
    )


def _harmonic_ratio_to_harmonic_strength(
    harmonic_ratio_mean: float | None,
) -> float | None:
    if harmonic_ratio_mean is None:
        return None
    ratio = max(min(float(harmonic_ratio_mean), 0.99), 0.01)
    return 10.0 * math.log10(ratio / max(1.0 - ratio, EPSILON))


def _frame_hnr_db(
    windowed: np.ndarray, sample_rate: int, pitch_hz: float | None
) -> float | None:
    """Window-corrected harmonics-to-noise ratio (dB) for one voiced frame.

    Boersma's method: take the autocorrelation of the windowed signal at the
    pitch lag, normalize by its zero-lag value, then divide by the analysis
    window's own normalized autocorrelation at that lag to undo the taper. The
    result r in [0,1) is the fraction of periodic power; HNR = 10*log10(r/(1-r)).

    r is energy-normalized, so this is gain-invariant — it does not move with
    mic level. The old path mapped a blend that mixed in an RMS-derived energy
    term (0.38 * energy_confidence), so a clean-but-quiet voice read as breathy
    and a loud-but-noisy voice read as clean — fatal for voice copy, where the
    reference clip and the user's mic sit at different levels. The window
    correction also keeps clean speech in the literature ~15-20 dB range instead
    of the taper-depressed values a raw peak would give."""
    n = int(windowed.size)
    if pitch_hz is None or pitch_hz <= 0.0 or n < 64:
        return None
    lag = int(round(sample_rate / pitch_hz))
    if lag < 1 or lag >= n:
        return None
    sig = np.asarray(windowed, dtype=np.float64)
    autocorr = np.correlate(sig, sig, mode="full")[n - 1 :]
    if autocorr[0] <= EPSILON:
        return None
    window = np.hanning(n)
    window_autocorr = np.correlate(window, window, mode="full")[n - 1 :]
    # Strongest window-corrected periodicity within +-2 samples of the pitch
    # lag (robust to integer-lag rounding); each term normalized by zero lag.
    lo, hi = max(1, lag - 2), min(n, lag + 3)
    signal_ratio = autocorr[lo:hi] / autocorr[0]
    window_ratio = window_autocorr[lo:hi] / window_autocorr[0]
    ratio = float(np.max(signal_ratio / np.maximum(window_ratio, EPSILON)))
    ratio = max(min(ratio, 0.9995), 1e-4)
    return 10.0 * math.log10(ratio / (1.0 - ratio))


def _track_pulse_runs(
    region: np.ndarray, expected_period: float, peak_floor: float
) -> list[list[int]]:
    """Period-synchronous glottal-pulse tracking within one voiced region.

    Returns a list of *runs* — each a list of consecutive pulse sample indices.
    A pulse is located by predicting the next one at +expected_period and taking
    the strongest sample within a +-35% tolerance window; this forces exactly one
    pulse per period and is far more robust to formant ripple than free-running
    amplitude-peak picking (which inflates jitter by catching formant peaks). A
    missing/too-weak pulse ends the current run (so perturbation is only ever
    measured over genuinely consecutive periods) and tracking re-seeds after it.
    """
    abs_region = np.abs(np.asarray(region, dtype=np.float64))
    n = abs_region.size
    period = float(expected_period)
    if n < period * 2 or period < 2:
        return []
    tol = max(2, int(round(period * 0.35)))
    runs: list[list[int]] = []
    current: list[int] = []
    cursor = 0
    while cursor < n - period:
        if not current:
            seg_end = min(n, cursor + int(round(period)))
            seg = abs_region[cursor:seg_end]
            if seg.size == 0:
                break
            pulse = cursor + int(np.argmax(seg))
            if abs_region[pulse] >= peak_floor:
                current = [pulse]
                cursor = pulse + 1
            else:
                cursor += int(round(period))
            continue
        predicted = current[-1] + period
        lo = int(round(predicted - tol))
        hi = int(round(predicted + tol))
        if hi >= n:
            break
        seg = abs_region[lo : hi + 1]
        pulse = lo + int(np.argmax(seg))
        if abs_region[pulse] >= peak_floor:
            current.append(pulse)
            cursor = pulse + 1
        else:
            if len(current) >= 2:
                runs.append(current)
            current = []
            cursor = hi + 1
    if len(current) >= 2:
        runs.append(current)
    return runs


def _pooled_perturbation(
    runs: list[np.ndarray], mean_value: float, points: int
) -> float | None:
    """Mean absolute deviation of each value from its centred ``points``-point
    running average, computed WITHIN each contiguous run (never across a run /
    region boundary) and pooled, normalized by ``mean_value``.

    points=2 -> local (|x_i - x_{i-1}|); 3 -> RAP/APQ3; 5 -> PPQ5/APQ5.
    """
    if mean_value <= 0:
        return None
    half = points // 2
    deviations: list[float] = []
    for series in runs:
        series = np.asarray(series, dtype=np.float64)
        m = series.size
        if points == 2:
            if m >= 2:
                deviations.extend(np.abs(np.diff(series)).tolist())
            continue
        for i in range(half, m - half):
            window = series[i - half : i + half + 1]
            deviations.append(abs(float(series[i]) - float(np.mean(window))))
    if not deviations:
        return None
    return float(np.mean(deviations)) / mean_value


def _split_runs_by_period_bounds(
    pulse_runs: list[list[int]],
    sample_rate: int,
    pmin: float,
    pmax: float,
    max_period_factor: float,
) -> list[np.ndarray]:
    """Convert pulse-index runs into period (seconds) runs, splitting a run
    wherever a period falls outside [pmin, pmax] or jumps from its predecessor by
    more than ``max_period_factor`` (a missed pulse / boundary)."""
    period_runs: list[np.ndarray] = []
    for pulses in pulse_runs:
        run: list[float] = []
        for k in range(1, len(pulses)):
            interval = float(pulses[k] - pulses[k - 1]) / sample_rate
            if not (pmin <= interval <= pmax):
                if len(run) >= 2:
                    period_runs.append(np.array(run, dtype=np.float64))
                run = []
                continue
            if run and max(interval / run[-1], run[-1] / interval) > max_period_factor:
                if len(run) >= 2:
                    period_runs.append(np.array(run, dtype=np.float64))
                run = [interval]
            else:
                run.append(interval)
        if len(run) >= 2:
            period_runs.append(np.array(run, dtype=np.float64))
    return period_runs


def _estimate_jitter(
    raw_samples: np.ndarray,
    sample_rate: int,
    median_pitch: float,
    voiced_regions: list[tuple[int, int]] | None = None,
) -> tuple[float | None, float | None, float | None]:
    """Estimate jitter (period length variation) from raw audio.

    Returns (jitter_local, jitter_rap, jitter_ppq5) or (None, None, None)
    if insufficient voiced periods are found.

    Pulses are located by period-synchronous tracking (see _track_pulse_runs),
    which is far more robust to formant ripple than free-running amplitude-peak
    picking, and perturbation (local/RAP/PPQ5) is measured only over genuinely
    consecutive periods within a run — never across a silence gap between voiced
    regions, which would fabricate a large deviation at the seam.
    """
    if median_pitch <= 0 or raw_samples.size < sample_rate * 0.1:
        return None, None, None

    expected_period = sample_rate / median_pitch
    if expected_period < 4 or expected_period > sample_rate // 2:
        return None, None, None

    pmin = 0.8 / MAX_PITCH_HZ  # Praat period floor (s)
    pmax = 1.25 / MIN_PITCH_HZ  # Praat period ceiling (s)
    max_period_factor = 1.3

    signal = raw_samples.astype(np.float64)
    if voiced_regions is None:
        voiced_regions = [(0, signal.size)]
    if float(np.max(np.abs(signal))) <= EPSILON:
        return None, None, None

    pulse_runs: list[list[int]] = []
    for region_start, region_end in voiced_regions:
        region = signal[region_start:region_end]
        region_peak = float(np.max(np.abs(region))) if region.size else 0.0
        if region_peak <= EPSILON:
            continue
        pulse_runs.extend(
            _track_pulse_runs(region, expected_period, region_peak * 0.05)
        )

    period_runs = _split_runs_by_period_bounds(
        pulse_runs, sample_rate, pmin, pmax, max_period_factor
    )
    if not period_runs:
        return None, None, None
    all_periods = np.concatenate(period_runs)
    if all_periods.size < 5:
        return None, None, None
    mean_period = float(np.mean(all_periods))
    if mean_period <= 0:
        return None, None, None

    jitter_local = _pooled_perturbation(period_runs, mean_period, 2)
    jitter_rap = _pooled_perturbation(period_runs, mean_period, 3)
    jitter_ppq5 = _pooled_perturbation(period_runs, mean_period, 5)
    return jitter_local, jitter_rap, jitter_ppq5


def _estimate_shimmer(
    raw_samples: np.ndarray,
    sample_rate: int,
    median_pitch: float,
    voiced_regions: list[tuple[int, int]] | None = None,
) -> tuple[float | None, float | None, float | None]:
    """Estimate shimmer (amplitude variation) from raw audio.

    Returns (shimmer_local, shimmer_apq3, shimmer_apq5) or (None, None, None)
    if insufficient voiced periods are found.

    Pulses are located by period-synchronous tracking (see _track_pulse_runs);
    a Hann-windowed RMS is measured at each pulse, and shimmer (local/APQ3/APQ5)
    is computed only over consecutive pulses within a run — never across a
    silence gap. A run is broken on a period-bound violation, a period-factor
    jump (1.3), or an amplitude-factor jump (1.6).
    """
    if median_pitch <= 0 or raw_samples.size < sample_rate * 0.1:
        return None, None, None

    expected_period = sample_rate / median_pitch
    if expected_period < 4 or expected_period > sample_rate // 2:
        return None, None, None

    pmin = 0.8 / MAX_PITCH_HZ
    pmax = 1.25 / MIN_PITCH_HZ
    max_period_factor = 1.3
    max_amp_factor = 1.6

    signal = raw_samples.astype(np.float64)
    if voiced_regions is None:
        voiced_regions = [(0, signal.size)]

    amp_runs: list[np.ndarray] = []
    for region_start, region_end in voiced_regions:
        region = signal[region_start:region_end]
        region_peak = float(np.max(np.abs(region))) if region.size else 0.0
        if region_peak <= EPSILON:
            continue
        for pulses in _track_pulse_runs(region, expected_period, region_peak * 0.05):
            run: list[float] = []
            prev_interval: float | None = None
            prev_amp: float | None = None
            for k in range(1, len(pulses)):
                interval = float(pulses[k] - pulses[k - 1]) / sample_rate
                pulse_abs = region_start + pulses[k]
                half_width = int(0.2 * interval * sample_rate)
                segment = signal[
                    max(0, pulse_abs - half_width) : min(signal.size, pulse_abs + half_width)
                ]
                if not (pmin <= interval <= pmax) or segment.size < 4:
                    if len(run) >= 2:
                        amp_runs.append(np.array(run, dtype=np.float64))
                    run = []
                    prev_interval = prev_amp = None
                    continue
                seg_n = segment.size
                hann = 0.5 + 0.5 * np.cos(
                    np.pi * (np.arange(seg_n) - seg_n / 2) / max(seg_n / 2, 1)
                )
                amp = float(np.sqrt(np.mean((segment * hann) ** 2)))
                break_run = (
                    prev_interval is not None
                    and max(interval / prev_interval, prev_interval / interval)
                    > max_period_factor
                ) or (
                    prev_amp is not None
                    and max(amp / max(prev_amp, EPSILON), prev_amp / max(amp, EPSILON))
                    > max_amp_factor
                )
                if break_run:
                    if len(run) >= 2:
                        amp_runs.append(np.array(run, dtype=np.float64))
                    run = [amp]
                else:
                    run.append(amp)
                prev_interval = interval
                prev_amp = amp
            if len(run) >= 2:
                amp_runs.append(np.array(run, dtype=np.float64))

    if not amp_runs:
        return None, None, None
    all_amps = np.concatenate(amp_runs)
    if all_amps.size < 5:
        return None, None, None
    mean_amp = float(np.mean(all_amps))
    if mean_amp <= EPSILON:
        return None, None, None

    shimmer_local = _pooled_perturbation(amp_runs, mean_amp, 2)
    shimmer_apq3 = _pooled_perturbation(amp_runs, mean_amp, 3)
    shimmer_apq5 = _pooled_perturbation(amp_runs, mean_amp, 5)
    return shimmer_local, shimmer_apq3, shimmer_apq5


def _blend_available_terms(
    terms: list[tuple[float, float | None]],
) -> float | None:
    """Weighted blend over the terms that were actually MEASURED.

    ``terms`` is a list of ``(weight, sub_score_or_None)``. Terms whose input
    was unavailable are dropped from BOTH the numerator and the denominator, so
    the surviving weights are renormalized to sum to 1. Returns ``None`` when
    nothing was measurable.

    This is the core of the 2026-07-26 fix: the previous code coerced missing
    inputs with ``float(x or 0.0)``, which is not "no evidence" but "worst
    possible evidence" — a take whose audio could not be measured picked up a
    manufactured 0.575 breathy floor and got nagged for breathiness. Absence is
    not the worst case; absence is absence.

    When every term is present the weights already sum to 1.0, so this is
    numerically identical to the old fixed-weight sum.
    """
    total_weight = 0.0
    weighted_sum = 0.0
    for weight, value in terms:
        if value is None:
            continue
        total_weight += weight
        weighted_sum += weight * value
    if total_weight <= 0.0:
        return None
    return clamp(weighted_sum / total_weight)


def _build_quality_metrics(
    analysis_windows: list[tuple[VoiceFrame, np.ndarray]],
    sample_rate: int,
    spectral_tilt_mean: float | None,
    harmonic_ratio_mean: float | None,
    stability_mean: float | None,
    clipping_mean: float | None,
    harmonic_strength_db: float | None = None,
    raw_samples: np.ndarray | None = None,
    timeline: list[VoiceFrame] | None = None,
    frame_size: int = LIVE_FRAME_SIZE,
) -> VoiceAttemptQualityMetrics | None:
    cpps_raw = [_cpps_like(window, sample_rate) for _, window in analysis_windows]
    # Drop unmeasurable windows (None) and non-positive readings explicitly. A
    # None here means "this window could not be measured", NOT "0 dB CPPS".
    cpps_values = [value for value in cpps_raw if value is not None and value > 0.0]
    cpps_like = _safe_mean(cpps_values, 0.0) if cpps_values else None

    # ── Surfaced display field ────────────────────────────────────────────
    # Prefer the true (gain-invariant) HNR aggregated from per-frame
    # autocorrelation peaks; fall back to the legacy ratio mapping only if no
    # voiced HNR was available. This fallback stays ONLY for the surfaced
    # harmonicStrength field's display continuity.
    harmonic_strength = (
        harmonic_strength_db
        if harmonic_strength_db is not None
        else _harmonic_ratio_to_harmonic_strength(harmonic_ratio_mean)
    )
    # ── Risk math input (fallback QUARANTINED) ────────────────────────────
    # harmonic_ratio_mean is a pitch-strength / loudness blend (see
    # _build_frame_advanced_metrics: 0.62*pitch_strength + 0.38*
    # energy_confidence, and energy_confidence is RMS-derived). It is therefore
    # LEVEL-DEPENDENT: a quiet mic produces a fake-low "HNR", which the old
    # code fed straight into breathyRisk — a quiet take read as breathy. Only
    # the gain-invariant per-frame HNR aggregate may drive a risk score; when
    # it is absent the harmonic term is simply UNAVAILABLE.
    #
    # INVARIANT this relies on: `harmonic_strength_db is None` must mean the
    # HNR was NOT MEASURABLE, never "measured and rejected". Renormalization
    # redistributes the harmonic term's weight (0.40/0.45) onto the survivors,
    # so if a future change makes _frame_hnr_db return None as a QUALITY
    # verdict, that verdict would silently inflate strain by 1/0.60 and
    # breathy by 1/0.55 on otherwise-normal takes — enough to newly cross the
    # live strain cue at 0.52. Keep _frame_hnr_db's None paths purely about
    # measurability (no pitch, window too short, zero energy).
    harmonic_strength_for_risk = harmonic_strength_db

    harmonic_breathy_term = (
        clamp((6.0 - float(harmonic_strength_for_risk)) / 12.0)
        if harmonic_strength_for_risk is not None
        else None
    )
    cpps_breathy_term = (
        clamp((10.0 - float(cpps_like)) / 8.0) if cpps_like is not None else None
    )
    tilt_breathy_term = (
        clamp((abs(min(float(spectral_tilt_mean), 0.0)) - 10.0) / 12.0)
        if spectral_tilt_mean is not None
        else None
    )
    # Tilt alone is not evidence of breathiness (it moves with vowel colour and
    # mic EQ as much as with glottal leakage), so at least one of the two
    # direct noise measures — HNR or CPPS — must be present.
    breathy_risk = (
        _blend_available_terms(
            [
                (0.45, harmonic_breathy_term),
                (0.35, cpps_breathy_term),
                (0.20, tilt_breathy_term),
            ]
        )
        if (harmonic_breathy_term is not None or cpps_breathy_term is not None)
        else None
    )

    harmonic_strain_term = (
        clamp((float(harmonic_strength_for_risk) - 10.0) / 12.0)
        if harmonic_strength_for_risk is not None
        else None
    )
    tilt_strain_term = (
        clamp((float(spectral_tilt_mean) + 10.0) / 8.0)
        if spectral_tilt_mean is not None
        else None
    )
    clipping_strain_term = (
        clamp((float(clipping_mean) - 0.005) / 0.04)
        if clipping_mean is not None
        else None
    )
    stability_strain_term = (
        clamp((0.60 - float(stability_mean)) / 0.30)
        if stability_mean is not None
        else None
    )
    # Tilt and clipping are capture-chain properties, not vocal-effort
    # measurements, so one of the two voice-derived terms (HNR or stability)
    # must be present before a strain verdict is emitted.
    strain_risk = (
        _blend_available_terms(
            [
                (0.40, harmonic_strain_term),
                (0.25, tilt_strain_term),
                (0.20, clipping_strain_term),
                (0.15, stability_strain_term),
            ]
        )
        if (harmonic_strain_term is not None or stability_strain_term is not None)
        else None
    )

    jitter_local, jitter_rap, jitter_ppq5 = None, None, None
    shimmer_local, shimmer_apq3, shimmer_apq5 = None, None, None
    if raw_samples is not None and timeline is not None:
        # Jitter/shimmer need clean, trustworthy periods — restrict to confident
        # voiced frames so a noisy/quiet take doesn't emit confident perturbation
        # numbers off unreliable audio.
        voiced_frames = [
            f for f in timeline if f.voiced and f.pitchHz > 0.0 and f.confidence >= 0.20
        ]
        if len(voiced_frames) >= 8:
            pitch_values = [f.pitchHz for f in voiced_frames]
            median_pitch = _percentile(pitch_values, 50.0, pitch_values[0])
            if median_pitch > 0:
                # Extract voiced regions from timeline (contiguous voiced frame runs)
                # Frame stride in samples depends on the hop size used to build
                # the timeline (frame_size parameter, default LIVE_FRAME_SIZE).
                voiced_regions: list[tuple[int, int]] = []
                region_start = None
                for i, frame in enumerate(timeline):
                    if frame.voiced and frame.pitchHz > 0.0:
                        if region_start is None:
                            region_start = i * frame_size
                    else:
                        if region_start is not None:
                            region_end = i * frame_size
                            if region_end - region_start >= frame_size * 3:
                                voiced_regions.append((region_start, region_end))
                            region_start = None
                if region_start is not None:
                    region_end = len(timeline) * frame_size
                    if region_end - region_start >= frame_size * 3:
                        voiced_regions.append((region_start, region_end))

                if voiced_regions:
                    jitter_local, jitter_rap, jitter_ppq5 = _estimate_jitter(
                        raw_samples, sample_rate, median_pitch, voiced_regions
                    )
                    shimmer_local, shimmer_apq3, shimmer_apq5 = _estimate_shimmer(
                        raw_samples, sample_rate, median_pitch, voiced_regions
                    )

    # Report nothing only when there is genuinely nothing to report. Risks are
    # now None (not 0.0) when unmeasurable, so the old "risk <= 0.0" test would
    # have raised a TypeError; the guard is restated over every field the model
    # can carry.
    if all(
        value is None
        for value in (
            cpps_like,
            harmonic_strength,
            breathy_risk,
            strain_risk,
            jitter_local,
            jitter_rap,
            jitter_ppq5,
            shimmer_local,
            shimmer_apq3,
            shimmer_apq5,
        )
    ):
        return None

    return VoiceAttemptQualityMetrics(
        cppsLike=round(float(cpps_like), 2) if cpps_like is not None else None,
        harmonicStrength=round(float(harmonic_strength), 2)
        if harmonic_strength is not None
        else None,
        breathyRisk=round(float(breathy_risk), 3) if breathy_risk is not None else None,
        strainRisk=round(float(strain_risk), 3) if strain_risk is not None else None,
        jitterLocal=round(float(jitter_local), 5) if jitter_local is not None else None,
        jitterRap=round(float(jitter_rap), 5) if jitter_rap is not None else None,
        jitterPpq5=round(float(jitter_ppq5), 5) if jitter_ppq5 is not None else None,
        shimmerLocal=round(float(shimmer_local), 5)
        if shimmer_local is not None
        else None,
        shimmerApq3=round(float(shimmer_apq3), 5) if shimmer_apq3 is not None else None,
        shimmerApq5=round(float(shimmer_apq5), 5) if shimmer_apq5 is not None else None,
    )


def _build_frame_advanced_metrics(
    mono: np.ndarray,
    windowed: np.ndarray,
    sample_rate: int,
    pitch_hz: float | None,
    pitch_strength: float,
    energy_confidence: float,
    voiced: bool,
) -> VoiceFrameAdvancedMetrics:
    spectrum = np.abs(np.fft.rfft(windowed))
    power = spectrum * spectrum
    frequencies = np.fft.rfftfreq(windowed.size, d=1.0 / sample_rate)
    speech_mask = (frequencies >= 80.0) & (frequencies <= 5000.0)
    speech_power = power[speech_mask]
    speech_frequencies = frequencies[speech_mask]
    total_energy = float(speech_power.sum())
    centroid_hz = (
        float((speech_frequencies * speech_power).sum() / total_energy)
        if total_energy > EPSILON
        else 0.0
    )
    bandwidth_hz = (
        _spectral_bandwidth_hz(
            speech_frequencies, speech_power, total_energy, centroid_hz
        )
        if total_energy > EPSILON
        else 0.0
    )
    clipping_pct = float(np.mean(np.abs(mono) >= 0.985)) if mono.size else 0.0
    harmonic_ratio = clamp(
        (0.62 * clamp((pitch_strength - 0.15) / 0.65)) + (0.38 * energy_confidence),
    )
    # Gain-invariant, window-corrected harmonics-to-noise ratio (dB). Only
    # meaningful on voiced frames.
    harmonic_noise_ratio_db = (
        _frame_hnr_db(windowed, sample_rate, pitch_hz) if voiced else None
    )
    pitch_confidence = (
        clamp((pitch_strength - 0.45) / 0.30) if pitch_hz is not None else 0.0
    )
    voiced_probability = clamp(
        (0.55 * energy_confidence) + (0.45 * clamp((pitch_strength - 0.12) / 0.7))
    )
    stability_score = (
        clamp(
            (0.50 * pitch_confidence)
            + (0.30 * harmonic_ratio)
            + (0.20 * (1.0 - clipping_pct * 2.5)),
        )
        if voiced
        else clamp(0.2 * energy_confidence)
    )

    return VoiceFrameAdvancedMetrics(
        pitchConfidence=round(float(pitch_confidence), 3),
        voicedProbability=round(float(voiced_probability), 3),
        rms=round(float(np.sqrt(np.mean(mono * mono))) if mono.size else 0.0, 5),
        spectralCentroidHz=round(float(centroid_hz), 2),
        spectralBandwidthHz=round(float(bandwidth_hz), 2),
        spectralFlux=round(float(_spectral_flux(spectrum)), 4),
        spectralTiltDbPerOct=round(
            float(_spectral_tilt_db_per_octave(frequencies, power, speech_mask)), 3
        ),
        harmonicRatio=round(float(harmonic_ratio), 3),
        harmonicNoiseRatioDb=(
            round(float(harmonic_noise_ratio_db), 2)
            if harmonic_noise_ratio_db is not None
            else None
        ),
        clippingPct=round(float(clipping_pct), 4),
        pitchSlopeStPerSec=0.0 if voiced else None,
        stabilityScore=round(float(stability_score), 3),
    )


def _smooth_advanced_metrics(
    previous: VoiceFrameAdvancedMetrics | None,
    current: VoiceFrameAdvancedMetrics | None,
    previous_pitch_hz: float,
    current_pitch_hz: float,
    previous_voiced: bool,
    current_voiced: bool,
    frame_duration_ms: int,
) -> VoiceFrameAdvancedMetrics | None:
    if current is None:
        return None
    if previous is None:
        if current_voiced and current_pitch_hz > 0:
            current.pitchSlopeStPerSec = 0.0
        return current

    def mix(old: float | None, new: float | None, alpha: float) -> float | None:
        if old is None:
            return new
        if new is None:
            return old
        return (old * (1.0 - alpha)) + (new * alpha)

    frame_seconds = max(frame_duration_ms / 1000.0, EPSILON)
    if (
        previous_voiced
        and current_voiced
        and previous_pitch_hz > 0
        and current_pitch_hz > 0
    ):
        pitch_slope_st_per_sec = float(
            (12.0 * math.log2(current_pitch_hz / previous_pitch_hz)) / frame_seconds
        )
        slope_penalty = clamp(abs(pitch_slope_st_per_sec) / 20.0)
        stability_score = clamp(
            (0.72 * float(current.stabilityScore or 0.0))
            + (0.28 * (1.0 - slope_penalty)),
        )
    else:
        pitch_slope_st_per_sec = 0.0
        stability_score = float(current.stabilityScore or 0.0)

    # HNR is meaningful only on voiced frames. Smooth across adjacent voiced
    # frames, start fresh after silence, and never carry a voiced value into an
    # unvoiced frame. The previous constructor accidentally omitted this field.
    harmonic_noise_ratio_db = None
    if current_voiced:
        harmonic_noise_ratio_db = (
            mix(
                previous.harmonicNoiseRatioDb,
                current.harmonicNoiseRatioDb,
                0.40,
            )
            if previous_voiced
            else current.harmonicNoiseRatioDb
        )

    return VoiceFrameAdvancedMetrics(
        pitchConfidence=round(
            float(mix(previous.pitchConfidence, current.pitchConfidence, 0.42) or 0.0),
            3,
        ),
        voicedProbability=round(
            float(
                mix(previous.voicedProbability, current.voicedProbability, 0.42) or 0.0
            ),
            3,
        ),
        rms=round(float(mix(previous.rms, current.rms, 0.45) or 0.0), 5),
        spectralCentroidHz=round(
            float(
                mix(previous.spectralCentroidHz, current.spectralCentroidHz, 0.35)
                or 0.0
            ),
            2,
        ),
        spectralBandwidthHz=round(
            float(
                mix(previous.spectralBandwidthHz, current.spectralBandwidthHz, 0.35)
                or 0.0
            ),
            2,
        ),
        spectralFlux=round(
            float(mix(previous.spectralFlux, current.spectralFlux, 0.40) or 0.0), 4
        ),
        spectralTiltDbPerOct=round(
            float(
                mix(previous.spectralTiltDbPerOct, current.spectralTiltDbPerOct, 0.35)
                or 0.0
            ),
            3,
        ),
        harmonicRatio=round(
            float(mix(previous.harmonicRatio, current.harmonicRatio, 0.40) or 0.0), 3
        ),
        harmonicNoiseRatioDb=(
            round(float(harmonic_noise_ratio_db), 2)
            if harmonic_noise_ratio_db is not None
            else None
        ),
        clippingPct=round(
            float(mix(previous.clippingPct, current.clippingPct, 0.30) or 0.0), 4
        ),
        pitchSlopeStPerSec=round(float(pitch_slope_st_per_sec), 3),
        stabilityScore=round(float(stability_score), 3),
    )


def analyze_pcm_frame(
    samples: np.ndarray,
    target_preset: str,
    time_ms: int,
    sample_rate: int = SAMPLE_RATE,
    analysis_profile: str = ANALYSIS_PROFILE_STANDARD,
    target_voice_profile: VoiceTargetVoiceProfile | None = None,
    target_source: str | None = None,
) -> VoiceFrame:
    profile = _resolve_target_profile(
        target_preset,
        target_voice_profile,
        source=target_source,
    )
    skip_formants = (
        normalize_analysis_profile(analysis_profile) == ANALYSIS_PROFILE_NO_FORMANTS
    )
    mono = np.asarray(samples, dtype=np.float32).reshape(-1)
    if mono.size == 0:
        return VoiceFrame(
            t=time_ms,
            voiced=False,
            pitchHz=0.0,
            pitchScore=0.0,
            resonanceScore=0.5,
            weightScore=0.5,
            confidence=0.0,
            loudnessDb=-90.0,
            advanced=VoiceFrameAdvancedMetrics(
                pitchConfidence=0.0,
                voicedProbability=0.0,
                rms=0.0,
                spectralCentroidHz=0.0,
                spectralBandwidthHz=0.0,
                spectralFlux=0.0,
                spectralTiltDbPerOct=0.0,
                harmonicRatio=0.0,
                clippingPct=0.0,
                pitchSlopeStPerSec=0.0,
                stabilityScore=0.0,
            ),
            analysisVersion=VOICE_ANALYSIS_VERSION,
        )

    centered = mono - float(mono.mean())
    rms = float(np.sqrt(np.mean(centered * centered))) if centered.size else 0.0
    loudness_db = 20.0 * math.log10(max(rms, 1e-5))
    window = np.hanning(centered.size).astype(np.float32)
    windowed = centered * window

    pitch_hz, pitch_strength = _estimate_pitch(centered, sample_rate)
    energy_confidence = clamp((rms - MIN_VOICED_RMS) / 0.08)
    voiced = (
        pitch_hz is not None and pitch_strength >= 0.45 and energy_confidence >= 0.05
    )

    resonance_score, weight_score = _estimate_timbre(
        windowed,
        sample_rate,
        pitch_hz if voiced else None,
        skip_formants=skip_formants,
    )
    pitch_score = (
        _band_similarity(
            pitch_hz or 0.0, profile.pitch_floor_hz, profile.pitch_ceiling_hz
        )
        if voiced
        else 0.0
    )
    pitch_confidence = (
        clamp((pitch_strength - 0.45) / 0.30) if pitch_hz is not None else 0.0
    )
    advanced = _build_frame_advanced_metrics(
        mono=centered,
        windowed=windowed,
        sample_rate=sample_rate,
        pitch_hz=pitch_hz,
        pitch_strength=pitch_strength,
        energy_confidence=energy_confidence,
        voiced=voiced,
    )

    if voiced:
        confidence = clamp(
            0.25 + (0.40 * energy_confidence) + (0.35 * pitch_confidence)
        )
        resolved_pitch = float(pitch_hz or 0.0)
    else:
        confidence = clamp(0.12 + (0.28 * energy_confidence), 0.0, 0.45)
        resolved_pitch = 0.0

    return VoiceFrame(
        t=int(time_ms),
        voiced=voiced,
        pitchHz=round(resolved_pitch, 2),
        pitchScore=round(float(pitch_score), 3),
        resonanceScore=round(float(resonance_score), 3),
        weightScore=round(float(weight_score), 3),
        confidence=round(float(confidence), 3),
        loudnessDb=round(float(loudness_db), 2),
        advanced=advanced,
        analysisVersion=VOICE_ANALYSIS_VERSION,
    )


def smooth_live_frame(previous: VoiceFrame | None, current: VoiceFrame) -> VoiceFrame:
    if previous is None:
        return current

    def mix(old: float, new: float, alpha: float) -> float:
        return (old * (1.0 - alpha)) + (new * alpha)

    if previous.voiced and current.voiced:
        pitch_hz = mix(previous.pitchHz, current.pitchHz, 0.45)
        pitch_score = mix(previous.pitchScore, current.pitchScore, 0.45)
    else:
        pitch_hz = current.pitchHz
        pitch_score = current.pitchScore

    return VoiceFrame(
        t=current.t,
        voiced=current.voiced,
        pitchHz=round(float(pitch_hz), 2),
        pitchScore=round(float(pitch_score), 3),
        resonanceScore=round(
            float(mix(previous.resonanceScore, current.resonanceScore, 0.38)), 3
        ),
        weightScore=round(
            float(mix(previous.weightScore, current.weightScore, 0.38)), 3
        ),
        confidence=round(float(mix(previous.confidence, current.confidence, 0.50)), 3),
        loudnessDb=round(float(mix(previous.loudnessDb, current.loudnessDb, 0.45)), 2),
        advanced=_smooth_advanced_metrics(
            previous.advanced,
            current.advanced,
            previous.pitchHz,
            current.pitchHz,
            previous.voiced,
            current.voiced,
            max(
                current.t - previous.t,
                int(round((LIVE_FRAME_SIZE / SAMPLE_RATE) * 1000)),
            ),
        ),
        analysisVersion=current.analysisVersion
        or previous.analysisVersion
        or VOICE_ANALYSIS_VERSION,
    )


def build_timeline_from_samples(
    samples: np.ndarray,
    target_preset: str,
    sample_rate: int = SAMPLE_RATE,
    frame_size: int = LIVE_FRAME_SIZE,
    hop_size: int = LIVE_HOP_SIZE,
    analysis_profile: str = ANALYSIS_PROFILE_STANDARD,
    target_voice_profile: VoiceTargetVoiceProfile | None = None,
    target_source: str | None = None,
) -> list[VoiceFrame]:
    signal = np.asarray(samples, dtype=np.float32).reshape(-1)
    if signal.size == 0:
        return []

    if signal.size < frame_size:
        signal = np.pad(signal, (0, frame_size - signal.size))

    positions = list(range(0, max(signal.size - frame_size, 0) + 1, hop_size))
    last_start = max(signal.size - frame_size, 0)
    if not positions or positions[-1] != last_start:
        positions.append(last_start)

    timeline: list[VoiceFrame] = []
    previous: VoiceFrame | None = None

    for start in positions:
        frame_samples = signal[start : start + frame_size]
        frame = analyze_pcm_frame(
            samples=frame_samples,
            target_preset=target_preset,
            time_ms=int(round(start * 1000 / sample_rate)),
            sample_rate=sample_rate,
            analysis_profile=analysis_profile,
            target_voice_profile=target_voice_profile,
            target_source=target_source,
        )
        frame = smooth_live_frame(previous, frame) if previous is not None else frame
        timeline.append(frame)
        previous = frame

    return timeline


def compress_timeline(
    timeline: list[VoiceFrame], max_points: int = MAX_REFERENCE_TIMELINE_POINTS
) -> list[VoiceFrame]:
    if len(timeline) <= max_points:
        return timeline

    sampled: list[VoiceFrame] = []
    last_index = len(timeline) - 1
    for idx in range(max_points):
        source_index = round((idx / (max_points - 1)) * last_index)
        sampled.append(timeline[source_index])
    return sampled


def _analysis_frames(timeline: list[VoiceFrame]) -> list[VoiceFrame]:
    voiced = [
        frame
        for frame in timeline
        if frame.voiced and frame.confidence >= 0.20 and frame.pitchHz > 0.0
    ]
    if voiced:
        return voiced
    semi_confident = [frame for frame in timeline if frame.confidence >= 0.15]
    return semi_confident or timeline


def _frame_hits_target(frame: VoiceFrame, profile: VoiceTargetProfile) -> bool:
    return (
        frame.voiced
        and frame.confidence >= 0.25
        and profile.pitch_floor_hz <= frame.pitchHz <= profile.pitch_ceiling_hz
        and _resonance_meets_target(frame.resonanceScore, profile)
        and _weight_meets_target(frame.weightScore, profile)
    )


def _target_quality_score(
    mean_pitch_hz: float,
    pitch_range_st: float,
    resonance_mean: float,
    weight_mean: float,
    target_hit_pct: float,
    profile: VoiceTargetProfile,
) -> float:
    pitch_fit = _band_similarity(
        mean_pitch_hz, profile.pitch_floor_hz, profile.pitch_ceiling_hz
    )
    range_fit = clamp(pitch_range_st / max(profile.min_pitch_range_st, 1e-6))
    resonance_fit = _resonance_fit_score(resonance_mean, profile)
    weight_fit = _weight_fit_score(weight_mean, profile)
    return clamp(
        (0.40 * target_hit_pct)
        + (0.20 * pitch_fit)
        + (0.15 * range_fit)
        + (0.15 * resonance_fit)
        + (0.10 * weight_fit)
    )


def _feature_series(timeline: list[VoiceFrame]) -> tuple[np.ndarray, np.ndarray] | None:
    frames = [
        frame
        for frame in timeline
        if frame.voiced and frame.confidence >= 0.20 and frame.pitchHz > 0.0
    ]
    if not frames:
        return None

    if len(frames) == 1:
        positions = np.array([0.0], dtype=np.float32)
    else:
        raw_positions = np.array([float(frame.t) for frame in frames], dtype=np.float32)
        raw_positions = raw_positions - raw_positions[0]
        span = float(raw_positions[-1]) if raw_positions.size > 1 else 0.0
        positions = (
            raw_positions / span
            if span > 0
            else np.linspace(0.0, 1.0, num=len(frames), dtype=np.float32)
        )

    series = np.array(
        [
            [
                clamp((frame.pitchHz - 120.0) / 200.0),
                frame.resonanceScore,
                frame.weightScore,
            ]
            for frame in frames
        ],
        dtype=np.float32,
    )
    return positions, series


def _resample_series(
    positions: np.ndarray, series: np.ndarray, target_length: int
) -> np.ndarray:
    if series.shape[0] == 1:
        return np.repeat(series, target_length, axis=0)

    target_positions = np.linspace(0.0, 1.0, num=target_length, dtype=np.float32)
    resampled = np.empty((target_length, series.shape[1]), dtype=np.float32)
    for column in range(series.shape[1]):
        resampled[:, column] = np.interp(target_positions, positions, series[:, column])
    return resampled


def _trajectory_similarity(
    timeline: list[VoiceFrame], reference_timeline: list[VoiceFrame]
) -> float:
    current_series = _feature_series(timeline)
    reference_series = _feature_series(reference_timeline)
    if current_series is None or reference_series is None:
        return 0.0

    current_positions, current_values = current_series
    reference_positions, reference_values = reference_series
    target_length = max(
        16, min(48, max(current_values.shape[0], reference_values.shape[0]))
    )

    current_resampled = _resample_series(
        current_positions, current_values, target_length
    )
    reference_resampled = _resample_series(
        reference_positions, reference_values, target_length
    )
    distance = float(
        np.linalg.norm(current_resampled - reference_resampled, axis=1).mean()
    )
    return clamp(1.0 - (distance / math.sqrt(3.0)))


def _reference_similarity_score(
    metric_similarity: float,
    contour_similarity: float,
    target_quality: float,
) -> float:
    if contour_similarity > 0.0:
        combined_similarity = (0.60 * metric_similarity) + (0.40 * contour_similarity)
    else:
        combined_similarity = metric_similarity

    return clamp((0.75 * combined_similarity) + (0.25 * target_quality))


def _reference_similarity_components(
    timeline: list[VoiceFrame],
    reference_analysis: ReferenceAnalysisResponse,
    mean_pitch_hz: float,
    pitch_range_st: float,
    resonance_mean: float,
    weight_mean: float,
    current_advanced_metrics: VoiceAttemptAdvancedMetrics | None = None,
) -> tuple[float, float]:
    reference_metrics = reference_analysis.metrics
    metric_similarity = (
        (0.35 * _proximity_score(mean_pitch_hz, reference_metrics.meanPitchHz, 45.0))
        + (0.15 * _proximity_score(pitch_range_st, reference_metrics.pitchRangeSt, 4.0))
        + (
            0.25
            * _proximity_score(resonance_mean, reference_metrics.resonanceMean, 0.25)
        )
        + (0.25 * _proximity_score(weight_mean, reference_metrics.weightMean, 0.25))
    )
    reference_advanced_metrics = reference_metrics.advanced
    if current_advanced_metrics is not None and reference_advanced_metrics is not None:
        advanced_similarities: list[float] = []

        current_formant = current_advanced_metrics.formantLite
        reference_formant = reference_advanced_metrics.formantLite
        if current_formant is not None and reference_formant is not None:
            if (
                current_formant.frontnessScore is not None
                and reference_formant.frontnessScore is not None
            ):
                advanced_similarities.append(
                    _proximity_score(
                        current_formant.frontnessScore,
                        reference_formant.frontnessScore,
                        0.22,
                    )
                )
            if (
                current_formant.f2MedianHz is not None
                and reference_formant.f2MedianHz is not None
            ):
                advanced_similarities.append(
                    _proximity_score(
                        current_formant.f2MedianHz, reference_formant.f2MedianHz, 350.0
                    )
                )

        current_quality = current_advanced_metrics.quality
        reference_quality = reference_advanced_metrics.quality
        if current_quality is not None and reference_quality is not None:
            if (
                current_quality.cppsLike is not None
                and reference_quality.cppsLike is not None
            ):
                advanced_similarities.append(
                    _proximity_score(
                        current_quality.cppsLike, reference_quality.cppsLike, 5.0
                    )
                )
            if (
                current_quality.harmonicStrength is not None
                and reference_quality.harmonicStrength is not None
            ):
                advanced_similarities.append(
                    _proximity_score(
                        current_quality.harmonicStrength,
                        reference_quality.harmonicStrength,
                        6.0,
                    )
                )
            if (
                current_quality.breathyRisk is not None
                and reference_quality.breathyRisk is not None
            ):
                advanced_similarities.append(
                    _proximity_score(
                        current_quality.breathyRisk, reference_quality.breathyRisk, 0.22
                    )
                )
            if (
                current_quality.strainRisk is not None
                and reference_quality.strainRisk is not None
            ):
                advanced_similarities.append(
                    _proximity_score(
                        current_quality.strainRisk, reference_quality.strainRisk, 0.20
                    )
                )

        if advanced_similarities:
            metric_similarity = (0.74 * metric_similarity) + (
                0.26 * _safe_mean(advanced_similarities, metric_similarity)
            )

    contour_similarity = _trajectory_similarity(timeline, reference_analysis.timeline)
    return clamp(metric_similarity), clamp(contour_similarity)


def _pitch_std_st(pitch_values: list[float]) -> float:
    if len(pitch_values) < 2:
        return 0.0
    median_pitch = _percentile(pitch_values, 50.0, pitch_values[0])
    if median_pitch <= 0:
        return 0.0
    semitone_offsets = [
        12.0 * math.log2(max(value, 1e-3) / median_pitch)
        for value in pitch_values
        if value > 0
    ]
    if len(semitone_offsets) < 2:
        return 0.0
    return float(np.std(np.asarray(semitone_offsets, dtype=np.float32)))


def _mean_advanced_metric(
    frames: list[VoiceFrame], field_name: str, default: float = 0.0
) -> float:
    values = []
    for frame in frames:
        advanced = getattr(frame, "advanced", None)
        value = getattr(advanced, field_name, None) if advanced is not None else None
        if value is None:
            continue
        values.append(float(value))
    return _safe_mean(values, default)


def _glide_smoothness(timeline: list[VoiceFrame]) -> float | None:
    """0-1 vocalise-glide proxy: 1 − std(per-frame pitch slope, st/s) / 30.

    Reuses the live-path slope formula (12·log2(p₁/p₀)/Δt — see
    _smooth_advanced_metrics) over timeline-ADJACENT voiced pairs, so a clean
    glide (slope drifts slowly) scores near 1 and frame-to-frame pitch jitter
    (slope swinging tens of st/s) scores near 0. Null when <8 voiced frames
    (caller contract) or too few adjacent pairs to estimate a spread.
    Cost: one O(frames) pass over pitch values the frames already carry."""
    voiced_count = sum(
        1 for frame in timeline if frame.voiced and frame.pitchHz > 0.0
    )
    if voiced_count < 8:
        return None

    slopes: list[float] = []
    previous: VoiceFrame | None = None
    for frame in timeline:
        is_voiced = frame.voiced and frame.pitchHz > 0.0
        if is_voiced and previous is not None:
            dt_ms = float(frame.t - previous.t)
            if 0.0 < dt_ms <= GLIDE_MAX_SLOPE_GAP_MS:
                slopes.append(
                    (12.0 * math.log2(frame.pitchHz / previous.pitchHz))
                    / (dt_ms / 1000.0)
                )
        previous = frame if is_voiced else None

    if len(slopes) < 4:
        return None
    slope_std = float(np.std(np.asarray(slopes, dtype=np.float64)))
    return round(clamp(1.0 - (slope_std / GLIDE_SLOPE_STD_NORM_ST_PER_SEC)), 3)


def _trill_metrics(
    timeline: list[VoiceFrame],
) -> tuple[float | None, bool | None, int | None]:
    """(trillRateHz, trillDetected, trillDurationMs) from the frame-RMS envelope.

    ONE lag-limited autocorrelation over the per-frame rms series the frames
    already carry, trimmed to the voiced span: normalized autocorr at lags up
    to fps/15, strongest strict local maximum, parabolic-interpolated to a rate.
    Detected iff that peak ≥ TRILL_MIN_AUTOCORR (see the constant for the
    prominence rationale) and the interpolated rate lands in 15-45 Hz.

    Nulls (analysis impossible): no voiced span; frame rate below 2×45 Hz so
    the band exceeds Nyquist (the ~16 fps live timeline); series shorter than
    TRILL_MIN_FRAMES. False + null rate: analysis ran, no prominent modulation.
    Cost: ≤ ~8 dot products over a ≤ few-thousand-point series — orders of
    magnitude under one frame's LPC solve."""
    first_voiced: int | None = None
    last_voiced: int | None = None
    for index, frame in enumerate(timeline):
        if frame.voiced and frame.pitchHz > 0.0:
            if first_voiced is None:
                first_voiced = index
            last_voiced = index
    if first_voiced is None or last_voiced is None:
        return None, None, None

    span = timeline[first_voiced : last_voiced + 1]
    times: list[float] = []
    rms_values: list[float] = []
    for frame in span:
        if frame.advanced is not None and frame.advanced.rms is not None:
            times.append(float(frame.t))
            rms_values.append(float(frame.advanced.rms))
    if len(rms_values) < TRILL_MIN_FRAMES:
        return None, None, None

    deltas = np.diff(np.asarray(times, dtype=np.float64))
    if deltas.size == 0:
        return None, None, None
    median_dt_ms = float(np.median(deltas))
    if median_dt_ms <= 0.0:
        return None, None, None
    fps = 1000.0 / median_dt_ms
    if fps < 2.0 * TRILL_MAX_RATE_HZ:
        # The 15-45 Hz band is (partly) beyond Nyquist at this frame rate —
        # true for the ~16 fps live timeline; the ~100 fps offline path passes.
        return None, None, None

    envelope = np.asarray(rms_values, dtype=np.float64)
    envelope = envelope - float(envelope.mean())
    zero_lag = float(np.dot(envelope, envelope))
    if zero_lag <= EPSILON:
        # Constant envelope: the analysis ran and found nothing periodic.
        return None, False, None

    max_lag = min(
        int(math.floor(fps / TRILL_MIN_RATE_HZ)) + 1, envelope.size // 3
    )
    if max_lag < 3:
        return None, None, None
    autocorr = np.empty(max_lag + 1, dtype=np.float64)
    autocorr[0] = 1.0
    for lag in range(1, max_lag + 1):
        autocorr[lag] = float(
            np.dot(envelope[:-lag], envelope[lag:]) / zero_lag
        )

    best_lag: int | None = None
    best_value = -np.inf
    # Lag 1 is excluded: EMA smoothing makes it always-high and its rate (=fps)
    # is far above the band anyway.
    for lag in range(2, max_lag):
        if (
            autocorr[lag] > autocorr[lag - 1]
            and autocorr[lag] >= autocorr[lag + 1]
            and autocorr[lag] > best_value
        ):
            best_lag = lag
            best_value = float(autocorr[lag])
    if best_lag is None:
        return None, False, None

    interpolated_lag = best_lag + _parabolic_interpolation(
        float(autocorr[best_lag - 1]),
        float(autocorr[best_lag]),
        float(autocorr[best_lag + 1]),
    )
    rate_hz = fps / max(interpolated_lag, 1e-6)
    detected = bool(
        best_value >= TRILL_MIN_AUTOCORR
        and TRILL_MIN_RATE_HZ <= rate_hz <= TRILL_MAX_RATE_HZ
    )
    if not detected:
        return None, False, None
    duration_ms = int(round(times[-1] - times[0] + median_dt_ms))
    return round(float(rate_hz), 2), True, duration_ms


def _f2_range_hz(f2_values: list[float]) -> float | None:
    """max−min of the per-window F2 list; null when <3 windows measured."""
    if len(f2_values) < 3:
        return None
    return round(float(max(f2_values) - min(f2_values)), 2)


def _hit_pitch_ceiling(pitch_values: list[float]) -> bool | None:
    """True when ≥5% of voiced pitches sit within 2 Hz of the 400 Hz clamp."""
    if not pitch_values:
        return None
    near_ceiling = sum(
        1
        for value in pitch_values
        if value >= (MAX_PITCH_HZ - PITCH_CEILING_MARGIN_HZ)
    )
    return bool((near_ceiling / len(pitch_values)) >= PITCH_CEILING_MIN_FRACTION)


def _build_reliability_flags(
    frame_count: int,
    voiced_frame_pct: float,
    confident_frame_pct: float,
    score_confidence: float,
    mean_loudness_db: float,
) -> list[str]:
    flags: list[str] = []
    if frame_count < 8:
        flags.append("short_sample")
    if voiced_frame_pct <= 0.0:
        flags.append("no_voiced_frames")
    if voiced_frame_pct < 0.45:
        flags.append("low_voiced_coverage")
    if confident_frame_pct < 0.55:
        flags.append("low_confidence")
    if score_confidence < 0.58:
        flags.append("low_score_confidence")
    if mean_loudness_db < -33.0:
        flags.append("quiet_input")
    return flags


def build_attempt_metrics(
    timeline: list[VoiceFrame],
    target_preset: str,
    reference_analysis: ReferenceAnalysisResponse | None = None,
    raw_samples: np.ndarray | None = None,
    sample_rate: int = SAMPLE_RATE,
    frame_size: int = LIVE_FRAME_SIZE,
    analysis_profile: str = ANALYSIS_PROFILE_STANDARD,
    target_voice_profile: VoiceTargetVoiceProfile | None = None,
    target_source: str | None = None,
) -> VoiceAttemptMetrics:
    profile = _resolve_target_profile(
        target_preset,
        target_voice_profile,
        source=target_source,
    )
    analysis_profile = normalize_analysis_profile(analysis_profile)
    skip_formants = analysis_profile == ANALYSIS_PROFILE_NO_FORMANTS
    frames = _analysis_frames(timeline)
    all_frames = timeline or []
    pitch_values = [
        frame.pitchHz for frame in frames if frame.voiced and frame.pitchHz > 0.0
    ]
    voiced_frames = [
        frame for frame in all_frames if frame.voiced and frame.pitchHz > 0.0
    ]
    confident_voiced_frames = [
        frame for frame in voiced_frames if frame.confidence >= 0.20
    ]

    mean_pitch_hz = _safe_mean(
        pitch_values, (profile.pitch_floor_hz + profile.pitch_ceiling_hz) / 2.0
    )
    if len(pitch_values) >= 2:
        # Robust contour spread: isolated octave errors/tail misclassifications
        # must not be rewarded as expressiveness or reference similarity.
        pitch_low = max(_percentile(pitch_values, 10.0, min(pitch_values)), 1e-3)
        pitch_high = _percentile(pitch_values, 90.0, max(pitch_values))
        pitch_range_st = max(0.0, 12.0 * math.log2(pitch_high / pitch_low))
    else:
        pitch_range_st = 0.0

    resonance_mean = _safe_mean(
        [frame.resonanceScore for frame in frames], profile.min_resonance_mean * 0.92
    )
    weight_mean = _safe_mean(
        [frame.weightScore for frame in frames],
        min(0.95, profile.max_weight_mean + 0.08),
    )

    target_hits = sum(1 for frame in frames if _frame_hits_target(frame, profile))
    target_hit_pct = (target_hits / len(frames)) if frames else 0.0
    target_quality = _target_quality_score(
        mean_pitch_hz=mean_pitch_hz,
        pitch_range_st=pitch_range_st,
        resonance_mean=resonance_mean,
        weight_mean=weight_mean,
        target_hit_pct=target_hit_pct,
        profile=profile,
    )

    sample_count = len(all_frames)
    voiced_frame_pct = (len(voiced_frames) / sample_count) if sample_count else 0.0
    confident_frame_pct = (
        (len(confident_voiced_frames) / len(voiced_frames)) if voiced_frames else 0.0
    )
    score_confidence = clamp(
        (0.40 * voiced_frame_pct)
        + (0.35 * confident_frame_pct)
        + (
            0.25
            * clamp(
                _mean_advanced_metric(
                    voiced_frames or all_frames, "stabilityScore", 0.0
                )
            )
        ),
    )
    median_pitch_hz = _percentile(pitch_values, 50.0, mean_pitch_hz)
    pitch_p10_hz = _percentile(pitch_values, 10.0, mean_pitch_hz)
    pitch_p90_hz = _percentile(pitch_values, 90.0, mean_pitch_hz)
    phrase_start_pitch_hz = pitch_values[0] if pitch_values else 0.0
    phrase_end_pitch_hz = pitch_values[-1] if pitch_values else 0.0
    phrase_end_drop_hz = (
        max(
            0.0,
            _safe_mean(
                pitch_values[-max(1, len(pitch_values) // 4) :], phrase_end_pitch_hz
            )
            - phrase_end_pitch_hz,
        )
        if pitch_values
        else 0.0
    )
    pitch_drift_st = 0.0
    if phrase_start_pitch_hz > 0 and phrase_end_pitch_hz > 0:
        pitch_drift_st = 12.0 * math.log2(
            max(phrase_end_pitch_hz, 1e-3) / max(phrase_start_pitch_hz, 1e-3)
        )

    # Pitch target occupancy: % of voiced frames whose pitch lands in the
    # target band [pitch_floor, pitch_ceiling]. 0.0 if no voiced frames.
    in_band_count = sum(
        1
        for f in frames
        if f.voiced
        and f.pitchHz > 0.0
        and profile.pitch_floor_hz <= f.pitchHz <= profile.pitch_ceiling_hz
    )
    pitch_target_occupancy_pct = (
        round(100.0 * in_band_count / len(frames), 1) if frames else 0.0
    )

    # Phrase-final pitch change in semitones (negative = falling). Compares the
    # last quarter of the phrase to the first quarter, so a falling ending
    # is reflected even when the very last sample is brief.
    phrase_final_drop_st = 0.0
    if len(pitch_values) >= 4:
        tail = pitch_values[-max(1, len(pitch_values) // 4) :]
        head = pitch_values[: max(1, len(pitch_values) // 4)]
        head_mean = _safe_mean(head, mean_pitch_hz)
        tail_mean = _safe_mean(tail, phrase_end_pitch_hz)
        if head_mean > 0 and tail_mean > 0:
            phrase_final_drop_st = round(
                12.0 * math.log2(max(tail_mean, 1e-3) / max(head_mean, 1e-3)),
                2,
            )
    mean_loudness_db = (
        _safe_mean([frame.loudnessDb for frame in all_frames], -90.0)
        if all_frames
        else -90.0
    )
    peak_loudness_db = max([frame.loudnessDb for frame in all_frames], default=-90.0)
    min_loudness_db = min([frame.loudnessDb for frame in all_frames], default=-90.0)
    spectral_centroid_mean_hz = round(
        float(
            _mean_advanced_metric(
                voiced_frames or all_frames, "spectralCentroidHz", 0.0
            )
        ),
        2,
    )
    spectral_tilt_mean_db_per_oct = round(
        float(
            _mean_advanced_metric(
                voiced_frames or all_frames, "spectralTiltDbPerOct", 0.0
            )
        ),
        3,
    )
    harmonic_ratio_mean = round(
        float(_mean_advanced_metric(voiced_frames or all_frames, "harmonicRatio", 0.0)),
        3,
    )
    hnr_values = [
        f.advanced.harmonicNoiseRatioDb
        for f in (voiced_frames or all_frames)
        if f.advanced is not None and f.advanced.harmonicNoiseRatioDb is not None
    ]
    harmonic_strength_db = (
        # Trim transition frames so adding leading/trailing silence cannot
        # materially change an otherwise identical steady-voice HNR aggregate.
        round(float(_trimmed_mean(hnr_values, 0.0)), 2) if hnr_values else None
    )
    stability_mean = round(
        float(
            _mean_advanced_metric(voiced_frames or all_frames, "stabilityScore", 0.0)
        ),
        3,
    )
    clipping_mean = round(
        float(_mean_advanced_metric(voiced_frames or all_frames, "clippingPct", 0.0)), 4
    )

    # Consumer-hardware capture health (2026-07-19) — attempt-level, computed
    # from data the frames already carry (per-frame rms + clippingPct); no new
    # DSP passes.
    #  - clippingPct: fraction of samples at/over saturation across ALL frames
    #    (per-frame advanced.clippingPct is already a sample fraction, so an
    #    equal-size-frame mean is the attempt-wide fraction). Unlike
    #    `clipping_mean` above (voiced-biased, feeds the quality composite),
    #    capture health counts clipping anywhere in the take — the same
    #    rationale as reference_analyzer._clip_wide_clipping_pct.
    #  - noiseFloorDb / snrDb: speech level (median voiced-frame RMS, in dB)
    #    minus noise floor (20th-percentile unvoiced-frame RMS, in dB — a low
    #    percentile approximates the between-words floor while staying robust
    #    to breaths/keyboard taps). snrDb is null when the take has no voiced
    #    or no unvoiced frames to compare (per the capture contract: absent
    #    measurement stays null, never 0).
    #  - captureReliability: 0-1 CHANNEL composite over the available capture
    #    components (SNR 0.45 · clipping 0.25 · level 0.30, weights
    #    renormalized when a component is unavailable). Deliberately NOT an
    #    alias of scoreConfidence: scoreConfidence (above) is analysis-tracking
    #    confidence (voiced coverage + pitch confidence + stability) and never
    #    sees SNR or clipping — the backend safety gates read the two names as
    #    separate reasons, so they must stay separate numbers.
    frame_clip_values = [
        float(frame.advanced.clippingPct)
        for frame in all_frames
        if frame.advanced is not None and frame.advanced.clippingPct is not None
    ]
    attempt_clipping_pct = (
        round(float(_safe_mean(frame_clip_values, 0.0)), 4)
        if frame_clip_values
        else None
    )

    def _frame_rms_values(frame_subset: list[VoiceFrame]) -> list[float]:
        return [
            float(frame.advanced.rms)
            for frame in frame_subset
            if frame.advanced is not None and frame.advanced.rms is not None
        ]

    unvoiced_frames = [
        frame for frame in all_frames if not (frame.voiced and frame.pitchHz > 0.0)
    ]
    speech_rms_values = [value for value in _frame_rms_values(voiced_frames) if value > 0.0]
    noise_rms_values = _frame_rms_values(unvoiced_frames)
    noise_floor_db = (
        round(
            20.0 * math.log10(max(_percentile(noise_rms_values, 20.0, 0.0), 1e-5)), 2
        )
        if noise_rms_values
        else None
    )
    snr_db: float | None = None
    if speech_rms_values and noise_floor_db is not None:
        speech_level_db = 20.0 * math.log10(
            max(_percentile(speech_rms_values, 50.0, 0.0), 1e-5)
        )
        snr_db = round(speech_level_db - float(noise_floor_db), 2)

    capture_components: list[tuple[float, float]] = []
    if snr_db is not None:
        # 12 dB (the gates' "low SNR" bar) maps to 0.5; >=24 dB is fully clean.
        capture_components.append((0.45, clamp(float(snr_db) / 24.0)))
    if attempt_clipping_pct is not None:
        # 0 -> 1.0; 2% (the sustained-clipping gate) -> 0.6; >=5% (the clone
        # gate's reject bar) -> 0.0.
        capture_components.append(
            (0.25, clamp(1.0 - (float(attempt_clipping_pct) / 0.05)))
        )
    if all_frames:
        # -45 dBFS mean loudness -> 0; -33 (the quiet_input flag bar) ~ 0.5;
        # >= -20 -> 1.0.
        capture_components.append(
            (0.30, clamp((float(mean_loudness_db) + 45.0) / 25.0))
        )
    capture_reliability = (
        round(
            sum(weight * score for weight, score in capture_components)
            / sum(weight for weight, _ in capture_components),
            3,
        )
        if capture_components
        else None
    )

    analysis_windows = _sample_analysis_windows(
        raw_samples, voiced_frames or frames, sample_rate
    )
    # 'no_formants' gate: skip the formant-lite LPC sweep entirely; the
    # formant-derived attempt fields (formantLite medians, f2RangeHz) stay
    # null and analysisProfile is echoed below so consumers can tell why.
    if skip_formants:
        formant_lite_metrics = None
        f2_window_values: list[float] = []
    else:
        formant_lite_metrics, f2_window_values = _build_formant_lite_metrics(
            analysis_windows, sample_rate
        )
    # Risk-math inputs are gated on there actually having been a MEASURED
    # voice. Two ways the aggregates above can be defaults rather than
    # measurements:
    #   * no voiced frames — `voiced_frames or all_frames` then averages
    #     silence, where per-frame stabilityScore degrades to
    #     `0.2 * energy_confidence` (a loudness proxy) and spectral tilt
    #     collapses toward 0 dB/oct;
    #   * no per-frame `advanced` payload at all (e.g. the synthetic timeline
    #     build_phrase_forecast hands to build_attempt_metrics) — then
    #     _mean_advanced_metric returns its `default` argument for every field.
    # Either way the numbers describe absence, not a voice, so they are passed
    # as "unavailable" rather than driving a breathy/strain verdict. The
    # SURFACED spectralTiltMeanDbPerOct / stabilityMean fields are untouched.
    has_voiced_evidence = any(
        frame.advanced is not None for frame in (voiced_frames or [])
    )
    quality_metrics = _build_quality_metrics(
        analysis_windows=analysis_windows,
        sample_rate=sample_rate,
        spectral_tilt_mean=(
            spectral_tilt_mean_db_per_oct if has_voiced_evidence else None
        ),
        harmonic_ratio_mean=harmonic_ratio_mean,
        harmonic_strength_db=harmonic_strength_db,
        stability_mean=stability_mean if has_voiced_evidence else None,
        # clipping_mean has the same defaulted-to-0.0 problem as the two above
        # (_mean_advanced_metric returns its default when no frame carries an
        # `advanced` payload), so it is gated identically. Inert today — with no
        # voiced evidence the strain guard already returns None — but leaving it
        # ungated would be the one input still contradicting "absence is absence".
        clipping_mean=clipping_mean if has_voiced_evidence else None,
        raw_samples=raw_samples,
        timeline=timeline,
        frame_size=frame_size,
    )
    # Vocalise proxies — all from series already in hand (see contracts.py for
    # the field contract and the constants block for tuning rationale).
    glide_smoothness = _glide_smoothness(all_frames)
    trill_rate_hz, trill_detected, trill_duration_ms = _trill_metrics(all_frames)
    hit_pitch_ceiling = _hit_pitch_ceiling(pitch_values)
    measurement_available = bool(voiced_frames and pitch_values)
    measurement_rejection_reasons: list[str] = []
    if not measurement_available:
        measurement_rejection_reasons.append("no_voiced_frames")
    if snr_db is not None and snr_db < 12.0:
        measurement_rejection_reasons.append("low_snr")
    if attempt_clipping_pct is not None and attempt_clipping_pct >= 0.02:
        measurement_rejection_reasons.append("sustained_clipping")
    hnr_voiced_coverage_pct = (
        len(hnr_values) / len(voiced_frames) if voiced_frames else 0.0
    )
    advanced_metrics = VoiceAttemptAdvancedMetrics(
        sampleCount=sample_count,
        voicedFramePct=round(float(voiced_frame_pct), 3),
        confidentFramePct=round(float(confident_frame_pct), 3),
        scoreConfidence=round(float(score_confidence), 3),
        measurementAvailable=measurement_available,
        measurementRejectionReasons=measurement_rejection_reasons,
        pitchValidFrameCount=len(pitch_values),
        hnrValidFrameCount=len(hnr_values),
        hnrVoicedCoveragePct=round(float(hnr_voiced_coverage_pct), 3),
        captureReliability=capture_reliability,
        noiseFloorDb=noise_floor_db,
        snrDb=snr_db,
        clippingPct=attempt_clipping_pct,
        meanLoudnessDb=round(float(mean_loudness_db), 2),
        peakLoudnessDb=round(float(peak_loudness_db), 2),
        loudnessRangeDb=round(float(peak_loudness_db - min_loudness_db), 2),
        medianPitchHz=round(float(median_pitch_hz), 2),
        pitchP10Hz=round(float(pitch_p10_hz), 2),
        pitchP90Hz=round(float(pitch_p90_hz), 2),
        pitchStdSt=round(float(_pitch_std_st(pitch_values)), 3),
        phraseStartPitchHz=round(float(phrase_start_pitch_hz), 2),
        phraseEndPitchHz=round(float(phrase_end_pitch_hz), 2),
        phraseEndDropHz=round(float(phrase_end_drop_hz), 2),
        pitchDriftSt=round(float(pitch_drift_st), 3),
        pitchTargetOccupancyPct=round(float(pitch_target_occupancy_pct), 1),
        phraseFinalDropSemitones=round(float(phrase_final_drop_st), 2),
        spectralCentroidMeanHz=spectral_centroid_mean_hz,
        spectralTiltMeanDbPerOct=spectral_tilt_mean_db_per_oct,
        harmonicRatioMean=harmonic_ratio_mean,
        stabilityMean=stability_mean,
        glideSmoothness=glide_smoothness,
        f2RangeHz=_f2_range_hz(f2_window_values),
        trillRateHz=trill_rate_hz,
        trillDetected=trill_detected,
        trillDurationMs=trill_duration_ms,
        hitPitchCeiling=hit_pitch_ceiling,
        analysisProfile=analysis_profile,
        formantLite=formant_lite_metrics,
        quality=quality_metrics,
    )

    similarity_score = target_quality
    metric_similarity = target_quality
    contour_similarity = 0.0
    if reference_analysis is not None:
        metric_similarity, contour_similarity = _reference_similarity_components(
            timeline=timeline,
            reference_analysis=reference_analysis,
            mean_pitch_hz=mean_pitch_hz,
            pitch_range_st=pitch_range_st,
            resonance_mean=resonance_mean,
            weight_mean=weight_mean,
            current_advanced_metrics=advanced_metrics,
        )
        similarity_score = _reference_similarity_score(
            metric_similarity=metric_similarity,
            contour_similarity=contour_similarity,
            target_quality=target_quality,
        )
        advanced_metrics.metricSimilarity = round(float(metric_similarity), 3)
        advanced_metrics.contourSimilarity = round(float(contour_similarity), 3)
    else:
        advanced_metrics.metricSimilarity = round(float(metric_similarity), 3)
        advanced_metrics.contourSimilarity = round(float(contour_similarity), 3)

    reliability_flags = _build_reliability_flags(
        frame_count=sample_count,
        voiced_frame_pct=voiced_frame_pct,
        confident_frame_pct=confident_frame_pct,
        score_confidence=score_confidence,
        mean_loudness_db=mean_loudness_db,
    )
    advanced_metrics.reliabilityFlags = reliability_flags

    return VoiceAttemptMetrics(
        meanPitchHz=round(float(mean_pitch_hz), 2),
        pitchRangeSt=round(float(pitch_range_st), 2),
        resonanceMean=round(float(resonance_mean), 3),
        weightMean=round(float(weight_mean), 3),
        targetHitPct=round(float(target_hit_pct), 3),
        similarityScore=round(float(similarity_score), 3),
        advanced=advanced_metrics,
    )


def _build_attempt_target(
    profile: VoiceTargetProfile,
    target_preset: str,
    reference_analysis: ReferenceAnalysisResponse | None,
    metrics: VoiceAttemptMetrics,
    target_voice_profile: VoiceTargetVoiceProfile | None = None,
) -> VoiceAttemptTarget:
    """Embed the active target bands (preset or reference-derived) and where the
    attempt sits relative to them, so coaching reasons about deltas-from-target
    rather than re-deriving a target it cannot see."""
    source = profile.source
    pitch_floor = profile.pitch_floor_hz
    pitch_ceiling = profile.pitch_ceiling_hz
    min_resonance = profile.min_resonance_mean
    max_weight = profile.max_weight_mean
    resonance_floor, resonance_ceiling, weight_floor, weight_ceiling = (
        _target_timbre_bands(profile)
    )
    min_range_st = profile.min_pitch_range_st
    f2_floor = None
    ref_mean_pitch = ref_resonance = ref_weight = ref_f2 = None

    if target_voice_profile is not None:
        pitch_floor = target_voice_profile.pitchFloorHz
        pitch_ceiling = target_voice_profile.pitchCeilingHz
        resonance_floor = target_voice_profile.resonanceFloor
        resonance_ceiling = target_voice_profile.resonanceCeiling
        weight_floor = target_voice_profile.weightFloor
        weight_ceiling = target_voice_profile.weightCeiling
        if (
            target_voice_profile.advancedBands is not None
            and target_voice_profile.advancedBands.formantLite is not None
        ):
            f2_floor = target_voice_profile.advancedBands.formantLite.f2FloorHz

    if reference_analysis is not None:
        # Carry the reference voice's own measured center alongside the exact
        # bands. The scoring profile has already selected direction-correct
        # endpoints; do not re-derive feminine-only threshold aliases here.
        ref_metrics = reference_analysis.metrics
        ref_mean_pitch = ref_metrics.meanPitchHz
        ref_resonance = ref_metrics.resonanceMean
        ref_weight = ref_metrics.weightMean
        if (
            ref_metrics.advanced is not None
            and ref_metrics.advanced.formantLite is not None
        ):
            ref_f2 = ref_metrics.advanced.formantLite.f2MedianHz

    mean_pitch = metrics.meanPitchHz
    if mean_pitch < pitch_floor:
        pitch_placement = "below"
        pitch_gap = round(float(mean_pitch - pitch_floor), 2)
    elif mean_pitch > pitch_ceiling:
        pitch_placement = "above"
        pitch_gap = round(float(mean_pitch - pitch_ceiling), 2)
    else:
        pitch_placement = "in_band"
        pitch_gap = 0.0

    # Signed distance from the nearest band edge, zero when in-band.
    # Resonance: negative=darker, positive=brighter. Weight uses the historical
    # inverse sign: positive=lighter, negative=heavier.
    if metrics.resonanceMean < resonance_floor:
        resonance_gap = round(float(metrics.resonanceMean - resonance_floor), 3)
    elif metrics.resonanceMean > resonance_ceiling:
        resonance_gap = round(float(metrics.resonanceMean - resonance_ceiling), 3)
    else:
        resonance_gap = 0.0
    if metrics.weightMean < weight_floor:
        weight_gap = round(float(weight_floor - metrics.weightMean), 3)
    elif metrics.weightMean > weight_ceiling:
        weight_gap = round(float(weight_ceiling - metrics.weightMean), 3)
    else:
        weight_gap = 0.0

    def _r(value: float | None, ndigits: int) -> float | None:
        return round(float(value), ndigits) if value is not None else None

    def _band_value(value: float, ndigits: int) -> float:
        # A supplied profile is already the validated scoring contract. Built-in
        # bands can contain binary float noise from derived tolerance arithmetic,
        # so retain their established canonical display precision.
        if target_voice_profile is not None:
            return float(value)
        return round(float(value), ndigits)

    return VoiceAttemptTarget(
        source=source,
        targetPreset=target_preset,
        targetProfileId=profile.profile_id,
        direction=profile.direction,
        pitchFloorHz=_band_value(pitch_floor, 2),
        pitchCeilingHz=_band_value(pitch_ceiling, 2),
        resonanceFloor=_band_value(resonance_floor, 3),
        resonanceCeiling=_band_value(resonance_ceiling, 3),
        weightFloor=_band_value(weight_floor, 3),
        weightCeiling=_band_value(weight_ceiling, 3),
        minTargetHitPct=_r(profile.min_target_hit_pct, 3),
        minSimilarityScore=_r(profile.min_similarity_score, 3),
        minResonance=_r(min_resonance, 3),
        maxWeight=_r(max_weight, 3),
        minPitchRangeSt=_r(min_range_st, 2),
        f2FloorHz=_r(f2_floor, 2),
        referenceMeanPitchHz=_r(ref_mean_pitch, 2),
        referenceResonanceMean=_r(ref_resonance, 3),
        referenceWeightMean=_r(ref_weight, 3),
        referenceF2MedianHz=_r(ref_f2, 2),
        pitchPlacement=pitch_placement,
        pitchGapHz=pitch_gap,
        resonanceGap=resonance_gap,
        weightGap=weight_gap,
    )


def build_attempt_summary(
    voice_session_id: str,
    target_preset: str,
    timeline: list[VoiceFrame],
    duration_ms: int,
    reference_analysis: ReferenceAnalysisResponse | None = None,
    raw_samples: np.ndarray | None = None,
    sample_rate: int = SAMPLE_RATE,
    analysis_profile: str = ANALYSIS_PROFILE_STANDARD,
    target_voice_profile: VoiceTargetVoiceProfile | None = None,
    target_source: str | None = None,
) -> VoiceAttemptSummary:
    resolved_target_voice_profile = target_voice_profile
    resolved_target_source = str(target_source or "").strip() or None
    if resolved_target_voice_profile is None and reference_analysis is not None:
        resolved_target_voice_profile = build_target_voice_profile(
            reference_analysis,
            target_preset,
        )
        resolved_target_source = resolved_target_source or "reference"
    if resolved_target_voice_profile is not None:
        resolved_target_source = resolved_target_source or "custom"
    profile = _resolve_target_profile(
        target_preset,
        resolved_target_voice_profile,
        source=resolved_target_source,
    )
    analysis_profile = normalize_analysis_profile(analysis_profile)
    # Voice-copy parity: the reference voice is analyzed at the fine ~100 fps
    # ANALYSIS resolution (see reference_analyzer), while the live attempt
    # timeline is the coarse ~16 fps stream. Re-analyze the finalized attempt
    # from the retained raw PCM at the SAME resolution the reference used, so
    # "match the reference" compares like with like (pitch percentiles, contour,
    # jitter/shimmer region striding). Fall back to the live timeline when no
    # audio was retained (e.g. consent off).
    analysis_timeline = timeline
    metrics_frame_size = LIVE_FRAME_SIZE
    if raw_samples is not None and np.asarray(raw_samples).reshape(-1).size >= ANALYSIS_FRAME_SIZE:
        analysis_timeline = build_timeline_from_samples(
            raw_samples,
            target_preset,
            sample_rate,
            ANALYSIS_FRAME_SIZE,
            ANALYSIS_HOP_SIZE,
            analysis_profile=analysis_profile,
            target_voice_profile=resolved_target_voice_profile,
            target_source=resolved_target_source,
        )
        metrics_frame_size = ANALYSIS_HOP_SIZE
    metrics = build_attempt_metrics(
        timeline=analysis_timeline,
        target_preset=target_preset,
        reference_analysis=reference_analysis,
        raw_samples=raw_samples,
        sample_rate=sample_rate,
        frame_size=metrics_frame_size,
        analysis_profile=analysis_profile,
        target_voice_profile=resolved_target_voice_profile,
        target_source=resolved_target_source,
    )
    advanced = metrics.advanced

    issues: list[str] = []
    next_drills: list[str] = []
    stable_frames = [
        frame for frame in analysis_timeline if frame.voiced and frame.confidence >= 0.20
    ]
    capture_rejections = set(
        (advanced.measurementRejectionReasons if advanced is not None else []) or []
    )

    if not stable_frames:
        issues.append(
            "No stable voiced audio was detected; use a closer mic and start with a steady vowel."
        )
        next_drills.append(
            'Hold a comfortable "mm" and keep the graph dot present for the whole sound'
        )
    elif capture_rejections:
        if "sustained_clipping" in capture_rejections:
            issues.append(
                "The microphone clipped for too much of this take, so the fine voice-quality measurements are not trustworthy."
            )
            next_drills.append(
                "Move slightly farther from the microphone or lower its input level before the next capture"
            )
        if "low_snr" in capture_rejections:
            issues.append(
                "Background noise masked the fine voice-quality measurements in this take."
            )
            next_drills.append(
                "Use a quieter capture or move closer to the microphone while keeping the sound comfortable"
            )
    else:
        messages = _coaching_messages(profile)
        if metrics.meanPitchHz < profile.pitch_floor_hz:
            issue, drill = messages["pitch_low"]
            issues.append(issue)
            next_drills.append(drill)
        elif metrics.meanPitchHz > profile.pitch_ceiling_hz + 18.0:
            issue, drill = messages["pitch_high"]
            issues.append(issue)
            next_drills.append(drill)

        resonance_message = _timbre_band_coaching_message(
            "resonance", metrics.resonanceMean, profile
        )
        if resonance_message is not None:
            issue, drill = resonance_message
            issues.append(issue)
            next_drills.append(drill)

        weight_message = _timbre_band_coaching_message(
            "weight", metrics.weightMean, profile
        )
        if weight_message is not None:
            issue, drill = weight_message
            issues.append(issue)
            next_drills.append(drill)

        if metrics.pitchRangeSt < profile.min_pitch_range_st:
            issue, drill = messages["range"]
            issues.append(issue)
            next_drills.append(drill)

        if (
            reference_analysis is not None
            and metrics.similarityScore < profile.min_similarity_score
        ):
            issues.append(
                "Reference match still drifts; shadow the sample in shorter chunks before full phrases."
            )
            next_drills.append("pause-and-echo the reference one phrase at a time")

        if (
            advanced is not None
            and advanced.pitchP10Hz is not None
            and advanced.pitchP10Hz < profile.pitch_floor_hz - 10.0
        ):
            issues.append(
                "The pitch floor still slips below the selected band between syllables; keep the low end inside the target through the phrase."
            )
            next_drills.append(
                "short phrase loops that keep every syllable inside the selected pitch band"
            )

        if (
            advanced is not None
            and advanced.phraseEndDropHz is not None
            and advanced.phraseEndDropHz > 16.0
        ):
            issues.append(
                "Phrase endings are dropping out of the target space; keep the final word suspended instead of letting it fall."
            )
            next_drills.append("question-style ending holds on the final stressed word")

        if (
            advanced is not None
            and advanced.stabilityMean is not None
            and advanced.stabilityMean < 0.52
        ):
            issues.append(
                "The sound is still wobbling between placements; simplify the phrase and keep one stable target shape."
            )
            next_drills.append(
                "2-word mimic loops with a steady onset and one consistent placement"
            )

        reference_formant = (
            reference_analysis.metrics.advanced.formantLite
            if reference_analysis and reference_analysis.metrics.advanced is not None
            else None
        )
        current_formant = advanced.formantLite if advanced is not None else None
        if (
            current_formant is not None
            and reference_formant is not None
            and current_formant.frontnessScore is not None
            and reference_formant.frontnessScore is not None
            and current_formant.frontnessScore
            < (reference_formant.frontnessScore - 0.10)
        ):
            issues.append(
                "Vowel frontness is backing away from the reference; shape your mouth a little closer to the sample."
            )
            next_drills.append(
                "ee-to-ih mimic loops that match the reference's mouth shape without extra force"
            )

        current_quality = advanced.quality if advanced is not None else None
        if (
            current_quality is not None
            and current_quality.breathyRisk is not None
            and current_quality.breathyRisk > 0.58
        ):
            issues.append(
                "The sound is turning airy; keep the onset soft, but let the tone stay clean and present."
            )
            next_drills.append(
                "soft-to-clean onset resets that keep the tone present without leaking extra air"
            )

        if (
            current_quality is not None
            and current_quality.strainRisk is not None
            and current_quality.strainRisk > 0.52
        ):
            issues.append(
                "The sound is getting squeezed; keep the target placement, but back off pressure in the throat and jaw."
            )
            next_drills.append(
                "tiny target-shape phrases on easy airflow with a relaxed jaw and neck"
            )

        if advanced is not None and advanced.reliabilityFlags:
            if "low_voiced_coverage" in advanced.reliabilityFlags:
                issues.append(
                    "Parts of the take never settled into a voiced tone, so the analysis only trusts part of the phrase."
                )
            if "quiet_input" in advanced.reliabilityFlags:
                issues.append(
                    "Input level stayed quiet, which makes the fine-grain feedback less reliable."
                )

    if not issues:
        issues.append(_coaching_issue_line(profile, "holding"))
    if not next_drills:
        next_drills.append(
            "alternate relaxed statements and questions on the same line set"
        )

    return VoiceAttemptSummary(
        voiceSessionId=voice_session_id,
        durationMs=duration_ms,
        targetPreset=target_preset,
        target=_build_attempt_target(
            profile=profile,
            target_preset=target_preset,
            reference_analysis=reference_analysis,
            metrics=metrics,
            target_voice_profile=resolved_target_voice_profile,
        ),
        metrics=metrics,
        issues=issues,
        nextDrills=next_drills,
    )


def _build_profile_id(clip_id: str, target_preset: str) -> str:
    raw = f"{clip_id}-{target_preset}".lower()
    return re.sub(r"[^a-z0-9_-]+", "-", raw).strip("-") or clip_id


def _describe_pitch_register(mean_pitch_hz: float) -> str:
    if mean_pitch_hz >= 245.0:
        return "very high-set and youthful"
    if mean_pitch_hz >= 220.0:
        return "high-set and youthful"
    if mean_pitch_hz >= 195.0:
        return "mid-high and lifted"
    return "lower-set and grounded"


def _describe_resonance(resonance_mean: float) -> str:
    if resonance_mean >= 0.72:
        return "very bright, forward resonance"
    if resonance_mean >= 0.58:
        return "bright, forward resonance"
    if resonance_mean >= 0.46:
        return "balanced forward resonance"
    return "warmer, darker resonance"


def _describe_weight(weight_mean: float) -> str:
    if weight_mean <= 0.34:
        return "very light vocal weight"
    if weight_mean <= 0.48:
        return "light vocal weight"
    if weight_mean <= 0.62:
        return "medium vocal weight"
    return "fuller vocal weight"


def _describe_intonation(pitch_range_st: float) -> str:
    if pitch_range_st >= 5.0:
        return "highly melodic"
    if pitch_range_st >= 3.4:
        return "playful and mobile"
    if pitch_range_st >= 2.3:
        return "steady with some lift"
    return "fairly level"


def _quality_bands_from_advanced(
    advanced_metrics: VoiceAttemptAdvancedMetrics,
) -> VoiceTargetQualityBands:
    """Derive the target's quality bands from a reference's quality metrics.

    A metric that could not be MEASURED yields NO band. The old code used
    ``(x or 0.0)`` here, which manufactured a 4.0 dB CPPS floor, a -2.0 dB HNR
    floor and a 0.10 risk ceiling — the tightest possible targets — out of
    nulls, so a reference that was never successfully analyzed produced the
    strictest goal in the app. VoiceTargetQualityBands allows None for every
    field and every consumer already guards on it.
    """
    quality = advanced_metrics.quality
    return VoiceTargetQualityBands(
        cppsLikeFloor=(
            round(float(max(4.0, float(quality.cppsLike) - 2.2)), 2)
            if quality is not None and quality.cppsLike is not None
            else None
        ),
        harmonicStrengthFloor=(
            round(float(max(-2.0, float(quality.harmonicStrength) - 3.0)), 2)
            if quality is not None and quality.harmonicStrength is not None
            else None
        ),
        breathyRiskCeiling=(
            round(float(min(0.82, float(quality.breathyRisk) + 0.10)), 3)
            if quality is not None and quality.breathyRisk is not None
            else None
        ),
        strainRiskCeiling=(
            round(float(min(0.72, float(quality.strainRisk) + 0.10)), 3)
            if quality is not None and quality.strainRisk is not None
            else None
        ),
    )


def build_target_voice_profile(
    reference_analysis: ReferenceAnalysisResponse,
    target_preset: str | None = None,
) -> VoiceTargetVoiceProfile:
    if reference_analysis.analysisVersion != VOICE_ANALYSIS_VERSION:
        raise ValueError(
            "Reference audio uses an older or unknown acoustic calibration; "
            "re-analyze the retained audio before deriving a voice target."
        )
    resolved_preset = normalize_target_preset(
        target_preset or reference_analysis.targetPreset
    )
    timeline = reference_analysis.timeline or []
    frames = _analysis_frames(timeline)
    pitch_values = [
        frame.pitchHz for frame in frames if frame.voiced and frame.pitchHz > 0.0
    ]
    resonance_values = [frame.resonanceScore for frame in frames]
    weight_values = [frame.weightScore for frame in frames]

    # A reference analysis may still carry finite compatibility metrics when the
    # analyzer found no trustworthy voice. Those values are presentation
    # fallbacks, not evidence from which an exact voice target can be derived.
    # Reject centrally so profile creation, API calls, and saved reference
    # presets cannot take different paths around the same quality decision.
    reference_advanced = reference_analysis.metrics.advanced
    reference_rejections = set(
        (reference_advanced.measurementRejectionReasons if reference_advanced else [])
        or []
    )
    reference_flags = set(
        (reference_advanced.reliabilityFlags if reference_advanced else []) or []
    )
    quality_verdict = str(
        reference_analysis.quality.verdict if reference_analysis.quality else ""
    ).strip().lower()
    if (
        quality_verdict == "reject"
        or (reference_advanced is not None and reference_advanced.measurementAvailable is False)
        or "no_voiced_frames" in reference_rejections
        or "no_voiced_frames" in reference_flags
        or not pitch_values
    ):
        raise ValueError(
            "Reference audio is not reliable enough to derive a voice target."
        )

    metrics = (
        reference_analysis.metrics
        if reference_analysis.targetPreset == resolved_preset
        else build_attempt_metrics(timeline, resolved_preset)
    )
    if metrics.advanced is not None and reference_analysis.metrics.advanced is not None:
        if metrics.advanced.formantLite is None:
            metrics.advanced.formantLite = (
                reference_analysis.metrics.advanced.formantLite
            )
        if metrics.advanced.quality is None:
            metrics.advanced.quality = reference_analysis.metrics.advanced.quality
    advanced_metrics = metrics.advanced
    mean_pitch_hz = float(metrics.meanPitchHz)
    pitch_range_st = float(metrics.pitchRangeSt)
    resonance_mean = float(metrics.resonanceMean)
    weight_mean = float(metrics.weightMean)

    pitch_spread = max(10.0, pitch_range_st * 2.4)
    pitch_floor_hz = max(
        MIN_PITCH_HZ,
        _percentile(pitch_values, 18.0, mean_pitch_hz - pitch_spread),
    )
    pitch_ceiling_hz = min(
        MAX_PITCH_HZ,
        _percentile(pitch_values, 82.0, mean_pitch_hz + pitch_spread),
    )
    if (pitch_ceiling_hz - pitch_floor_hz) < 18.0:
        midpoint = (pitch_floor_hz + pitch_ceiling_hz) / 2.0
        pitch_floor_hz = max(MIN_PITCH_HZ, midpoint - 9.0)
        pitch_ceiling_hz = min(MAX_PITCH_HZ, midpoint + 9.0)

    resonance_floor = clamp(_percentile(resonance_values, 18.0, resonance_mean - 0.08))
    resonance_ceiling = clamp(
        _percentile(resonance_values, 82.0, resonance_mean + 0.08)
    )
    if (resonance_ceiling - resonance_floor) < 0.08:
        center = (resonance_floor + resonance_ceiling) / 2.0
        resonance_floor = clamp(center - 0.04)
        resonance_ceiling = clamp(center + 0.04)

    weight_floor = clamp(_percentile(weight_values, 18.0, weight_mean - 0.06))
    weight_ceiling = clamp(_percentile(weight_values, 82.0, weight_mean + 0.06))
    if (weight_ceiling - weight_floor) < 0.08:
        center = (weight_floor + weight_ceiling) / 2.0
        weight_floor = clamp(center - 0.04)
        weight_ceiling = clamp(center + 0.04)

    style_prompt = (
        f"{_describe_pitch_register(mean_pitch_hz)}, "
        f"{_describe_resonance(resonance_mean)}, "
        f"{_describe_weight(weight_mean)}, "
        f"with {_describe_intonation(pitch_range_st)} intonation"
    )

    notes = [
        f"Pitch center sits around {round(mean_pitch_hz)} Hz, usually working between {round(pitch_floor_hz)} and {round(pitch_ceiling_hz)} Hz.",
        f"Resonance clusters around {round(resonance_mean * 100)}%, so the graph should live in a {round(resonance_floor * 100)}–{round(resonance_ceiling * 100)}% resonance band.",
        f"Weight stays near {round(weight_mean * 100)}%, with the most target-like passes landing in a {round(weight_floor * 100)}–{round(weight_ceiling * 100)}% band.",
    ]
    advanced_bands = None
    if advanced_metrics is not None:
        formant_bands = None
        quality_bands = None
        if (
            advanced_metrics.formantLite is not None
            and advanced_metrics.formantLite.f2MedianHz is not None
        ):
            formant_bands = VoiceTargetFormantLiteBands(
                f2FloorHz=round(
                    float(max(1100.0, advanced_metrics.formantLite.f2MedianHz - 180.0)),
                    2,
                ),
                frontnessFloor=round(
                    float(
                        max(
                            0.32,
                            (advanced_metrics.formantLite.frontnessScore or 0.0) - 0.08,
                        )
                    ),
                    3,
                ),
            )
        if advanced_metrics.quality is not None:
            quality_bands = _quality_bands_from_advanced(advanced_metrics)
        advanced_bands = VoiceTargetAdvancedBands(
            pitchP10HzFloor=round(
                float(
                    max(
                        MIN_PITCH_HZ,
                        (advanced_metrics.pitchP10Hz or pitch_floor_hz) - 4.0,
                    )
                ),
                2,
            ),
            pitchP90HzCeiling=round(
                float(
                    min(
                        MAX_PITCH_HZ,
                        (advanced_metrics.pitchP90Hz or pitch_ceiling_hz) + 4.0,
                    )
                ),
                2,
            ),
            pitchStdStCeiling=round(
                float(max(1.2, (advanced_metrics.pitchStdSt or 0.0) + 0.4)), 3
            ),
            phraseEndDropHzCeiling=round(
                float(max(8.0, (advanced_metrics.phraseEndDropHz or 0.0) + 6.0)), 2
            ),
            spectralCentroidFloorHz=round(
                float(
                    max(700.0, (advanced_metrics.spectralCentroidMeanHz or 0.0) - 140.0)
                ),
                2,
            ),
            spectralTiltFloorDbPerOct=round(
                float((advanced_metrics.spectralTiltMeanDbPerOct or 0.0) - 1.0), 3
            ),
            harmonicRatioFloor=round(
                float(max(0.2, (advanced_metrics.harmonicRatioMean or 0.0) - 0.08)), 3
            ),
            stabilityFloor=round(
                float(max(0.35, (advanced_metrics.stabilityMean or 0.0) - 0.10)), 3
            ),
            voicedFramePctFloor=round(
                float(max(0.45, (advanced_metrics.voicedFramePct or 0.0) * 0.9)), 3
            ),
            formantLite=formant_bands,
            quality=quality_bands,
        )
        notes.append(
            f"Advanced target keeps the lower pitch floor near {round(advanced_bands.pitchP10HzFloor or pitch_floor_hz)} Hz and aims to limit phrase-end drop to about {round(advanced_bands.phraseEndDropHzCeiling or 0)} Hz."
        )
        if formant_bands is not None and formant_bands.f2FloorHz is not None:
            notes.append(
                f"Reference matching keeps F2 above about {round(formant_bands.f2FloorHz)} Hz and asks frontness to stay close to the source voice."
            )
        if quality_bands is not None:
            notes.append(
                "Voice quality target wants a clean, easy tone: enough harmonic presence, not too airy, and not squeezed."
            )
    if reference_analysis.durationMs < 4000:
        notes.append(
            "This source clip is short; a longer sample will give the target voice model steadier phrase forecasts."
        )
    # Robustness guard: a reference with too little trustworthy voiced audio
    # yields percentile bands that fall back to single-value defaults, so the
    # derived target is unreliable. Surface that rather than presenting an
    # approximate target as if it were solid. (~40 frames at 100 fps ~= 0.4s of
    # voiced audio; also honour the analyzer's own low-coverage flag.)
    reference_flags = (
        advanced_metrics.reliabilityFlags if advanced_metrics is not None else []
    ) or []
    if len(pitch_values) < 40 or "low_voiced_coverage" in reference_flags:
        notes.append(
            "Only a little clearly-voiced audio was found in this clip, so the "
            "target bands are approximate — record a longer, steadily-voiced "
            "sample for a more reliable voice-match target."
        )

    return VoiceTargetVoiceProfile(
        profileId=_build_profile_id(reference_analysis.clipId, resolved_preset),
        clipId=reference_analysis.clipId,
        sourceFilename=reference_analysis.filename,
        durationMs=reference_analysis.durationMs,
        targetPreset=resolved_preset,
        metrics=metrics,
        pitchFloorHz=round(float(pitch_floor_hz), 2),
        pitchCeilingHz=round(float(pitch_ceiling_hz), 2),
        resonanceFloor=round(float(resonance_floor), 3),
        resonanceCeiling=round(float(resonance_ceiling), 3),
        weightFloor=round(float(weight_floor), 3),
        weightCeiling=round(float(weight_ceiling), 3),
        stylePrompt=style_prompt,
        notes=notes,
        advancedBands=advanced_bands,
        analysisVersion=VOICE_ANALYSIS_VERSION,
    )


def _is_word_token(token: str) -> bool:
    return any(char.isalpha() for char in token)


def _estimate_syllables(word: str) -> int:
    normalized = re.sub(r"[^a-z']", "", word.lower())
    if not normalized:
        return 1

    groups = re.findall(r"[aeiouy]+", normalized)
    count = len(groups)
    if normalized.endswith("e") and count > 1 and not normalized.endswith(("le", "ye")):
        count -= 1
    return max(1, count)


def _stress_index(syllable_count: int) -> int:
    if syllable_count <= 1:
        return 0
    if syllable_count == 2:
        return 0
    return syllable_count // 2


def _phrase_shape(phrase: str) -> str:
    stripped = phrase.strip()
    if stripped.endswith("?"):
        return "question"
    if stripped.endswith("!"):
        return "exclamation"
    return "statement"


def _phrase_curve(progress: float, phrase_shape: str, melodic_range_st: float) -> float:
    progress = clamp(progress)
    if phrase_shape == "question":
        contour = -0.16 + (0.40 * math.sin(math.pi * progress)) + (0.72 * (progress**2))
    elif phrase_shape == "exclamation":
        contour = (
            0.12
            + (0.52 * math.sin(math.pi * min(1.0, progress * 1.08)))
            + (0.20 * progress)
        )
    else:
        contour = (
            (0.30 * math.sin(math.pi * (progress + 0.08)))
            - (0.34 * progress)
            + (0.14 * max(0.0, progress - 0.72))
        )
    return melodic_range_st * contour


def build_phrase_forecast(
    target_profile: VoiceTargetVoiceProfile,
    phrase: str,
) -> VoicePhraseForecastResponse:
    clean_phrase = " ".join(str(phrase or "").split())
    if not clean_phrase:
        raise ValueError("A phrase is required to build a target path forecast")

    tokens = re.findall(r"[A-Za-z']+|[!?.,;:]", clean_phrase)
    word_tokens = [token for token in tokens if _is_word_token(token)]
    if not word_tokens:
        raise ValueError("The phrase needs at least one speakable word")

    total_syllables = sum(_estimate_syllables(word) for word in word_tokens)
    if total_syllables <= 0:
        raise ValueError("Could not estimate any syllables from the phrase")

    phrase_shape = _phrase_shape(clean_phrase)
    # Validate before resolving. 2026-07-27 (round 4): get_target_profile now
    # routes through normalize_target_preset itself, so this call is redundant
    # rather than load-bearing — it is kept as an explicit boundary check at the
    # route edge, and because it is idempotent for every live preset. (The
    # earlier note here said get_target_profile "falls back to cute-feminine for
    # an unknown preset"; that was true when written and is no longer.) Either
    # way a retired target raises ValueError, which /target/forecast maps to 400.
    # NOTE this is the module's SECOND direct caller of get_target_profile — the
    # other is _resolve_target_profile. (Round 5 correction: the get_target_profile
    # docstring used to call _resolve_target_profile the sole in-module consumer.)
    profile_target = get_target_profile(normalize_target_preset(target_profile.targetPreset))
    mean_pitch_hz = clamp(
        float(target_profile.metrics.meanPitchHz), MIN_PITCH_HZ, MAX_PITCH_HZ
    )
    melodic_range_st = clamp(float(target_profile.metrics.pitchRangeSt), 1.8, 6.0)
    resonance_center = clamp(float(target_profile.metrics.resonanceMean))
    weight_center = clamp(float(target_profile.metrics.weightMean))
    base_syllable_ms = int(round(165.0 + max(0.0, 4.2 - melodic_range_st) * 18.0))

    timeline: list[VoiceFrame] = []
    syllable_index = 0
    time_ms = 0

    for token in tokens:
        if _is_word_token(token):
            syllable_count = _estimate_syllables(token)
            stress_idx = _stress_index(syllable_count)
            for local_index in range(syllable_count):
                progress = (
                    0.5
                    if total_syllables == 1
                    else (syllable_index / max(total_syllables - 1, 1))
                )
                stress = (
                    1.0
                    if local_index == stress_idx
                    else (
                        0.45
                        if abs(local_index - stress_idx) == 1 and syllable_count > 2
                        else 0.15
                    )
                )
                local_wave = math.sin(math.pi * progress)
                pitch_offset_st = _phrase_curve(
                    progress, phrase_shape, melodic_range_st
                ) + ((0.24 * melodic_range_st) * stress)
                pitch_hz = float(
                    clamp(
                        mean_pitch_hz * (2.0 ** (pitch_offset_st / 12.0)),
                        MIN_PITCH_HZ,
                        MAX_PITCH_HZ,
                    )
                )
                resonance_score = clamp(
                    resonance_center
                    + (0.05 * local_wave)
                    + (0.08 * stress)
                    + (0.05 if phrase_shape == "question" and progress >= 0.70 else 0.0)
                )
                weight_score = clamp(
                    weight_center
                    - (0.08 * stress)
                    - (0.05 * resonance_score)
                    + (0.03 if phrase_shape == "statement" and progress < 0.28 else 0.0)
                )
                confidence = clamp(
                    0.76 + (0.14 * stress) + (0.04 * local_wave), 0.62, 0.96
                )
                loudness_db = -27.0 + (confidence * 8.0)
                pitch_score = _band_similarity(
                    pitch_hz,
                    profile_target.pitch_floor_hz,
                    profile_target.pitch_ceiling_hz,
                )

                timeline.append(
                    VoiceFrame(
                        t=int(time_ms),
                        voiced=True,
                        pitchHz=round(pitch_hz, 2),
                        pitchScore=round(float(pitch_score), 3),
                        resonanceScore=round(float(resonance_score), 3),
                        weightScore=round(float(weight_score), 3),
                        confidence=round(float(confidence), 3),
                        loudnessDb=round(float(loudness_db), 2),
                    )
                )
                syllable_index += 1
                time_ms += int(
                    round(base_syllable_ms * (1.0 + (0.06 * min(len(token), 8) / 8.0)))
                )
        else:
            pause_ms = (
                110
                if token in {",", ";", ":"}
                else 150
                if token == "."
                else 180
                if token in {"?", "!"}
                else 0
            )
            if pause_ms > 0:
                timeline.append(
                    VoiceFrame(
                        t=int(time_ms),
                        voiced=False,
                        pitchHz=0.0,
                        pitchScore=0.0,
                        resonanceScore=round(float(resonance_center), 3),
                        weightScore=round(float(weight_center), 3),
                        confidence=0.18,
                        loudnessDb=-60.0,
                    )
                )
                time_ms += pause_ms

    if not timeline:
        raise ValueError(
            "The phrase forecast could not be generated from the provided phrase"
        )

    metrics = build_attempt_metrics(timeline, target_profile.targetPreset)
    if metrics.advanced is not None and target_profile.metrics.advanced is not None:
        if metrics.advanced.formantLite is None:
            metrics.advanced.formantLite = target_profile.metrics.advanced.formantLite
        if metrics.advanced.quality is None:
            metrics.advanced.quality = target_profile.metrics.advanced.quality
    contour_label = {
        "question": "lifted ending",
        "exclamation": "sparkly rise",
        "statement": "buoyant statement arc",
    }[phrase_shape]
    summary = f'Projected a {contour_label} for "{clean_phrase}" using {Path(target_profile.sourceFilename).stem or "the target voice"}'
    notes = [
        f"Style cue: {target_profile.stylePrompt}.",
        f"Pitch path stays mostly in a {round(target_profile.pitchFloorHz)}–{round(target_profile.pitchCeilingHz)} Hz lane while aiming for {contour_label}.",
    ]
    if total_syllables <= 3:
        notes.append(
            "Short phrases give a compact contour; longer prompts will show more of the target voice’s melodic habits."
        )
    else:
        notes.append(
            f"This phrase spans about {total_syllables} syllables, so the path should show multiple pitch pivots across the graph."
        )

    return VoicePhraseForecastResponse(
        profileId=target_profile.profileId,
        clipId=target_profile.clipId,
        phrase=clean_phrase,
        targetPreset=target_profile.targetPreset,
        estimatedDurationMs=int(time_ms),
        metrics=metrics,
        timeline=timeline,
        summary=summary,
        notes=notes,
    )
