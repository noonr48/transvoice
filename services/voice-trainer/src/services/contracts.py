from __future__ import annotations

import math
from typing import Any

from pydantic import BaseModel, Field, model_validator


# Bumped 2026-07-26 for the formant-lite selection repair (standard pole
# bandwidth + prominence-ranked pole selection). F2 -- and therefore resonance,
# frontnessScore, frontnessShift and the bands DERIVED FROM A REFERENCE
# ANALYSIS -- now MEANS something different: on front vowels F2 was reading
# ~70% low. A reference analysed under v3 compared against a v4 live take would
# produce a large delta that is pure instrumentation change, not learner
# behaviour.
#
# Moving this constant is the designed lever for exactly that:
# build_target_voice_profile hard-rejects a version mismatch, and
# streaming_analyzer's calibration self-heal then rebuilds the stored analysis
# in place from the retained raw audio (reference_analyzer.reanalyze_stored).
#
# Two limits on that claim, both deliberate:
#  - The self-heal needs the retained raw audio. reanalyze_stored returns None
#    when the raw file is gone, and the original rejection then stands, so such
#    a clip IS stranded and must be re-recorded. That is the correct failure --
#    a broken self-heal must never widen an existing gate.
#  - It covers REFERENCE clips at session start. It does not touch the built-in
#    TARGET_PROFILES resonance/weight bands in audio_analysis.py, which are
#    hand-authored constants rather than derived measurements and bypass the
#    version gate entirely; nor stored take artifacts, which dataset_exporter
#    excludes as 'unsupported_analysis_version' until re-analysed. Excluding
#    them is intended: a training export must not mix v3 and v4 measurements.
VOICE_ANALYSIS_VERSION = "voice-metrics-v4-formants"
VOICE_TARGET_PITCH_MIN_HZ = 80.0
VOICE_TARGET_PITCH_MAX_HZ = 400.0


def _validate_target_band_order(
    floor_name: str,
    floor_value: float | None,
    ceiling_name: str,
    ceiling_value: float | None,
) -> None:
    if floor_value is None or ceiling_value is None:
        return
    if floor_value >= ceiling_value:
        raise ValueError(
            f"{floor_name} must be lower than {ceiling_name}; "
            f"received {floor_value} and {ceiling_value}"
        )


def sanitize_non_finite(value: Any) -> Any:
    """Recursively replace NaN/Inf floats with None.

    The DSP harness produces floats from divisions, logs and log2 calls that can
    yield NaN/Inf on degenerate input (silence, empty frames, a 1-sample period).
    Python's json.dumps writes those as bare ``NaN``/``Infinity`` tokens — valid
    to Python's own reader but invalid JSON that breaks strict parsers and the
    training-data loaders the exported dataset feeds. Sanitize at every write
    boundary so neither the live signal nor the SFT export can be poisoned."""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: sanitize_non_finite(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_non_finite(item) for item in value]
    return value


class VoiceRepContext(BaseModel):
    lessonId: str | None = None
    drillId: str | None = None
    kind: str | None = None
    drill: dict[str, Any] | None = None
    promptId: str | None = None
    prompt: str | None = None
    phrase: str | None = None
    targetPreset: str | None = None
    targetSource: str | None = None
    activeLine: dict[str, Any] | None = None
    referenceClipId: str | None = None
    referenceClipName: str | None = None
    forecastPhrase: str | None = None
    targetProfileId: str | None = None
    targetProfileSource: str | None = None
    repIndex: int | None = None
    takeIndex: int | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None


class VoiceSelfReport(BaseModel):
    perceivedDifficulty: int | None = Field(default=None, ge=1, le=5)
    effort: int | None = Field(default=None, ge=1, le=5)
    confidence: int | None = Field(default=None, ge=1, le=5)
    strain: int | None = Field(default=None, ge=1, le=5)
    fatigue: int | None = Field(default=None, ge=1, le=5)
    # Explicit learner-reported safety symptoms. These are deliberately
    # separate from acoustic strain-risk proxies: self-report is the
    # authoritative evidence when deciding whether target chasing should stop.
    pain: bool | None = Field(default=None, strict=True)
    throatPain: bool | None = Field(default=None, strict=True)
    discomfort: int | None = Field(default=None, ge=1, le=5)
    notes: str | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None


class VoiceSessionStartRequest(BaseModel):
    sloaneSessionId: str
    targetPreset: str = "cute-feminine"
    referenceClipId: str | None = None
    # Full saved target profile (handmade or reference-derived). Kept as a raw
    # request object here because VoiceTargetProfile is declared later in this
    # module; StreamingAnalyzer validates it into that model before persistence.
    targetVoiceProfile: dict[str, Any] | None = None
    targetSource: str | None = None
    lessonId: str | None = None
    memoryEnabled: bool = True


class VoiceSessionEndRequest(BaseModel):
    reason: str = "manual end"
    sloaneSessionId: str | None = None
    referenceClipId: str | None = None
    clientAttemptId: str | None = None
    repContext: VoiceRepContext | None = None
    selfReport: VoiceSelfReport | None = None
    # LPC gate (2026-07-19): 'standard' (default — behavior identical to before
    # this field existed) or 'no_formants' (skip the per-frame LPC formant solve
    # and the offline formant-lite pass; formant-derived fields come back null).
    # Additive: older callers that omit it get 'standard'. Unknown values are
    # normalized to 'standard' rather than rejected.
    analysisProfile: str = "standard"


class VoiceTakeOneShotRequest(VoiceSessionEndRequest):
    """A whole take handed over in ONE request instead of streamed frame by frame.

    Same finalize semantics as VoiceSessionEndRequest (which the streamed
    `/take` route already takes) plus the audio itself, so the two paths share
    one request vocabulary and one scoring path.

    `pcm16Base64` is base64-encoded 16 kHz mono PCM16 little-endian — byte for
    byte what the WebSocket stream carries.

    `takeKind` is the caller's short label for what the learner was doing
    ('hum_sovt', 'siren', 'phrase', …). It is folded into `repContext.kind`
    when the caller did not supply a fuller rep context, so the persisted
    artifact carries take-kind exactly where a streamed take carries it.
    """

    pcm16Base64: str
    takeKind: str | None = None
    reason: str = "coach one-shot take"


class VoiceFrameAdvancedMetrics(BaseModel):
    pitchConfidence: float | None = None
    voicedProbability: float | None = None
    rms: float | None = None
    spectralCentroidHz: float | None = None
    spectralBandwidthHz: float | None = None
    spectralFlux: float | None = None
    spectralTiltDbPerOct: float | None = None
    harmonicRatio: float | None = None
    harmonicNoiseRatioDb: float | None = None
    clippingPct: float | None = None
    pitchSlopeStPerSec: float | None = None
    stabilityScore: float | None = None


class VoiceFrame(BaseModel):
    t: int
    voiced: bool
    pitchHz: float
    pitchScore: float
    resonanceScore: float
    weightScore: float
    confidence: float
    loudnessDb: float
    advanced: VoiceFrameAdvancedMetrics | None = None
    analysisVersion: str | None = VOICE_ANALYSIS_VERSION


class VoiceAttemptFormantLiteMetrics(BaseModel):
    f1MedianHz: float | None = None
    f2MedianHz: float | None = None
    frontnessScore: float | None = None
    frontnessShift: float | None = None
    # Descriptive estimator evidence only. These fields do NOT assert that LPC
    # formants are validated for learner-facing coaching; they make later
    # validation/calibration possible without pretending a successful solve is
    # equivalent to a trustworthy instructional measurement.
    analysisWindowCount: int | None = None
    validWindowCount: int | None = None
    validWindowPct: float | None = None
    f2P10Hz: float | None = None
    f2P90Hz: float | None = None
    f2IqrHz: float | None = None
    f2MadHz: float | None = None
    medianWindowPitchHz: float | None = None
    maxWindowPitchHz: float | None = None


class VoiceAttemptQualityMetrics(BaseModel):
    cppsLike: float | None = None
    harmonicStrength: float | None = None
    breathyRisk: float | None = None
    strainRisk: float | None = None
    jitterLocal: float | None = None
    jitterRap: float | None = None
    jitterPpq5: float | None = None
    shimmerLocal: float | None = None
    shimmerApq3: float | None = None
    shimmerApq5: float | None = None


class VoiceAttemptAdvancedMetrics(BaseModel):
    sampleCount: int | None = None
    voicedFramePct: float | None = None
    confidentFramePct: float | None = None
    scoreConfidence: float | None = None
    # Measurement validity is distinct from numeric backward compatibility:
    # legacy core fields remain finite, while every decision/storage consumer
    # must refuse them when no voiced observation was available.
    measurementAvailable: bool | None = None
    measurementRejectionReasons: list[str] = Field(default_factory=list)
    pitchValidFrameCount: int | None = None
    hnrValidFrameCount: int | None = None
    hnrVoicedCoveragePct: float | None = None
    # Consumer-hardware capture health (2026-07-19). All additive/optional —
    # older artifacts without them keep parsing, and every consumer null-guards.
    # These are CHANNEL health (mic/room), deliberately distinct from
    # scoreConfidence, which is ANALYSIS-tracking confidence (voiced coverage +
    # pitch confidence + stability — a paused-but-clean take scores low there,
    # a clipped hot mic can score high). The backend safety gates read both
    # names as separate reasons, so we do not alias one onto the other.
    captureReliability: float | None = None
    noiseFloorDb: float | None = None
    snrDb: float | None = None
    clippingPct: float | None = None
    meanLoudnessDb: float | None = None
    peakLoudnessDb: float | None = None
    loudnessRangeDb: float | None = None
    medianPitchHz: float | None = None
    pitchP10Hz: float | None = None
    pitchP90Hz: float | None = None
    pitchStdSt: float | None = None
    phraseStartPitchHz: float | None = None
    phraseEndPitchHz: float | None = None
    phraseEndDropHz: float | None = None
    pitchDriftSt: float | None = None
    # Phase 1.2: derived coaching metrics
    pitchTargetOccupancyPct: float | None = None
    phraseFinalDropSemitones: float | None = None
    spectralCentroidMeanHz: float | None = None
    spectralTiltMeanDbPerOct: float | None = None
    harmonicRatioMean: float | None = None
    stabilityMean: float | None = None
    metricSimilarity: float | None = None
    contourSimilarity: float | None = None
    # Cheap vocalise proxies (2026-07-19). All additive/optional — null when the
    # inputs they need are absent — and all derived from series the attempt
    # already carries (per-frame pitch, per-frame rms, per-window F2), so no new
    # heavy DSP passes.
    #  - glideSmoothness: 0-1, 1 − (std of the per-frame pitch slope in
    #    semitones/sec / 30.0), clamped. Null when <8 voiced frames.
    #  - f2RangeHz: max−min of the per-window F2 list the formant-lite pass
    #    already measures. Null when <3 windows (or profile 'no_formants').
    #  - trillRateHz/trillDetected/trillDurationMs: dominant 15-45 Hz amplitude
    #    modulation of the frame-RMS envelope (one lag-limited autocorrelation).
    #    Null when the frame rate can't cover the band (live ~16 fps path) or
    #    the voiced span is too short; trillRateHz/DurationMs null unless
    #    detected.
    #  - hitPitchCeiling: true when ≥5% of voiced frames sit within 2 Hz of the
    #    400 Hz tracker clamp (siren honesty flag: the measured top may be the
    #    tracker's ceiling, not the singer's). Null when no voiced frames.
    glideSmoothness: float | None = None
    f2RangeHz: float | None = None
    trillRateHz: float | None = None
    trillDetected: bool | None = None
    trillDurationMs: int | None = None
    hitPitchCeiling: bool | None = None
    # Analysis-profile echo (2026-07-19): which profile produced these metrics
    # ('standard' | 'no_formants'), so downstream witnesses can log why
    # formant-derived fields are null.
    analysisProfile: str | None = None
    formantLite: VoiceAttemptFormantLiteMetrics | None = None
    quality: VoiceAttemptQualityMetrics | None = None
    reliabilityFlags: list[str] = Field(default_factory=list)


class VoiceAttemptMetrics(BaseModel):
    meanPitchHz: float
    pitchRangeSt: float
    resonanceMean: float
    weightMean: float
    targetHitPct: float
    similarityScore: float
    advanced: VoiceAttemptAdvancedMetrics | None = None


class VoiceAttemptTarget(BaseModel):
    """The target the attempt is scored against, embedded in the signal so the
    coach can reason about deltas-from-target instead of only a preset name.
    For voice copy (source == "reference") the bands are derived from the
    uploaded reference recording and the reference* fields carry that voice's
    own measured center."""

    source: str  # "reference" | "preset" | "custom-handmade" | "custom-reference"
    targetPreset: str
    targetProfileId: str | None = None
    # 2026-07-26 MTF-ONLY: "masculine"/"ftm" are RETIRED directions — no caller
    # should send them, and nothing downstream coaches them.
    # 2026-07-27 SCOPE CORRECTION: this field is NOT validated. `direction` is a
    # bare `str | None` with no Literal type and no validator, so
    # VoiceAttemptTarget(source="preset", targetPreset="masculine",
    # direction="masculine") constructs without error. An earlier version of
    # this comment claimed the value "is no longer accepted here", which
    # asserted an enforcement the code does not have.
    # The enforcing gate is `normalize_target_preset` (audio_analysis.py), which
    # RAISES on any preset outside the live enum; the routers map that to HTTP
    # 400. A masculinizing target is corrupt input and is rejected there, which
    # is the correct and only response — there is no female-to-male route.
    # 2026-07-27 SCOPE CORRECTION (round 4): an earlier version of this note
    # said the analyzer rejects such a target "at session start", implying the
    # whole runtime was covered. MEASURED: it was not. `start_session` did call
    # `normalize_target_preset`, but a session RESUMED from an already-corrupt
    # stored row went straight on to `analyze_pcm_frame` and
    # `build_attempt_summary` with `session.targetPreset` unchecked, and both
    # resolved cute-feminine bands under the retired label. That hole is now
    # closed at the resolver — `get_target_profile` routes through
    # `normalize_target_preset`, so every read path fails closed, not just
    # session start. The JS gateway has the matching gap on its own write path
    # (`updateVoiceSessionPreset`), closed there by an enum check against
    # voice-cue-sheet PRESET_PROFILES.
    # 2026-07-30 MTF-ONLY: "neutral" retired with the androgynous /
    # gender-neutral presets, so "feminine" is the only value the analyzer emits.
    # Still not enforced here — this is a response field, and a pydantic enum
    # would turn an old stored row into a 500 on read instead of a stale label.
    direction: str | None = None  # expected "feminine" (not enforced)
    pitchFloorHz: float | None = Field(
        default=None,
        ge=VOICE_TARGET_PITCH_MIN_HZ,
        le=VOICE_TARGET_PITCH_MAX_HZ,
        allow_inf_nan=False,
    )
    pitchCeilingHz: float | None = Field(
        default=None,
        ge=VOICE_TARGET_PITCH_MIN_HZ,
        le=VOICE_TARGET_PITCH_MAX_HZ,
        allow_inf_nan=False,
    )
    resonanceFloor: float | None = Field(
        default=None, ge=0.0, le=1.0, allow_inf_nan=False
    )
    resonanceCeiling: float | None = Field(
        default=None, ge=0.0, le=1.0, allow_inf_nan=False
    )
    weightFloor: float | None = Field(
        default=None, ge=0.0, le=1.0, allow_inf_nan=False
    )
    weightCeiling: float | None = Field(
        default=None, ge=0.0, le=1.0, allow_inf_nan=False
    )
    minTargetHitPct: float | None = None
    minSimilarityScore: float | None = None
    minResonance: float | None = None
    maxWeight: float | None = None
    minPitchRangeSt: float | None = None
    f2FloorHz: float | None = None
    referenceMeanPitchHz: float | None = None
    referenceResonanceMean: float | None = None
    referenceWeightMean: float | None = None
    referenceF2MedianHz: float | None = None
    # where the current attempt sits relative to the target
    pitchPlacement: str | None = None  # "below" | "in_band" | "above"
    pitchGapHz: float | None = None  # signed Hz from nearest band edge (0 in band)
    resonanceGap: float | None = None  # resonanceMean - minResonance (<0 = darker)
    weightGap: float | None = None  # maxWeight - weightMean (<0 = heavier than target)

    @model_validator(mode="after")
    def validate_exact_bands(self) -> "VoiceAttemptTarget":
        _validate_target_band_order(
            "pitchFloorHz", self.pitchFloorHz, "pitchCeilingHz", self.pitchCeilingHz
        )
        _validate_target_band_order(
            "resonanceFloor",
            self.resonanceFloor,
            "resonanceCeiling",
            self.resonanceCeiling,
        )
        _validate_target_band_order(
            "weightFloor", self.weightFloor, "weightCeiling", self.weightCeiling
        )
        return self


class VoiceAttemptSummary(BaseModel):
    voiceSessionId: str
    durationMs: int
    transcript: str | None = None
    targetPreset: str
    target: VoiceAttemptTarget | None = None
    metrics: VoiceAttemptMetrics
    issues: list[str] = Field(default_factory=list)
    nextDrills: list[str] = Field(default_factory=list)
    analysisVersion: str | None = VOICE_ANALYSIS_VERSION


class VoiceAttemptArtifact(BaseModel):
    attemptArtifactId: str
    clientAttemptId: str | None = None
    voiceSessionId: str
    sloaneSessionId: str
    lessonId: str | None = None
    targetPreset: str
    target: VoiceAttemptTarget | None = None
    referenceClipId: str | None = None
    finalizationAction: str
    finalizationReason: str | None = None
    sessionCreatedAt: str | None = None
    createdAt: str
    finalizedAt: str
    durationMs: int
    frameCount: int
    timelineFrameCount: int
    timelineSampledFrameCount: int
    timelineCompression: str = "none"
    timeline: list[VoiceFrame] = Field(default_factory=list)
    metrics: VoiceAttemptMetrics
    reliabilityFlags: list[str] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
    nextDrills: list[str] = Field(default_factory=list)
    transcript: str | None = None
    repContext: VoiceRepContext | None = None
    selfReport: VoiceSelfReport | None = None
    includesRawAudio: bool = False
    analysisVersion: str | None = VOICE_ANALYSIS_VERSION


class VoiceTargetProfileRequest(BaseModel):
    clipId: str
    targetPreset: str = "cute-feminine"


class VoiceMilestonePinRequest(BaseModel):
    """V1.5 time-lapse mirror: pin a finalized attempt as a permanent milestone
    for a student. The attempt's audio must still be in the retention ring."""

    studentId: str
    label: str | None = None


class VoiceTargetFormantLiteBands(BaseModel):
    f2FloorHz: float | None = None
    frontnessFloor: float | None = None


class VoiceTargetQualityBands(BaseModel):
    cppsLikeFloor: float | None = None
    harmonicStrengthFloor: float | None = None
    breathyRiskCeiling: float | None = None
    strainRiskCeiling: float | None = None


class VoiceTargetAdvancedBands(BaseModel):
    pitchP10HzFloor: float | None = None
    pitchP90HzCeiling: float | None = None
    pitchStdStCeiling: float | None = None
    phraseEndDropHzCeiling: float | None = None
    spectralCentroidFloorHz: float | None = None
    spectralTiltFloorDbPerOct: float | None = None
    harmonicRatioFloor: float | None = None
    stabilityFloor: float | None = None
    voicedFramePctFloor: float | None = None
    formantLite: VoiceTargetFormantLiteBands | None = None
    quality: VoiceTargetQualityBands | None = None


class VoiceTargetProfile(BaseModel):
    profileId: str
    clipId: str
    sourceFilename: str
    durationMs: int
    targetPreset: str
    metrics: VoiceAttemptMetrics
    pitchFloorHz: float = Field(
        ge=VOICE_TARGET_PITCH_MIN_HZ,
        le=VOICE_TARGET_PITCH_MAX_HZ,
        allow_inf_nan=False,
    )
    pitchCeilingHz: float = Field(
        ge=VOICE_TARGET_PITCH_MIN_HZ,
        le=VOICE_TARGET_PITCH_MAX_HZ,
        allow_inf_nan=False,
    )
    resonanceFloor: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    resonanceCeiling: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    weightFloor: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    weightCeiling: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    stylePrompt: str
    notes: list[str] = Field(default_factory=list)
    advancedBands: VoiceTargetAdvancedBands | None = None
    analysisVersion: str | None = VOICE_ANALYSIS_VERSION

    @model_validator(mode="after")
    def validate_exact_bands(self) -> "VoiceTargetProfile":
        _validate_target_band_order(
            "pitchFloorHz", self.pitchFloorHz, "pitchCeilingHz", self.pitchCeilingHz
        )
        _validate_target_band_order(
            "resonanceFloor",
            self.resonanceFloor,
            "resonanceCeiling",
            self.resonanceCeiling,
        )
        _validate_target_band_order(
            "weightFloor", self.weightFloor, "weightCeiling", self.weightCeiling
        )
        return self


class VoicePhraseForecastRequest(BaseModel):
    phrase: str
    targetProfile: VoiceTargetProfile


class VoicePhraseForecastResponse(BaseModel):
    profileId: str
    clipId: str
    phrase: str
    targetPreset: str
    estimatedDurationMs: int
    metrics: VoiceAttemptMetrics
    timeline: list["VoiceFrame"] = Field(default_factory=list)
    summary: str
    notes: list[str] = Field(default_factory=list)
    analysisVersion: str | None = VOICE_ANALYSIS_VERSION


class VoiceSessionState(BaseModel):
    voiceSessionId: str
    sloaneSessionId: str
    targetPreset: str
    referenceClipId: str | None = None
    targetVoiceProfile: VoiceTargetProfile | None = None
    targetSource: str | None = None
    lessonId: str | None = None
    memoryEnabled: bool = True
    status: str = "ready"
    streamUrl: str | None = None
    createdAt: str
    endedAt: str | None = None
    frameCount: int = 0
    lastFrame: VoiceFrame | None = None
    timeline: list[VoiceFrame] = Field(default_factory=list)
    summary: VoiceAttemptSummary | None = None
    attemptArtifact: VoiceAttemptArtifact | None = None
    analysisVersion: str | None = VOICE_ANALYSIS_VERSION


class VoiceReferenceQuality(BaseModel):
    """Plain-English trust assessment of an uploaded/recorded reference clip.

    Derived entirely from the metrics ``build_attempt_metrics`` already produces
    (no new DSP math): the analyzer's own reliability flags, voiced coverage,
    mean loudness, plus a clip-wide clipping fraction measured on the raw decoded
    samples. ``verdict`` drives the front-door report card; ``cloneable`` is the
    server-side gate that decides whether VoxCPM is allowed to clone this voice."""

    durationMs: int
    clippingPct: float
    meanLoudnessDb: float
    voicedCoveragePct: float
    flags: list[str] = Field(default_factory=list)
    verdict: str  # "good" | "usable" | "reject"
    cloneable: bool
    summary: str
    cloneNote: str | None = None


class ReferenceAnalysisResponse(BaseModel):
    clipId: str
    filename: str
    durationMs: int
    targetPreset: str
    metrics: VoiceAttemptMetrics
    timeline: list[VoiceFrame] = Field(default_factory=list)
    quality: VoiceReferenceQuality | None = None
    # Missing on legacy persisted references means "unknown calibration", not
    # "whatever version this process currently runs". New analyses stamp the
    # current version explicitly at creation.
    analysisVersion: str | None = None


class SynthesisAnalysisRequest(BaseModel):
    """Analyze audio that NOTHING owns — no session, no stored clip (2026-07-30).

    The gateway synthesizes the tutor's own speech and wants its pitch/resonance
    travel so the learner can copy the shape. That reading is a DISPLAY artifact:
    it must not become a learner take and it must not become a stored reference.

    Both existing analysis doors write. ``/sessions/{id}/take-oneshot`` appends a
    real take to the learner's session (artifact, trend, history), and
    ``/reference/analyze`` retains the raw bytes plus an analysis JSON forever
    with no delete route. Either one would file the tutor's voice under the
    learner's progress. So this route reuses the analysis CONTRACT — the same
    ``build_timeline_from_samples`` / ``build_attempt_metrics`` core, the same
    ``VoiceFrame`` shape, the same ``analysisVersion`` — with no persistence at
    all, which is the only part that had to be new.

    ``pcm16Base64`` is base64 mono PCM16 little-endian at ``sampleRate``;
    resampling to the analyzer's rate uses the analyzer's OWN resampler so a
    synthesized reading lands in the same measurement space as a learner take.
    """

    pcm16Base64: str
    sampleRate: int = 16000
    targetPreset: str = "cute-feminine"


class SynthesisAnalysisResponse(BaseModel):
    analysisVersion: str
    durationMs: int
    sampleRate: int
    metrics: VoiceAttemptMetrics
    timeline: list[VoiceFrame] = Field(default_factory=list)


class VoiceCustomTargetPreset(BaseModel):
    id: str
    name: str
    kind: str
    basePreset: str
    createdAt: int | None = None
    updatedAt: int | None = None
    archived: bool = False
    archivedAt: int | None = None
    targetVoiceProfile: VoiceTargetProfile | None = None
    referenceClipId: str | None = None
    referenceClipName: str | None = None
    referenceAnalysis: ReferenceAnalysisResponse | None = None
    sourceLabel: str | None = None
    notes: list[str] = Field(default_factory=list)


class VoiceCustomTargetPresetLibraryResponse(BaseModel):
    presets: list[VoiceCustomTargetPreset] = Field(default_factory=list)


class VoiceHandmadeTargetPresetInputs(BaseModel):
    pitchFloorHz: float | str | None = None
    pitchCeilingHz: float | str | None = None
    resonanceFloor: float | str | None = None
    resonanceCeiling: float | str | None = None
    weightFloor: float | str | None = None
    weightCeiling: float | str | None = None
    stylePrompt: str | None = None
    notesText: str | None = None


class VoiceCustomTargetPresetSaveRequest(BaseModel):
    id: str | None = None
    presetId: str | None = None
    name: str | None = None
    kind: str | None = None
    basePreset: str | None = None
    createdAt: int | None = None
    updatedAt: int | None = None
    expectedUpdatedAt: int | None = None
    handmadeTarget: VoiceHandmadeTargetPresetInputs | None = None
    pitchFloorHz: float | str | None = None
    pitchCeilingHz: float | str | None = None
    resonanceFloor: float | str | None = None
    resonanceCeiling: float | str | None = None
    weightFloor: float | str | None = None
    weightCeiling: float | str | None = None
    stylePrompt: str | None = None
    notesText: str | None = None
    targetVoiceProfile: dict[str, Any] | None = None
    referenceClipId: str | None = None
    referenceClipName: str | None = None
    referenceAnalysis: dict[str, Any] | None = None
    sourceLabel: str | None = None
    notes: list[str] | str | None = None


class VoiceReferenceTargetPresetSaveRequest(BaseModel):
    id: str | None = None
    presetId: str | None = None
    name: str | None = None
    basePreset: str | None = None
    expectedUpdatedAt: int | None = None
    referenceClipId: str
    referenceClipName: str | None = None
    referenceAnalysis: dict[str, Any] | None = None
    targetVoiceProfile: dict[str, Any] | None = None
    sourceLabel: str | None = None
    notes: list[str] | str | None = None


class VoiceHandmadeTargetPresetSaveRequest(BaseModel):
    id: str | None = None
    presetId: str | None = None
    name: str | None = None
    basePreset: str | None = None
    expectedUpdatedAt: int | None = None
    handmadeTarget: VoiceHandmadeTargetPresetInputs | None = None
    pitchFloorHz: float | str | None = None
    pitchCeilingHz: float | str | None = None
    resonanceFloor: float | str | None = None
    resonanceCeiling: float | str | None = None
    weightFloor: float | str | None = None
    weightCeiling: float | str | None = None
    stylePrompt: str | None = None
    notesText: str | None = None
    targetVoiceProfile: dict[str, Any] | None = None
    sourceLabel: str | None = None
    notes: list[str] | str | None = None


class VoiceCustomTargetPresetDeleteResponse(BaseModel):
    deletedPreset: VoiceCustomTargetPreset


class VoiceCustomTargetPresetDuplicateRequest(BaseModel):
    name: str | None = None
    expectedUpdatedAt: int | None = None


class VoiceCustomTargetPresetMutationRequest(BaseModel):
    expectedUpdatedAt: int | None = None
