const { resolveVoiceMeasurementUsability } = require('./voice-measurement-validity');
// The rotation memory is exactly as long as voice-drills has penalties to apply
// to it — a 4th remembered id with only 3 penalties would be dead weight, and
// truncating below the penalty count would silently disable the last penalty.
// Derived, never hardcoded, so the two cannot drift apart.
const { RECENTLY_PRESCRIBED_MEMORY } = require('./voice-drills');
// 2026-07-26 phase C (sentence teardown): the isolation loop's bounds are OWNED by
// coaching/section-loop.js. Imported rather than restated so a change to the cap or
// the fragment width cannot leave this normalizer silently clamping to a stale
// number. section-loop.js is a pure module with no requires, so this cannot cycle.
const {
  MAX_ATTEMPTS: SECTION_LOOP_MAX_ATTEMPTS,
  MAX_FRAGMENT_TOKENS: SECTION_LOOP_MAX_FRAGMENT_TOKENS,
  SECTION_LOOP_AXES,
} = require('./coaching/section-loop');
const { normalizeSentenceProgression } = require('./lessons/sentence-progression');
const {
  buildDefaultTargetMetricSessionState,
  normalizeTargetMetricSessionState,
} = require('./coaching/target-metric-session-state');

function createVoiceSessionStateRuntime(deps = {}) {
  const {
    appendVoiceCoachThreadMessage,
    buildVoiceCueSheet,
    buildVoiceStudentModelEvaluations: buildVoiceStudentModelEvaluationsPure,
    getCachedDefaultModelId,
    getRenderableVoicePhraseComparison,
    getVoiceDrillById,
    logger = console,
    normalizeDeepTutorVoiceState,
    normalizeDifficultyPreference,
    normalizeRequestedModel,
    normalizeVoiceCoachInputConfidence,
    normalizeVoiceCoachInputProvider,
    resolveActiveVoicePhrase,
    resolveValidatedSessionModel,
  } = deps;

  const DEFAULT_VOICE_STUDENT_ID = process.env.VOICE_STUDENT_MODEL_ID || 'sloane-user-voice';
  // ---------------------------------------------------------------------------
  // `minResonanceMean` — v4 RECALIBRATION (2026-07-26, analyzer version
  // `voice-metrics-v4-formants`).
  //
  // WHAT THE CONSTANT PHYSICALLY MEANS. It is NOT a mastery bar and not a
  // fraction of anything. It is the fallback the student-model evaluator uses to
  // SYNTHESIZE the pass band [resonanceFloor, resonanceCeiling] when a take
  // summary arrives WITHOUT the analyzer's own bands. voice-student-evaluations.js
  // (`if (resonanceFloor === null || resonanceCeiling === null)`) is a
  // line-for-line port of audio_analysis._target_timbre_bands — same
  // feminine/neutral branches, same 0.14 neutral half-width — so this
  // number's only correct value is the analyzer's OWN `min_resonance_mean` for
  // the same preset, i.e. the number the live path already receives as
  // `summary.target.resonanceFloor`. Any other value makes the degraded path
  // disagree with the live path about the same take.
  //
  // WHY IT MOVED. These read 0.58 / 0.54 / 0.62 / 0.60 — a stale copy of the
  // analyzer table. Under the pre-v4 formant selector, front-vowel F2 read
  // ~798 Hz against a true 2761, so `resonance = 0.80*clamp((F2-1250)/900) + ...`
  // collapsed to ~0.0 and EVERY take failed both the stale copy and the
  // authority: the drift produced identical verdicts and was invisible.
  //
  // MEASURED on the repaired analyzer at 8b0a19b (synthesized vowels, feminine F0
  // 180-240 Hz): per-vowel resonance /i/ 0.800 · /ae/ 0.383-0.461 · /a/ 0.245-0.303
  // · /u/ 0.000; phrase-level `resonanceMean` over a mixed-vowel take 0.355-0.435
  // across these four presets. Those values PASS every analyzer floor
  // (0.32/0.24/0.34/0.38) and FAIL every stale copy — so post-repair the fallback
  // would tell a learner their resonance is outside the target band on a take the
  // analyzer itself scores in-band. Re-synced to the authority below; pinned by
  // voice-student-evaluations.v4-calibration.test.js.
  //
  // NOT CHANGED here, deliberately: `minPitchHz`, `minPitchRangeSt`,
  // `minSimilarityScore`, `minPhraseMatchScore` (pitch/contour measurements the
  // formant repair did not touch) and `maxWeightMean` / `minTargetHitPct` (which
  // DO ride the repaired formants but show no verdict disagreement at v4-realistic
  // values — measured weightMean 0.115-0.251 passes both the analyzer ceilings
  // 0.38-0.46 and these). Those drifts are real but are not this repair's warrant.
  // ---------------------------------------------------------------------------
  const VOICE_STUDENT_MODEL_PRESETS = {
    'cute-feminine': {
      minPitchHz: 195,
      minTargetHitPct: 0.42,
      // v4: audio_analysis.TARGET_PROFILES['cute-feminine'].min_resonance_mean
      minResonanceMean: 0.32,
      maxWeightMean: 0.6,
      minPitchRangeSt: 2.8,
      minSimilarityScore: 0.58,
      minPhraseMatchScore: 0.56,
    },
    'everyday-feminine': {
      minPitchHz: 182,
      minTargetHitPct: 0.38,
      // v4: audio_analysis.TARGET_PROFILES['everyday-feminine'].min_resonance_mean
      minResonanceMean: 0.24,
      maxWeightMean: 0.64,
      minPitchRangeSt: 2.4,
      minSimilarityScore: 0.54,
      minPhraseMatchScore: 0.58,
    },
    'bright-playful': {
      minPitchHz: 205,
      minTargetHitPct: 0.48,
      // v4: audio_analysis.TARGET_PROFILES['bright-playful'].min_resonance_mean
      minResonanceMean: 0.34,
      maxWeightMean: 0.56,
      minPitchRangeSt: 3.4,
      minSimilarityScore: 0.62,
      minPhraseMatchScore: 0.6,
    },
    'australian-bright-feminine': {
      minPitchHz: 190,
      minTargetHitPct: 0.44,
      // v4: audio_analysis.TARGET_PROFILES['australian-bright-feminine'].min_resonance_mean
      minResonanceMean: 0.38,
      maxWeightMean: 0.58,
      minPitchRangeSt: 2.8,
      minSimilarityScore: 0.58,
      minPhraseMatchScore: 0.6,
    },
    // 2026-07-27: `soft-feminine` was MISSING from this table even though the DSP
    // has shipped it since the preset library was written, so
    // `getVoiceStudentPresetTargets('soft-feminine')` fell through to the
    // `cute-feminine` fallback — holding a soft-feminine learner to a 195 Hz
    // pitch floor and a 0.32 resonance bar when their own DSP profile asks for
    // 175 Hz and 0.20. Derived by the SAME rule documented for the neutral rows
    // below: exact DSP copies for minResonanceMean / minSimilarityScore /
    // minPitchRangeSt, and the family's smallest observed offset for the other
    // three so the row is never stricter than the derivation supports.
    'soft-feminine': {
      minPitchHz: 182, // DSP pitch_floor_hz 175 + 7
      minTargetHitPct: 0.375, // DSP min_target_hit_pct 0.25 x 1.5
      // v4: audio_analysis.TARGET_PROFILES['soft-feminine'].min_resonance_mean
      minResonanceMean: 0.2,
      maxWeightMean: 0.6, // DSP max_weight_mean 0.44 + 0.16
      minPitchRangeSt: 2.4,
      minSimilarityScore: 0.52,
      minPhraseMatchScore: 0.56,
    },
    // 2026-07-27: NEUTRAL entries added. This table previously held only the
    // four feminine presets, so `getVoiceStudentPresetTargets` fell through to
    // `cute-feminine` for every neutral target — scoring a neutral learner
    // against a 195 Hz pitch floor and a 0.32 resonance bar they never asked
    // for, and driving the outbound `misconception` strings off it.
    //
    // Provenance of the numbers (audio_analysis.py TARGET_PROFILES, the DSP
    // source these thresholds already track): minResonanceMean,
    // minSimilarityScore and minPitchRangeSt are EXACT copies of the DSP values
    // — verified exact for all four feminine rows above. The other three are
    // offsets from the DSP profile, and the family's SMALLEST observed offset is
    // used so no learner is ever held to a stricter bar than the derivation
    // supports: minPitchHz = pitch_floor + 7 (family range +7..+14),
    // minTargetHitPct = min_target_hit_pct x 1.5 (family range 1.5..1.76).
    // minPhraseMatchScore is ASR word-match and direction-independent; it takes
    // the family minimum (0.56).
    //
    // maxWeightMean is a CEILING on every row: voice-student-evaluations expands
    // it to the band [0, maxWeightMean], so the +0.16 family offset genuinely
    // widens the pass zone.
    //
    // 2026-07-30: the exception that used to live here is GONE with the neutral
    // presets. It is recorded because the shape of the mistake is worth keeping:
    // on a neutral row the same field was a band CENTRE rather than a ceiling, so
    // adding a leniency offset SHIFTED the band instead of widening it — +0.16
    // gave 47-75%, which EXCLUDED 45%, the DSP's own target, and a learner
    // sitting exactly on target was marked incorrect. Those rows therefore
    // carried the raw DSP value. THE LESSON, which still applies: before adding a
    // leniency offset to a threshold, check whether that threshold is a bound or a
    // midpoint. An offset is only "lenient" against a bound.
    // (The old note cited NEUTRAL_TIMBRE_TOLERANCE in audio_analysis.py; that
    // constant no longer exists, so this text no longer points at live code.)
  };
  const VOICE_STUDENT_MODEL_CONCEPTS = {
    voice_pitch_center: 'Pitch center',
    voice_pitch_floor_control: 'Pitch floor control',
    voice_target_zone_accuracy: 'Target-zone accuracy',
    voice_resonance_brightness: 'Bright resonance placement',
    voice_light_vocal_weight: 'Light vocal weight',
    voice_playful_intonation: 'Playful intonation range',
    voice_phrase_endings: 'Phrase endings',
    voice_phrase_shape_matching: 'Phrase-shape matching',
    voice_reference_matching: 'Reference matching',
    voice_reference_frontness: 'Reference frontness',
    voice_easy_phonation: 'Easy phonation',
    voice_stability_control: 'Placement stability',
  };
  const VOICE_ATTEMPT_ARTIFACT_LIMIT = 12;
  const VOICE_STUDENT_MODEL_ATTEMPT_ID_LIMIT = 64;

  function buildDefaultVoiceInputRuntimeState(overrides = {}) {
    return {
      status: 'idle',
      lastOutcome: 'idle',
      requestedProvider: 'browser',
      effectiveProvider: null,
      captureProvider: null,
      providerStyle: null,
      transcriptSource: null,
      lastTranscript: null,
      lastTranscriptConfidence: null,
      lastCaptureStartedAt: null,
      lastSpeechDetectedAt: null,
      lastCapturedAt: null,
      lastProcessedAt: null,
      // 2026-07-26: the input turn BEFORE the current one. It opens the coach's
      // take-evidence freshness window (see signal-builder
      // resolveTakeEvidenceFreshness) — a take finalized before it belongs to a
      // previous turn and must not be judged as if it were this one's.
      previousInputTurnAt: null,
      lastCaptureDurationMs: null,
      lastRoundTripMs: null,
      successfulTurns: 0,
      noSpeechTurns: 0,
      errorCount: 0,
      consecutiveNoSpeechTurns: 0,
      consecutiveErrorTurns: 0,
      liveSessionId: null,
      lastSegmentId: null,
      liveEngine: null,
      liveInterimMode: null,
      liveVadStrategy: null,
      providerTarget: null,
      providerModel: null,
      providerLanguage: null,
      providerEndpointing: null,
      lastPartialTranscript: null,
      lastPartialTranscriptAt: null,
      lastVadState: null,
      lastBargeInAt: null,
      lastAnalysisSummary: null,
      lastAnalysisDurationMs: null,
      lastAverageLevelDb: null,
      lastPeakLevelDb: null,
      lastNoiseFloorDb: null,
      lastSnrDb: null,
      lastClippingPct: null,
      lastCaptureReliability: null,
      lastReliabilityFlags: [],
      lastSpeechDurationMs: null,
      lastAudioProcessedMs: null,
      lastError: null,
      lastEventAt: null,
      ...overrides,
    };
  }

  function buildDefaultVoiceState(overrides = {}) {
    return {
      status: 'idle',
      targetPreset: 'cute-feminine',
      targetSource: 'built-in',
      selectedCustomPresetId: null,
      selectedCustomPresetName: null,
      voiceSessionId: null,
      lessonId: null,
      referenceClipId: null,
      referenceClipName: null,
      referenceAnalysis: null,
      targetVoiceProfile: null,
      phraseForecast: null,
      forecastPhrase: null,
      streamUrl: null,
      serviceStatus: 'unknown',
      sessionStartedAt: null,
      endedAt: null,
      lastSummary: null,
      lastAttemptArtifact: null,
      // 2026-07-26: local receipt of when the last take was finalized, on OUR
      // clock. Backs the coach's take-evidence freshness window (Defect 3).
      lastTakeFinalizedAt: null,
      // 2026-07-26: the last few drill ids this session recommended, most recent
      // FIRST. Down-ranks them on the next call so the recommendation rotates
      // instead of returning one frozen permutation (Defect 4).
      recentDrillIds: [],
      attemptArtifacts: [],
      studentModelAttemptIds: [],
      phraseComparison: null,
      lastTakeTimeline: null,
      // 2026-07-26 phase C (sentence teardown): the live isolation loop, or null.
      // Shape + transition table: coaching/section-loop.js. Written only by the
      // runtime's coach paths, from resolveSectionLoopTurn's verdict.
      sectionLoop: null,
      // Target-metric causal state is session-scoped. Long-lived motor
      // effectiveness belongs to learner-context learningByTarget, not here.
      targetMetric: buildDefaultTargetMetricSessionState(),
      // A brief sound or fragment scaffold must retain the exact sentence it
      // is serving. The pure transition module owns its bounded progression.
      practiceProgression: null,
      // Identity of the take that CLOSED the last isolation loop. Without it, the
      // reassembly turn's own signal still carries the entry take's confident weak
      // section, and the loop would re-open on the take it just finished — slicing
      // that take's timeline by the wrong card's tokens. Cleared with the session.
      sectionLoopLastTakeKey: null,
      // 2026-07-26 field repair: the ENGINE's one-shot take-kind prescription,
      // or null. Shape { kind, drillId, lessonId, stampedAt }. Written only by
      // the runtime's coach paths from coachingDecision.recommendedDrill —
      // never from model text — and spent by the next dispatched take. Full
      // lifecycle is documented at stampEngineRecommendedTakeKind in
      // voice-standalone-runtime.js.
      pendingTakeKind: null,
      // 2026-07-30 cue carry-forward: the cue the LAST coach turn actually
      // gave, or null. Shape { id, axis, instruction } — the stable identity
      // coaching/signal-builder.recommendDrillForFocus already returns. Written
      // only by the runtime's coach paths from coachingDecision.recommendedDrill
      // (never from model text) and read back one turn later as
      // signal.previousCue, so the win line can name what she was doing when the
      // take landed. Lifecycle is documented at stampLastCueGiven in
      // voice-standalone-runtime.js.
      lastCueGiven: null,
      lastCoachMessage: null,
      lastCoachGeneratedAt: null,
      lastError: null,
      activeLine: null,
      lineQueue: [],
      lineDifficultyPreference: 'adaptive',
      coachThread: [],
      coachVoice: {
        speechEnabled: true,
        continuousEnabled: false,
        speechProvider: 'browser',
        inputProvider: 'browser',
      },
      voiceInputRuntime: buildDefaultVoiceInputRuntimeState(),
      voiceConditioning: {
        useTargetProfileStyle: true,
        styleInstruction: '',
        promptText: '',
        promptAudioName: null,
        promptLatentsReady: false,
        referenceAudioName: null,
        referenceLatentsReady: false,
        updatedAt: null,
      },
      advancedPanel: {
        open: false,
      },
      ...overrides,
    };
  }

  function createVoiceCoachMessageId(prefix = 'voice_msg') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function resolveVoiceCoachMessageChannel(kind) {
    const normalizedKind = typeof kind === 'string' ? kind.trim() : '';
    if (!normalizedKind || normalizedKind === 'note' || normalizedKind === 'follow-up-question') {
      return 'coach';
    }
    if (normalizedKind === 'legacy-answer' || normalizedKind === 'legacy-take-feedback') {
      return 'legacy';
    }
    if (normalizedKind.startsWith('runtime-')) {
      return 'runtime';
    }
    if (normalizedKind.startsWith('deeptutor-')) {
      return 'deeptutor';
    }
    if (normalizedKind.startsWith('brief-') || normalizedKind === 'brief-action-question') {
      return 'shortcut';
    }
    return 'coach';
  }

  function normalizeVoiceCoachMessage(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return null;
    }

    const role = message.role === 'user' ? 'user' : 'coach';
    const content = typeof message.content === 'string' ? message.content.trim() : '';
    if (!content) {
      return null;
    }

    const kind = typeof message.kind === 'string' && message.kind.trim() ? message.kind.trim() : 'note';
    const channel = message.channel === 'legacy'
      || message.channel === 'runtime'
      || message.channel === 'deeptutor'
      || message.channel === 'shortcut'
      || message.channel === 'coach'
      ? message.channel
      : resolveVoiceCoachMessageChannel(kind);
    const id = typeof message.id === 'string' && message.id.trim() ? message.id.trim() : createVoiceCoachMessageId(role);
    const createdAt = Number.isFinite(Number(message.createdAt)) ? Math.round(Number(message.createdAt)) : Date.now();

    return {
      id,
      role,
      channel,
      kind,
      content,
      createdAt,
    };
  }

  function normalizeVoiceCoachVoiceState(value) {
    return {
      speechEnabled: value?.speechEnabled !== false,
      continuousEnabled: Boolean(value?.continuousEnabled),
      speechProvider: value?.speechProvider === 'voxcpm' ? 'voxcpm' : 'browser',
      inputProvider: value?.inputProvider === 'backend' ? 'backend' : 'browser',
    };
  }

  function normalizeVoiceAdvancedPanelState(value) {
    return {
      open: Boolean(value?.open),
      vadRmsThreshold: Number.isFinite(Number(value?.vadRmsThreshold))
        ? Math.max(0.003, Math.min(0.08, Number(value.vadRmsThreshold)))
        : 0.018,
      vadSilenceHoldMs: 4500,
      vadNoSpeechTimeoutMs: Number.isFinite(Number(value?.vadNoSpeechTimeoutMs))
        ? Math.max(2000, Math.min(20000, Math.round(Number(value.vadNoSpeechTimeoutMs))))
        : 12000,
      vadMinSpeechMs: Number.isFinite(Number(value?.vadMinSpeechMs))
        ? Math.max(150, Math.min(2000, Math.round(Number(value.vadMinSpeechMs))))
        : 350,
      audioPreferWorklet: value?.audioPreferWorklet !== false,
    };
  }

  function normalizeVoiceConditioningState(value) {
    return {
      useTargetProfileStyle: value?.useTargetProfileStyle !== false,
      styleInstruction: typeof value?.styleInstruction === 'string' ? value.styleInstruction.trim().slice(0, 200) : '',
      promptText: typeof value?.promptText === 'string' ? value.promptText.trim().slice(0, 500) : '',
      promptAudioName: typeof value?.promptAudioName === 'string' && value.promptAudioName.trim() ? value.promptAudioName.trim().slice(0, 120) : null,
      promptLatentsReady: Boolean(value?.promptLatentsReady),
      referenceAudioName: typeof value?.referenceAudioName === 'string' && value.referenceAudioName.trim() ? value.referenceAudioName.trim().slice(0, 120) : null,
      referenceLatentsReady: Boolean(value?.referenceLatentsReady),
      updatedAt: Number.isFinite(Number(value?.updatedAt)) ? Math.round(Number(value.updatedAt)) : null,
    };
  }

  function normalizeVoiceCoachOptionalInputProvider(value) {
    return value === 'backend' || value === 'browser'
      ? value
      : null;
  }

  function normalizeVoiceInputRuntimeStatus(value) {
    return ['idle', 'waiting', 'listening', 'processing', 'error'].includes(value)
      ? value
      : 'idle';
  }

  function normalizeVoiceInputRuntimeOutcome(value) {
    return ['idle', 'completed', 'no-speech', 'error'].includes(value)
      ? value
      : 'idle';
  }

  function normalizeVoiceInputRuntimeText(value, maxLength = 160) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    return trimmed ? trimmed.slice(0, maxLength) : null;
  }

  function normalizeVoiceInputRuntimeTimestamp(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0
      ? Math.round(numeric)
      : null;
  }

  function normalizeVoiceInputRuntimeDuration(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0
      ? Math.round(numeric)
      : null;
  }

  function normalizeVoiceInputRuntimeCount(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0
      ? Math.round(numeric)
      : 0;
  }

  function normalizeVoiceInputRuntimeNumber(value) {
    // A missing measurement (null/undefined) must stay null, NOT collapse to 0:
    // Number(null) === 0 is finite, so without this guard a default/unset
    // lastSnrDb (and the level fields) became a *real* 0 reading, which
    // collectAnalyzerSafetyReasons then flagged as a capture failure (0 dB SNR)
    // -> capture_only -> breather on every no-audio turn. Matches the null-guard
    // its sibling normalizers (normalizeVoiceConfidence/FiniteNumber/DbNumber) use.
    if (value === null || value === undefined) {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? Number(numeric.toFixed(3))
      : null;
  }

  function clampVoiceMetric(value, min = 0, max = 1) {
    return Math.min(max, Math.max(min, value));
  }

  function normalizeVoiceConfidence(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? clampVoiceMetric(numeric, 0, 1)
      : null;
  }

  function normalizeVoiceFiniteNumber(value, digits = 3) {
    if (value === null || value === undefined) {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? Number(numeric.toFixed(digits))
      : null;
  }

  function normalizeVoiceMetricCount(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : null;
  }

  function normalizeVoiceDbNumber(value) {
    if (value === null || value === undefined) {
      return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? Number(numeric.toFixed(2))
      : null;
  }

  function normalizeVoiceAnalysisVersion(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized ? normalized.slice(0, 80) : null;
  }

  function normalizeVoiceText(value, maxLength = 240) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized ? normalized.slice(0, maxLength) : null;
  }

  function normalizeVoiceStringList(value, maxItems = 6, maxLength = 120) {
    return Array.isArray(value)
      ? value
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, maxItems)
          .map((item) => item.slice(0, maxLength))
      : [];
  }

  function hashVoiceAttemptFingerprint(summary) {
    if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
      return '';
    }

    const fingerprint = JSON.stringify({
      voiceSessionId: summary.voiceSessionId || null,
      durationMs: summary.durationMs || null,
      transcript: summary.transcript || null,
      targetPreset: summary.targetPreset || null,
      metrics: summary.metrics || null,
      issues: Array.isArray(summary.issues) ? summary.issues : [],
      nextDrills: Array.isArray(summary.nextDrills) ? summary.nextDrills : [],
      analysisVersion: summary.analysisVersion || null,
    });
    let hash = 5381;
    for (let index = 0; index < fingerprint.length; index += 1) {
      hash = ((hash << 5) + hash) ^ fingerprint.charCodeAt(index);
    }
    return (hash >>> 0).toString(36);
  }

  function normalizeVoiceArtifactTimestamp(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.round(numeric);
    }
    return normalizeVoiceText(value, 80);
  }

  function normalizeVoiceAttemptSidePayload(value, depth = 3) {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return normalizeVoiceText(value, 1200);
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'boolean') {
      return value;
    }
    if (depth <= 0) {
      return normalizeVoiceText(JSON.stringify(value), 1200);
    }
    if (Array.isArray(value)) {
      return value
        .slice(0, 12)
        .map((item) => normalizeVoiceAttemptSidePayload(item, depth - 1))
        .filter((item) => item !== null && item !== undefined && item !== '');
    }
    if (typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .slice(0, 24)
          .map(([key, entry]) => [
            String(key || '').trim().slice(0, 80),
            normalizeVoiceAttemptSidePayload(entry, depth - 1),
          ])
          .filter(([key, entry]) => key && entry !== null && entry !== undefined && entry !== ''),
      );
    }
    return null;
  }

  function normalizeVoiceSelfReportScale(value) {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    const rounded = Math.round(numeric);
    return rounded >= 1 && rounded <= 5 ? rounded : null;
  }

  function normalizeVoiceSelfReportMetadata(value) {
    const normalized = normalizeVoiceAttemptSidePayload(value, 2);
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
      return null;
    }
    return Object.keys(normalized).length > 0 ? normalized : null;
  }

  function normalizeVoiceSelfReportPayload(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      perceivedDifficulty: normalizeVoiceSelfReportScale(value.perceivedDifficulty ?? value.perceived_difficulty),
      effort: normalizeVoiceSelfReportScale(value.effort),
      confidence: normalizeVoiceSelfReportScale(value.confidence),
      strain: normalizeVoiceSelfReportScale(value.strain),
      fatigue: normalizeVoiceSelfReportScale(value.fatigue),
      notes: normalizeVoiceText(value.notes, 240),
      tags: normalizeVoiceStringList(value.tags, 8, 80),
      metadata: normalizeVoiceSelfReportMetadata(value.metadata),
    };

    return hasMeaningfulVoiceValues(normalized, ['tags']) ? normalized : null;
  }

  function resolveVoiceAttemptArtifactId(source, summary) {
    const explicitId = normalizeVoiceText(
      source?.attemptId
        || source?.attempt_id
        || source?.id
        || source?.clientAttemptId
        || source?.client_attempt_id,
      160,
    );
    if (explicitId) {
      return explicitId;
    }
    const summaryId = normalizeVoiceText(summary?.attemptId || summary?.attempt_id || summary?.id, 160);
    if (summaryId) {
      return summaryId;
    }
    const artifactId = normalizeVoiceText(source?.attemptArtifactId || source?.attempt_artifact_id, 160);
    if (artifactId) {
      return artifactId;
    }
    const fingerprint = hashVoiceAttemptFingerprint(summary);
    return fingerprint ? `summary_${fingerprint}` : null;
  }

  function hasUnknownVoiceKeys(value, knownKeys) {
    return Object.keys(value || {}).some((key) => !knownKeys.has(key));
  }

  function hasMeaningfulVoiceValues(value, listKeys = []) {
    const listKeySet = new Set(listKeys);
    return Object.entries(value || {}).some(([key, entry]) => {
      if (listKeySet.has(key)) {
        return Array.isArray(entry) && entry.length > 0;
      }
      return entry !== null && entry !== undefined && entry !== '';
    });
  }

  function normalizeVoiceFrameAdvancedMetrics(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      pitchConfidence: normalizeVoiceConfidence(value.pitchConfidence),
      voicedProbability: normalizeVoiceConfidence(value.voicedProbability),
      rms: normalizeVoiceFiniteNumber(value.rms, 5),
      spectralCentroidHz: normalizeVoiceFiniteNumber(value.spectralCentroidHz, 2),
      spectralBandwidthHz: normalizeVoiceFiniteNumber(value.spectralBandwidthHz, 2),
      spectralFlux: normalizeVoiceFiniteNumber(value.spectralFlux, 4),
      spectralTiltDbPerOct: normalizeVoiceFiniteNumber(value.spectralTiltDbPerOct, 3),
      harmonicRatio: normalizeVoiceConfidence(value.harmonicRatio),
      clippingPct: normalizeVoiceConfidence(value.clippingPct),
      pitchSlopeStPerSec: normalizeVoiceFiniteNumber(value.pitchSlopeStPerSec, 3),
      stabilityScore: normalizeVoiceConfidence(value.stabilityScore),
    };

    return hasMeaningfulVoiceValues(normalized) || hasUnknownVoiceKeys(value, new Set([
      'pitchConfidence',
      'voicedProbability',
      'rms',
      'spectralCentroidHz',
      'spectralBandwidthHz',
      'spectralFlux',
      'spectralTiltDbPerOct',
      'harmonicRatio',
      'clippingPct',
      'pitchSlopeStPerSec',
      'stabilityScore',
    ]))
      ? normalized
      : null;
  }

  function normalizeVoiceDetailedFrame(frame) {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
      return null;
    }

    return {
      ...frame,
      t: Math.max(0, Number(frame.t) || 0),
      voiced: Boolean(frame.voiced),
      pitchHz: Math.max(0, Number(frame.pitchHz) || 0),
      pitchScore: normalizeVoiceConfidence(frame.pitchScore) ?? 0,
      resonanceScore: normalizeVoiceConfidence(frame.resonanceScore) ?? 0,
      weightScore: normalizeVoiceConfidence(frame.weightScore) ?? 0,
      confidence: normalizeVoiceConfidence(frame.confidence) ?? 0,
      loudnessDb: Number.isFinite(Number(frame.loudnessDb)) ? Number(frame.loudnessDb) : 0,
      advanced: normalizeVoiceFrameAdvancedMetrics(frame.advanced),
      analysisVersion: normalizeVoiceAnalysisVersion(frame.analysisVersion),
    };
  }

  function evenlySample(items, maxPoints = 160) {
    if (!Array.isArray(items) || items.length <= maxPoints) {
      return Array.isArray(items) ? items.slice() : [];
    }

    const sampled = [];
    const lastIndex = items.length - 1;
    for (let index = 0; index < maxPoints; index += 1) {
      const sourceIndex = Math.round((index / (maxPoints - 1)) * lastIndex);
      sampled.push(items[sourceIndex]);
    }
    return sampled;
  }

  function normalizeVoiceDetailedTimeline(timeline, maxPoints = 160) {
    if (!Array.isArray(timeline)) {
      return null;
    }

    return evenlySample(
      timeline
        .map((frame) => normalizeVoiceDetailedFrame(frame))
        .filter(Boolean),
      maxPoints,
    );
  }

  function normalizeVoiceAttemptAdvancedMetrics(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      sampleCount: normalizeVoiceMetricCount(value.sampleCount),
      voicedFramePct: normalizeVoiceConfidence(value.voicedFramePct),
      confidentFramePct: normalizeVoiceConfidence(value.confidentFramePct),
      scoreConfidence: normalizeVoiceConfidence(value.scoreConfidence),
      measurementAvailable: value.measurementAvailable === true
        ? true
        : value.measurementAvailable === false ? false : null,
      measurementRejectionReasons: normalizeVoiceStringList(value.measurementRejectionReasons, 8, 80),
      pitchValidFrameCount: normalizeVoiceMetricCount(value.pitchValidFrameCount),
      hnrValidFrameCount: normalizeVoiceMetricCount(value.hnrValidFrameCount),
      hnrVoicedCoveragePct: normalizeVoiceConfidence(value.hnrVoicedCoveragePct),
      captureReliability: normalizeVoiceConfidence(value.captureReliability),
      noiseFloorDb: normalizeVoiceDbNumber(value.noiseFloorDb),
      snrDb: normalizeVoiceDbNumber(value.snrDb),
      clippingPct: normalizeVoiceConfidence(value.clippingPct),
      meanLoudnessDb: normalizeVoiceDbNumber(value.meanLoudnessDb),
      peakLoudnessDb: normalizeVoiceDbNumber(value.peakLoudnessDb),
      loudnessRangeDb: normalizeVoiceDbNumber(value.loudnessRangeDb),
      medianPitchHz: normalizeVoiceFiniteNumber(value.medianPitchHz, 2),
      pitchP10Hz: normalizeVoiceFiniteNumber(value.pitchP10Hz, 2),
      pitchP90Hz: normalizeVoiceFiniteNumber(value.pitchP90Hz, 2),
      pitchStdSt: normalizeVoiceFiniteNumber(value.pitchStdSt, 3),
      phraseStartPitchHz: normalizeVoiceFiniteNumber(value.phraseStartPitchHz, 2),
      phraseEndPitchHz: normalizeVoiceFiniteNumber(value.phraseEndPitchHz, 2),
      phraseEndDropHz: normalizeVoiceFiniteNumber(value.phraseEndDropHz, 2),
      pitchDriftSt: normalizeVoiceFiniteNumber(value.pitchDriftSt, 3),
      pitchTargetOccupancyPct: normalizeVoiceFiniteNumber(value.pitchTargetOccupancyPct, 1),
      phraseFinalDropSemitones: normalizeVoiceFiniteNumber(value.phraseFinalDropSemitones, 2),
      spectralCentroidMeanHz: normalizeVoiceFiniteNumber(value.spectralCentroidMeanHz, 2),
      spectralTiltMeanDbPerOct: normalizeVoiceFiniteNumber(value.spectralTiltMeanDbPerOct, 3),
      harmonicRatioMean: normalizeVoiceConfidence(value.harmonicRatioMean),
      stabilityMean: normalizeVoiceConfidence(value.stabilityMean),
      metricSimilarity: normalizeVoiceConfidence(value.metricSimilarity),
      contourSimilarity: normalizeVoiceConfidence(value.contourSimilarity),
      formantLite: normalizeVoiceAttemptFormantLiteMetrics(value.formantLite),
      quality: normalizeVoiceAttemptQualityMetrics(value.quality),
      reliabilityFlags: normalizeVoiceStringList(value.reliabilityFlags, 6, 80),
    };

    return hasMeaningfulVoiceValues(normalized, ['measurementRejectionReasons', 'reliabilityFlags']) || hasUnknownVoiceKeys(value, new Set([
      'sampleCount',
      'voicedFramePct',
      'confidentFramePct',
      'scoreConfidence',
      'measurementAvailable',
      'measurementRejectionReasons',
      'pitchValidFrameCount',
      'hnrValidFrameCount',
      'hnrVoicedCoveragePct',
      'captureReliability',
      'noiseFloorDb',
      'snrDb',
      'clippingPct',
      'meanLoudnessDb',
      'peakLoudnessDb',
      'loudnessRangeDb',
      'medianPitchHz',
      'pitchP10Hz',
      'pitchP90Hz',
      'pitchStdSt',
      'phraseStartPitchHz',
      'phraseEndPitchHz',
      'phraseEndDropHz',
      'pitchDriftSt',
      'pitchTargetOccupancyPct',
      'phraseFinalDropSemitones',
      'spectralCentroidMeanHz',
      'spectralTiltMeanDbPerOct',
      'harmonicRatioMean',
      'stabilityMean',
      'metricSimilarity',
      'contourSimilarity',
      'formantLite',
      'quality',
      'reliabilityFlags',
    ]))
      ? normalized
      : null;
  }

  function normalizeVoiceAttemptFormantLiteMetrics(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      f1MedianHz: normalizeVoiceFiniteNumber(value.f1MedianHz, 2),
      f2MedianHz: normalizeVoiceFiniteNumber(value.f2MedianHz, 2),
      frontnessScore: normalizeVoiceConfidence(value.frontnessScore),
      frontnessShift: normalizeVoiceFiniteNumber(value.frontnessShift, 3),
    };

    return hasMeaningfulVoiceValues(normalized) || hasUnknownVoiceKeys(value, new Set([
      'f1MedianHz',
      'f2MedianHz',
      'frontnessScore',
      'frontnessShift',
    ]))
      ? normalized
      : null;
  }

  function normalizeVoiceAttemptQualityMetrics(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      cppsLike: normalizeVoiceFiniteNumber(value.cppsLike, 2),
      harmonicStrength: normalizeVoiceFiniteNumber(value.harmonicStrength, 2),
      breathyRisk: normalizeVoiceConfidence(value.breathyRisk),
      strainRisk: normalizeVoiceConfidence(value.strainRisk),
    };

    return hasMeaningfulVoiceValues(normalized) || hasUnknownVoiceKeys(value, new Set([
      'cppsLike',
      'harmonicStrength',
      'breathyRisk',
      'strainRisk',
    ]))
      ? normalized
      : null;
  }

  function normalizeVoiceAttemptMetrics(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      meanPitchHz: normalizeVoiceFiniteNumber(value.meanPitchHz, 2),
      pitchRangeSt: normalizeVoiceFiniteNumber(value.pitchRangeSt, 2),
      resonanceMean: normalizeVoiceConfidence(value.resonanceMean),
      weightMean: normalizeVoiceConfidence(value.weightMean),
      targetHitPct: normalizeVoiceConfidence(value.targetHitPct),
      similarityScore: normalizeVoiceConfidence(value.similarityScore),
      advanced: normalizeVoiceAttemptAdvancedMetrics(value.advanced),
    };

    return hasMeaningfulVoiceValues(normalized) || hasUnknownVoiceKeys(value, new Set([
      'meanPitchHz',
      'pitchRangeSt',
      'resonanceMean',
      'weightMean',
      'targetHitPct',
      'similarityScore',
      'advanced',
    ]))
      ? normalized
      : null;
  }

  function normalizeVoiceAttemptTarget(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      source: normalizeVoiceText(value.source, 80),
      targetPreset: normalizeVoiceText(value.targetPreset, 80),
      targetProfileId: normalizeVoiceText(value.targetProfileId, 160),
      // 2026-07-26 MTF-ONLY: 'masculine' is retired, so a stored masculine
      // profile normalizes to null (direction unknown) via the existing
      // unrecognized-value path rather than being remapped to a direction the
      // learner did not choose.
      direction: ['feminine', 'neutral'].includes(value.direction)
        ? value.direction
        : null,
      pitchFloorHz: normalizeVoiceFiniteNumber(value.pitchFloorHz, 2),
      pitchCeilingHz: normalizeVoiceFiniteNumber(value.pitchCeilingHz, 2),
      resonanceFloor: normalizeVoiceConfidence(value.resonanceFloor),
      resonanceCeiling: normalizeVoiceConfidence(value.resonanceCeiling),
      weightFloor: normalizeVoiceConfidence(value.weightFloor),
      weightCeiling: normalizeVoiceConfidence(value.weightCeiling),
      minTargetHitPct: normalizeVoiceConfidence(value.minTargetHitPct),
      minSimilarityScore: normalizeVoiceConfidence(value.minSimilarityScore),
      minResonance: normalizeVoiceConfidence(value.minResonance),
      maxWeight: normalizeVoiceConfidence(value.maxWeight),
      minPitchRangeSt: normalizeVoiceFiniteNumber(value.minPitchRangeSt, 2),
      f2FloorHz: normalizeVoiceFiniteNumber(value.f2FloorHz, 2),
      referenceMeanPitchHz: normalizeVoiceFiniteNumber(value.referenceMeanPitchHz, 2),
      referenceResonanceMean: normalizeVoiceConfidence(value.referenceResonanceMean),
      referenceWeightMean: normalizeVoiceConfidence(value.referenceWeightMean),
      referenceF2MedianHz: normalizeVoiceFiniteNumber(value.referenceF2MedianHz, 2),
      pitchPlacement: ['below', 'in_band', 'above'].includes(value.pitchPlacement)
        ? value.pitchPlacement
        : null,
      pitchGapHz: normalizeVoiceFiniteNumber(value.pitchGapHz, 2),
      resonanceGap: normalizeVoiceFiniteNumber(value.resonanceGap, 3),
      weightGap: normalizeVoiceFiniteNumber(value.weightGap, 3),
    };

    return hasMeaningfulVoiceValues(normalized) ? normalized : null;
  }

  function normalizeVoiceAttemptSummary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      voiceSessionId: normalizeVoiceText(value.voiceSessionId, 120),
      durationMs: Number.isFinite(Number(value.durationMs)) ? Math.max(0, Math.round(Number(value.durationMs))) : null,
      transcript: normalizeVoiceText(value.transcript, 400),
      targetPreset: normalizeVoiceText(value.targetPreset, 80),
      metrics: normalizeVoiceAttemptMetrics(value.metrics),
      target: normalizeVoiceAttemptTarget(value.target),
      issues: normalizeVoiceStringList(value.issues, 6, 200),
      nextDrills: normalizeVoiceStringList(value.nextDrills, 6, 200),
      analysisVersion: normalizeVoiceAnalysisVersion(value.analysisVersion),
    };

    return hasMeaningfulVoiceValues(normalized, ['issues', 'nextDrills']) || hasUnknownVoiceKeys(value, new Set([
      'voiceSessionId',
      'durationMs',
      'transcript',
      'targetPreset',
      'metrics',
      'target',
      'issues',
      'nextDrills',
      'analysisVersion',
    ]))
      ? normalized
      : null;
  }

  function normalizeVoiceAttemptArtifact(value, fallbackSummary = null) {
    const source = value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
    const summary = normalizeVoiceAttemptSummary(source.summary || source.attemptSummary || fallbackSummary);
    if (!summary && Object.keys(source).length === 0) {
      return null;
    }

    const phraseComparisonSource = source.phraseComparison || source.phrase_comparison || null;
    const normalized = {
      ...source,
      attemptArtifactId: normalizeVoiceText(source.attemptArtifactId || source.attempt_artifact_id, 160),
      attemptId: resolveVoiceAttemptArtifactId(source, summary),
      clientAttemptId: normalizeVoiceText(source.clientAttemptId || source.client_attempt_id, 160),
      voiceSessionId: normalizeVoiceText(source.voiceSessionId || source.voice_session_id || summary?.voiceSessionId, 120),
      sloaneSessionId: normalizeVoiceText(source.sloaneSessionId || source.sloane_session_id, 120),
      reason: normalizeVoiceText(source.reason, 200),
      status: normalizeVoiceText(source.status, 80),
      createdAt: normalizeVoiceArtifactTimestamp(source.createdAt || source.created_at),
      endedAt: normalizeVoiceArtifactTimestamp(
        source.endedAt || source.ended_at || source.finalizedAt || source.finalized_at,
      ),
      finalizedAt: normalizeVoiceArtifactTimestamp(source.finalizedAt || source.finalized_at),
      targetPreset: normalizeVoiceText(source.targetPreset || source.target_preset || summary?.targetPreset, 80),
      metrics: normalizeVoiceAttemptMetrics(source.metrics || summary?.metrics),
      referenceClipId: normalizeVoiceText(source.referenceClipId || source.reference_clip_id, 120),
      lessonId: normalizeVoiceText(source.lessonId || source.lesson_id, 120),
      summary,
      repContext: normalizeVoiceAttemptSidePayload(source.repContext ?? source.rep_context),
      selfReport: normalizeVoiceSelfReportPayload(source.selfReport ?? source.self_report),
      phraseComparison: deps.normalizePhraseComparison
        ? deps.normalizePhraseComparison(phraseComparisonSource)
        : phraseComparisonSource,
      timeline: normalizeVoiceDetailedTimeline(
        source.timeline || source.lastTakeTimeline || source.last_take_timeline,
        80,
      ),
    };

    return hasMeaningfulVoiceValues(normalized, ['timeline']) || summary
      ? normalized
      : null;
  }

  function getVoiceAttemptArtifactKey(artifact, fallbackIndex = 0) {
    if (artifact?.attemptId) {
      return `attempt:${artifact.attemptId}`;
    }
    if (artifact?.attemptArtifactId) {
      return `artifact:${artifact.attemptArtifactId}`;
    }
    if (artifact?.clientAttemptId) {
      return `client:${artifact.clientAttemptId}`;
    }
    const voiceSessionId = artifact?.voiceSessionId || artifact?.summary?.voiceSessionId || '';
    const timestamp = artifact?.endedAt || artifact?.createdAt || '';
    if (voiceSessionId || timestamp) {
      return `session:${voiceSessionId}:${timestamp}`;
    }
    const fingerprint = hashVoiceAttemptFingerprint(artifact?.summary);
    return fingerprint ? `summary:${fingerprint}` : `index:${fallbackIndex}`;
  }

  function normalizeVoiceAttemptArtifactList(value, lastAttemptArtifact = null) {
    const entries = Array.isArray(value)
      ? value
          .map((artifact) => normalizeVoiceAttemptArtifact(artifact))
          .filter(Boolean)
      : [];
    const normalizedLastArtifact = normalizeVoiceAttemptArtifact(lastAttemptArtifact);
    if (normalizedLastArtifact) {
      entries.push(normalizedLastArtifact);
    }

    const deduped = new Map();
    entries.forEach((artifact, index) => {
      deduped.set(getVoiceAttemptArtifactKey(artifact, index), artifact);
    });
    return Array.from(deduped.values()).slice(-VOICE_ATTEMPT_ARTIFACT_LIMIT);
  }

  function normalizeVoiceAttemptIdList(value) {
    const ids = Array.isArray(value)
      ? value
          .map((item) => normalizeVoiceText(item, 160))
          .filter(Boolean)
      : [];
    return Array.from(new Set(ids)).slice(-VOICE_STUDENT_MODEL_ATTEMPT_ID_LIMIT);
  }

  function normalizeVoiceTargetAdvancedBands(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      pitchP10HzFloor: normalizeVoiceFiniteNumber(value.pitchP10HzFloor, 2),
      pitchP90HzCeiling: normalizeVoiceFiniteNumber(value.pitchP90HzCeiling, 2),
      pitchStdStCeiling: normalizeVoiceFiniteNumber(value.pitchStdStCeiling, 3),
      phraseEndDropHzCeiling: normalizeVoiceFiniteNumber(value.phraseEndDropHzCeiling, 2),
      spectralCentroidFloorHz: normalizeVoiceFiniteNumber(value.spectralCentroidFloorHz, 2),
      spectralTiltFloorDbPerOct: normalizeVoiceFiniteNumber(value.spectralTiltFloorDbPerOct, 3),
      harmonicRatioFloor: normalizeVoiceConfidence(value.harmonicRatioFloor),
      stabilityFloor: normalizeVoiceConfidence(value.stabilityFloor),
      voicedFramePctFloor: normalizeVoiceConfidence(value.voicedFramePctFloor),
      formantLite: normalizeVoiceTargetFormantLiteBands(value.formantLite),
      quality: normalizeVoiceTargetQualityBands(value.quality),
    };

    return hasMeaningfulVoiceValues(normalized) || hasUnknownVoiceKeys(value, new Set([
      'pitchP10HzFloor',
      'pitchP90HzCeiling',
      'pitchStdStCeiling',
      'phraseEndDropHzCeiling',
      'spectralCentroidFloorHz',
      'spectralTiltFloorDbPerOct',
      'harmonicRatioFloor',
      'stabilityFloor',
      'voicedFramePctFloor',
      'formantLite',
      'quality',
    ]))
      ? normalized
      : null;
  }

  function normalizeVoiceTargetFormantLiteBands(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      f2FloorHz: normalizeVoiceFiniteNumber(value.f2FloorHz, 2),
      frontnessFloor: normalizeVoiceConfidence(value.frontnessFloor),
    };

    return hasMeaningfulVoiceValues(normalized) || hasUnknownVoiceKeys(value, new Set([
      'f2FloorHz',
      'frontnessFloor',
    ]))
      ? normalized
      : null;
  }

  function normalizeVoiceTargetQualityBands(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      cppsLikeFloor: normalizeVoiceFiniteNumber(value.cppsLikeFloor, 2),
      harmonicStrengthFloor: normalizeVoiceFiniteNumber(value.harmonicStrengthFloor, 2),
      breathyRiskCeiling: normalizeVoiceConfidence(value.breathyRiskCeiling),
      strainRiskCeiling: normalizeVoiceConfidence(value.strainRiskCeiling),
    };

    return hasMeaningfulVoiceValues(normalized) || hasUnknownVoiceKeys(value, new Set([
      'cppsLikeFloor',
      'harmonicStrengthFloor',
      'breathyRiskCeiling',
      'strainRiskCeiling',
    ]))
      ? normalized
      : null;
  }

  function normalizeVoiceTargetProfile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      profileId: normalizeVoiceText(value.profileId, 120),
      clipId: normalizeVoiceText(value.clipId, 120),
      sourceFilename: normalizeVoiceText(value.sourceFilename, 200),
      durationMs: Number.isFinite(Number(value.durationMs)) ? Math.max(0, Math.round(Number(value.durationMs))) : null,
      targetPreset: normalizeVoiceText(value.targetPreset, 80),
      metrics: normalizeVoiceAttemptMetrics(value.metrics),
      pitchFloorHz: normalizeVoiceFiniteNumber(value.pitchFloorHz, 2),
      pitchCeilingHz: normalizeVoiceFiniteNumber(value.pitchCeilingHz, 2),
      resonanceFloor: normalizeVoiceConfidence(value.resonanceFloor),
      resonanceCeiling: normalizeVoiceConfidence(value.resonanceCeiling),
      weightFloor: normalizeVoiceConfidence(value.weightFloor),
      weightCeiling: normalizeVoiceConfidence(value.weightCeiling),
      stylePrompt: normalizeVoiceText(value.stylePrompt, 240),
      notes: normalizeVoiceStringList(value.notes, 6, 240),
      advancedBands: normalizeVoiceTargetAdvancedBands(value.advancedBands),
      analysisVersion: normalizeVoiceAnalysisVersion(value.analysisVersion),
    };

    return hasMeaningfulVoiceValues(normalized, ['notes']) || hasUnknownVoiceKeys(value, new Set([
      'profileId',
      'clipId',
      'sourceFilename',
      'durationMs',
      'targetPreset',
      'metrics',
      'pitchFloorHz',
      'pitchCeilingHz',
      'resonanceFloor',
      'resonanceCeiling',
      'weightFloor',
      'weightCeiling',
      'stylePrompt',
      'notes',
      'advancedBands',
      'analysisVersion',
    ]))
      ? normalized
      : null;
  }

  function normalizeVoiceReferenceAnalysis(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      clipId: normalizeVoiceText(value.clipId, 120),
      filename: normalizeVoiceText(value.filename, 200),
      durationMs: Number.isFinite(Number(value.durationMs)) ? Math.max(0, Math.round(Number(value.durationMs))) : null,
      metrics: normalizeVoiceAttemptMetrics(value.metrics),
      timeline: normalizeVoiceDetailedTimeline(value.timeline),
      analysisVersion: normalizeVoiceAnalysisVersion(value.analysisVersion),
    };

    return hasMeaningfulVoiceValues(normalized, ['timeline']) || hasUnknownVoiceKeys(value, new Set([
      'clipId',
      'filename',
      'durationMs',
      'metrics',
      'timeline',
      'analysisVersion',
    ]))
      ? normalized
      : null;
  }

  function normalizeVoicePhraseForecastState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const normalized = {
      ...value,
      profileId: normalizeVoiceText(value.profileId, 120),
      clipId: normalizeVoiceText(value.clipId, 120),
      phrase: normalizeVoiceText(value.phrase, 400),
      targetPreset: normalizeVoiceText(value.targetPreset, 80),
      estimatedDurationMs: Number.isFinite(Number(value.estimatedDurationMs))
        ? Math.max(0, Math.round(Number(value.estimatedDurationMs)))
        : null,
      metrics: normalizeVoiceAttemptMetrics(value.metrics),
      timeline: normalizeVoiceDetailedTimeline(value.timeline),
      summary: normalizeVoiceText(value.summary, 400),
      notes: normalizeVoiceStringList(value.notes, 6, 240),
      analysisVersion: normalizeVoiceAnalysisVersion(value.analysisVersion),
    };

    return hasMeaningfulVoiceValues(normalized, ['notes']) || hasUnknownVoiceKeys(value, new Set([
      'profileId',
      'clipId',
      'phrase',
      'targetPreset',
      'estimatedDurationMs',
      'metrics',
      'timeline',
      'summary',
      'notes',
      'cueSheet',
      'analysisVersion',
    ]))
      ? normalized
      : null;
  }

  /**
   * 2026-07-26 phase C: normalize `voiceState.sectionLoop`.
   *
   * Bounded and fail-closed — a loop that cannot be fully reconstructed returns
   * null, which the transition table reads as "no isolation is running" and the
   * runtime reads as "the full-sentence card is authoritative". That is the safe
   * direction: a half-restored loop would leave a fragment card on screen with no
   * state to ever close it.
   *
   * The clamps trace to coaching/section-loop.js (imported at the top of this file),
   * never to local literals.
   */
  /**
   * The engine's one-shot take-kind prescription (2026-07-26 field repair).
   *
   * Fail-closed: a prescription with no readable `kind` is not a prescription,
   * so it normalizes to null rather than to a partial object the resolver would
   * then have to defend against. `lessonId` is kept verbatim (including null)
   * because the runtime compares it against the session's CURRENT lessonId to
   * expire a prescription the learner has moved past.
   */
  function normalizeVoicePendingTakeKind(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const kind = normalizeVoiceText(value.kind, 40);
    const prescriptionId = normalizeVoiceText(value.prescriptionId, 160);
    // Pre-identity persisted prescriptions cannot be consumed safely: without
    // an exact ID an old take cannot be distinguished from a replacement
    // prescription of the same kind. Drop them once during normalization.
    if (!kind || !prescriptionId) return null;
    return {
      prescriptionId,
      kind,
      drillId: normalizeVoiceText(value.drillId, 120) || null,
      lessonId: normalizeVoiceText(value.lessonId, 120) || null,
      stampedAt: Number.isFinite(Number(value.stampedAt)) ? Math.round(Number(value.stampedAt)) : null,
    };
  }

  /**
   * The cue the last coach turn gave (2026-07-30 cue carry-forward).
   *
   * Fail-closed in exactly the same shape as its `pendingTakeKind` neighbour
   * above: a record with no cue ID is not a cue anything can NAME later, so it
   * normalizes to null rather than to a partial object the win composer would
   * then have to defend against. `instruction` is kept because the id alone is
   * meaningless to any consumer that does not carry the same lookup table; it
   * shares normalizeVoiceText's 240-char default, which every built-in drill
   * instruction fits with room for the practice-line tail splice.
   */
  function normalizeVoiceLastCueGiven(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const id = normalizeVoiceText(value.id, 120);
    if (!id) return null;
    return {
      id,
      axis: normalizeVoiceText(value.axis, 60),
      instruction: normalizeVoiceText(value.instruction, 240) || '',
    };
  }

  function normalizeVoiceSectionLoopState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const axis = SECTION_LOOP_AXES.includes(value.axis) ? value.axis : null;
    if (!axis) return null;

    const fragmentTokens = (Array.isArray(value.fragmentTokens) ? value.fragmentTokens : [])
      .map((token) => normalizeVoiceText(token, 40))
      .filter(Boolean)
      .slice(0, SECTION_LOOP_MAX_FRAGMENT_TOKENS);
    const fragmentText = fragmentTokens.length > 0
      ? fragmentTokens.join(' ')
      : normalizeVoiceText(value.fragmentText, 120);
    if (!fragmentText) return null;

    const maxAttempts = Number.isFinite(Number(value.maxAttempts))
      ? Math.max(1, Math.min(SECTION_LOOP_MAX_ATTEMPTS, Math.round(Number(value.maxAttempts))))
      : SECTION_LOOP_MAX_ATTEMPTS;

    return {
      phrase: normalizeVoiceText(value.phrase, 120),
      tokenStart: Number.isFinite(Number(value.tokenStart)) ? Math.max(0, Math.round(Number(value.tokenStart))) : 0,
      tokenEnd: Number.isFinite(Number(value.tokenEnd)) ? Math.max(0, Math.round(Number(value.tokenEnd))) : 0,
      fragmentText,
      fragmentTokens: fragmentTokens.length > 0
        ? fragmentTokens
        : fragmentText.split(/\s+/).filter(Boolean).slice(0, SECTION_LOOP_MAX_FRAGMENT_TOKENS),
      axis,
      direction: value.direction === 'under' || value.direction === 'over' ? value.direction : null,
      attempts: Number.isFinite(Number(value.attempts))
        ? Math.max(0, Math.min(maxAttempts, Math.round(Number(value.attempts))))
        : 0,
      maxAttempts,
      enteredAt: normalizeVoiceArtifactTimestamp(value.enteredAt),
      lastCueId: normalizeVoiceText(value.lastCueId, 60) || null,
      // Bounded at twice the cap: the loop can never spend more cues than attempts,
      // so anything longer is corrupt state and is simply truncated.
      usedCueIds: [...new Set((Array.isArray(value.usedCueIds) ? value.usedCueIds : [])
        .map((id) => normalizeVoiceText(id, 60))
        .filter(Boolean))].slice(0, SECTION_LOOP_MAX_ATTEMPTS * 2),
      lastTakeKey: normalizeVoiceText(value.lastTakeKey, 160) || null,
    };
  }

  function normalizeVoiceInputRuntimeVadState(value) {
    return ['idle', 'waiting', 'speech', 'processing'].includes(value)
      ? value
      : null;
  }

  function normalizeVoiceInputRuntimeState(value) {
    const normalized = buildDefaultVoiceInputRuntimeState(value || {});
    normalized.status = normalizeVoiceInputRuntimeStatus(normalized.status);
    normalized.lastOutcome = normalizeVoiceInputRuntimeOutcome(normalized.lastOutcome);
    normalized.requestedProvider = normalizeVoiceCoachInputProvider(normalized.requestedProvider);
    normalized.effectiveProvider = normalizeVoiceCoachOptionalInputProvider(normalized.effectiveProvider);
    normalized.captureProvider = normalizeVoiceCoachOptionalInputProvider(normalized.captureProvider);
    normalized.providerStyle = normalizeVoiceInputRuntimeText(normalized.providerStyle, 80);
    normalized.transcriptSource = normalizeVoiceInputRuntimeText(normalized.transcriptSource, 80);
    normalized.lastTranscript = normalizeVoiceInputRuntimeText(normalized.lastTranscript, 240);
    normalized.lastTranscriptConfidence = normalizeVoiceCoachInputConfidence(normalized.lastTranscriptConfidence);
    normalized.lastCaptureStartedAt = normalizeVoiceInputRuntimeTimestamp(normalized.lastCaptureStartedAt);
    normalized.lastSpeechDetectedAt = normalizeVoiceInputRuntimeTimestamp(normalized.lastSpeechDetectedAt);
    normalized.lastCapturedAt = normalizeVoiceInputRuntimeTimestamp(normalized.lastCapturedAt);
    normalized.lastProcessedAt = normalizeVoiceInputRuntimeTimestamp(normalized.lastProcessedAt);
    normalized.previousInputTurnAt = normalizeVoiceInputRuntimeTimestamp(normalized.previousInputTurnAt);
    normalized.lastCaptureDurationMs = normalizeVoiceInputRuntimeDuration(normalized.lastCaptureDurationMs);
    normalized.lastRoundTripMs = normalizeVoiceInputRuntimeDuration(normalized.lastRoundTripMs);
    normalized.successfulTurns = normalizeVoiceInputRuntimeCount(normalized.successfulTurns);
    normalized.noSpeechTurns = normalizeVoiceInputRuntimeCount(normalized.noSpeechTurns);
    normalized.errorCount = normalizeVoiceInputRuntimeCount(normalized.errorCount);
    normalized.consecutiveNoSpeechTurns = normalizeVoiceInputRuntimeCount(normalized.consecutiveNoSpeechTurns);
    normalized.consecutiveErrorTurns = normalizeVoiceInputRuntimeCount(normalized.consecutiveErrorTurns);
    normalized.liveSessionId = normalizeVoiceInputRuntimeText(normalized.liveSessionId, 120);
    normalized.lastSegmentId = normalizeVoiceInputRuntimeText(normalized.lastSegmentId, 120);
    normalized.liveEngine = normalizeVoiceInputRuntimeText(normalized.liveEngine, 120);
    normalized.liveInterimMode = normalizeVoiceInputRuntimeText(normalized.liveInterimMode, 40);
    normalized.liveVadStrategy = normalizeVoiceInputRuntimeText(normalized.liveVadStrategy, 40);
    normalized.providerTarget = normalizeVoiceInputRuntimeText(normalized.providerTarget, 160);
    normalized.providerModel = normalizeVoiceInputRuntimeText(normalized.providerModel, 120);
    normalized.providerLanguage = normalizeVoiceInputRuntimeText(normalized.providerLanguage, 40);
    normalized.providerEndpointing = normalizeVoiceInputRuntimeText(normalized.providerEndpointing, 160);
    normalized.lastPartialTranscript = normalizeVoiceInputRuntimeText(normalized.lastPartialTranscript, 240);
    normalized.lastPartialTranscriptAt = normalizeVoiceInputRuntimeTimestamp(normalized.lastPartialTranscriptAt);
    normalized.lastVadState = normalizeVoiceInputRuntimeVadState(normalized.lastVadState);
    normalized.lastBargeInAt = normalizeVoiceInputRuntimeTimestamp(normalized.lastBargeInAt);
    normalized.lastAnalysisSummary = normalizeVoiceInputRuntimeText(normalized.lastAnalysisSummary, 240);
    normalized.lastAnalysisDurationMs = normalizeVoiceInputRuntimeDuration(normalized.lastAnalysisDurationMs);
    normalized.lastAverageLevelDb = normalizeVoiceInputRuntimeNumber(normalized.lastAverageLevelDb);
    normalized.lastPeakLevelDb = normalizeVoiceInputRuntimeNumber(normalized.lastPeakLevelDb);
    normalized.lastNoiseFloorDb = normalizeVoiceInputRuntimeNumber(normalized.lastNoiseFloorDb);
    normalized.lastSnrDb = normalizeVoiceInputRuntimeNumber(normalized.lastSnrDb);
    normalized.lastClippingPct = normalizeVoiceConfidence(normalized.lastClippingPct);
    normalized.lastCaptureReliability = normalizeVoiceConfidence(normalized.lastCaptureReliability);
    normalized.lastReliabilityFlags = normalizeVoiceStringList(normalized.lastReliabilityFlags, 6, 80);
    normalized.lastSpeechDurationMs = normalizeVoiceInputRuntimeDuration(normalized.lastSpeechDurationMs);
    normalized.lastAudioProcessedMs = normalizeVoiceInputRuntimeDuration(normalized.lastAudioProcessedMs);
    normalized.lastError = normalizeVoiceInputRuntimeText(normalized.lastError, 200);
    normalized.lastEventAt = normalizeVoiceInputRuntimeTimestamp(normalized.lastEventAt);
    return normalized;
  }

  function normalizeVoicePracticeLine(line, targetPreset = 'cute-feminine') {
    if (!line || typeof line !== 'object' || Array.isArray(line)) {
      return null;
    }

    const displayText = typeof line.displayText === 'string' ? line.displayText.trim() : '';
    if (!displayText) {
      return null;
    }

    const cueSheet = line.cueSheet || buildVoiceCueSheet({
      phrase: displayText,
      targetPreset,
      focus: Array.isArray(line.teachingFocus) ? line.teachingFocus.join(' ') : '',
      description: typeof line.intent === 'string' ? line.intent : '',
      cues: Array.isArray(line.teachingFocus) ? line.teachingFocus : [],
    });
    const id = typeof line.id === 'string' && line.id.trim() ? line.id.trim() : `voice-line-${createVoiceCoachMessageId('line')}`;
    const difficulty = ['easy', 'medium', 'hard'].includes(line.difficulty) ? line.difficulty : 'medium';
    const performanceText = typeof line.performanceText === 'string' && line.performanceText.trim()
      ? line.performanceText.trim()
      : cueSheet?.styledCueLine || cueSheet?.cueLine || displayText;

    return {
      id,
      displayText,
      performanceText,
      intent: typeof line.intent === 'string' && line.intent.trim() ? line.intent.trim() : cueSheet?.phraseIntent || 'guided practice',
      difficulty,
      targetPreset: typeof line.targetPreset === 'string' && line.targetPreset.trim() ? line.targetPreset.trim() : targetPreset,
      teachingFocus: Array.isArray(line.teachingFocus)
        ? line.teachingFocus.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
        : Array.isArray(cueSheet?.teachingFocus)
          ? cueSheet.teachingFocus.slice(0, 6)
          : [],
      source: typeof line.source === 'string' && line.source.trim() ? line.source.trim() : 'generated',
      referenceMode: typeof line.referenceMode === 'string' && line.referenceMode.trim() ? line.referenceMode.trim() : 'self-guided',
      cueSheet: line.cueSheet || cueSheet || null,
      pinned: Boolean(line.pinned),
    };
  }

  function normalizeVoiceState(voiceState) {
    if (!voiceState || typeof voiceState !== 'object' || Array.isArray(voiceState)) {
      return buildDefaultVoiceState();
    }
    const normalized = buildDefaultVoiceState(voiceState);
    normalized.lastTakeTimeline = normalizeVoiceDetailedTimeline(normalized.lastTakeTimeline);
    normalized.lastSummary = normalizeVoiceAttemptSummary(normalized.lastSummary);
    normalized.lastAttemptArtifact = normalizeVoiceAttemptArtifact(normalized.lastAttemptArtifact, normalized.lastSummary);
    normalized.lastTakeFinalizedAt = normalizeVoiceArtifactTimestamp(normalized.lastTakeFinalizedAt);
    normalized.recentDrillIds = Array.isArray(normalized.recentDrillIds)
      ? [...new Set(normalized.recentDrillIds.map((id) => normalizeVoiceText(id, 120)).filter(Boolean))]
        .slice(0, RECENTLY_PRESCRIBED_MEMORY)
      : [];
    normalized.attemptArtifacts = normalizeVoiceAttemptArtifactList(
      normalized.attemptArtifacts,
      normalized.lastAttemptArtifact,
    );
    normalized.studentModelAttemptIds = normalizeVoiceAttemptIdList(normalized.studentModelAttemptIds);
    normalized.sectionLoop = normalizeVoiceSectionLoopState(normalized.sectionLoop);
    normalized.targetMetric = normalizeTargetMetricSessionState(normalized.targetMetric);
    normalized.practiceProgression = normalizeSentenceProgression(normalized.practiceProgression);
    normalized.sectionLoopLastTakeKey = normalizeVoiceText(normalized.sectionLoopLastTakeKey, 160) || null;
    normalized.pendingTakeKind = normalizeVoicePendingTakeKind(normalized.pendingTakeKind);
    normalized.lastCueGiven = normalizeVoiceLastCueGiven(normalized.lastCueGiven);
    normalized.referenceAnalysis = normalizeVoiceReferenceAnalysis(normalized.referenceAnalysis);
    normalized.targetVoiceProfile = normalizeVoiceTargetProfile(normalized.targetVoiceProfile);
    normalized.phraseForecast = normalizeVoicePhraseForecastState(normalized.phraseForecast);
    normalized.phraseForecast = deps.decorateVoicePhraseForecast
      ? deps.decorateVoicePhraseForecast(
          normalized.phraseForecast,
          normalized.targetPreset || 'cute-feminine',
          normalized.targetVoiceProfile || null,
        )
      : normalized.phraseForecast;
    normalized.phraseComparison = deps.normalizePhraseComparison
      ? deps.normalizePhraseComparison(normalized.phraseComparison)
      : normalized.phraseComparison;
    normalized.activeLine = normalizeVoicePracticeLine(normalized.activeLine, normalized.targetPreset || 'cute-feminine');
    normalized.lineQueue = Array.isArray(normalized.lineQueue)
      ? normalized.lineQueue
          .map((line) => normalizeVoicePracticeLine(line, normalized.targetPreset || 'cute-feminine'))
          .filter(Boolean)
      : [];
    normalized.phraseComparison = getRenderableVoicePhraseComparison({
      phraseComparison: normalized.phraseComparison,
      lessonId: normalized.lessonId || null,
      activePhrase: resolveActiveVoicePhrase({
        activeLine: normalized.activeLine,
        forecastPhrase: normalized.forecastPhrase,
        phraseForecast: normalized.phraseForecast,
      }),
    });
    normalized.lineDifficultyPreference = normalizeDifficultyPreference(normalized.lineDifficultyPreference);
    normalized.coachThread = Array.isArray(normalized.coachThread)
      ? normalized.coachThread
          .map((message) => normalizeVoiceCoachMessage(message))
          .filter(Boolean)
          .slice(-12)
      : [];
    normalized.coachVoice = normalizeVoiceCoachVoiceState(normalized.coachVoice);
    normalized.voiceInputRuntime = normalizeVoiceInputRuntimeState(normalized.voiceInputRuntime);
    normalized.voiceConditioning = normalizeVoiceConditioningState(normalized.voiceConditioning);
    normalized.advancedPanel = normalizeVoiceAdvancedPanelState(normalized.advancedPanel);
    return normalized;
  }

  function buildVoiceSessionSummary(voiceState) {
    const nextVoiceState = normalizeVoiceState(voiceState);
    const parts = ['Voice training'];

    if (nextVoiceState.targetPreset) {
      parts.push(nextVoiceState.selectedCustomPresetName || nextVoiceState.targetPreset);
    }

    if (nextVoiceState.targetSource && nextVoiceState.targetSource !== 'built-in') {
      parts.push(nextVoiceState.targetSource);
    }

    if (nextVoiceState.lessonId) {
      const drill = getVoiceDrillById(nextVoiceState.targetPreset, nextVoiceState.lessonId);
      if (drill?.title) {
        parts.push(drill.title);
      }
    }

    if (nextVoiceState.referenceClipName) {
      parts.push(`ref ${nextVoiceState.referenceClipName}`);
    }

    const summary = nextVoiceState.lastSummary || nextVoiceState.lastAttemptArtifact?.summary || null;
    const targetHitPct = summary?.metrics?.targetHitPct;
    const measurementUsable = resolveVoiceMeasurementUsability(summary?.metrics?.advanced || {}).usableForScoring;
    if (measurementUsable && typeof targetHitPct === 'number') {
      parts.push(`${Math.round(targetHitPct * 100)}% target`);
    } else if (measurementUsable && Array.isArray(summary?.issues) && summary.issues.length > 0) {
      parts.push(summary.issues[0]);
    }

    if (measurementUsable && Number.isFinite(nextVoiceState.phraseComparison?.pathMatchScore)) {
      parts.push(`phrase ${Math.round(nextVoiceState.phraseComparison.pathMatchScore * 100)}%`);
    }

    return parts.join(' • ');
  }

  function updateSessionVoiceState(session, updates = {}) {
    if (!session) {
      return buildDefaultVoiceState(updates);
    }

    session.voiceState = normalizeVoiceState({
      ...(session.voiceState || {}),
      ...updates,
    });

    if (session.agentId === 'voice') {
      session.summary = buildVoiceSessionSummary(session.voiceState);
    }

    return session.voiceState;
  }

  function updateSessionDeepTutorVoiceState(session, updates = {}) {
    const nextState = normalizeDeepTutorVoiceState({
      ...(session?.deeptutorVoiceState || {}),
      ...updates,
    });

    if (!session) {
      return nextState;
    }

    session.deeptutorVoiceState = nextState;
    return session.deeptutorVoiceState;
  }

  async function resolveVoiceRealtimeCoachModel(session) {
    const deeptutorVoiceState = typeof normalizeDeepTutorVoiceState === 'function'
      ? normalizeDeepTutorVoiceState(session?.deeptutorVoiceState)
      : (session?.deeptutorVoiceState || null);
    const backendModelId = typeof deeptutorVoiceState?.backendModelId === 'string'
      && deeptutorVoiceState.backendModelId.trim()
      ? deeptutorVoiceState.backendModelId.trim()
      : '';
    if (backendModelId) {
      return backendModelId;
    }

    try {
      if (typeof resolveValidatedSessionModel === 'function') {
        const resolved = await resolveValidatedSessionModel('voice');
        if (resolved?.model) {
          return resolved.model;
        }
      }
    } catch (error) {
      if (logger && typeof logger.warn === 'function') {
        logger.warn(`[Voice] Falling back to session model for realtime coach: ${error.message}`);
      }
    }

    const normalizedSessionModel = typeof normalizeRequestedModel === 'function'
      ? normalizeRequestedModel(session?.model)
      : (typeof session?.model === 'string' && session.model.trim() ? session.model.trim() : null);
    return normalizedSessionModel || (
      typeof getCachedDefaultModelId === 'function'
        ? getCachedDefaultModelId()
        : null
    );
  }

  function appendDeepTutorVoiceThread(session, {
    userMessage = '',
    coachMessage = '',
    userKind = 'follow-up-question',
    coachKind = 'deeptutor-note',
  } = {}) {
    if (typeof appendVoiceCoachThreadMessage !== 'function') {
      throw new Error('appendVoiceCoachThreadMessage dependency is required for appendDeepTutorVoiceThread');
    }

    const currentVoiceState = normalizeVoiceState(session?.voiceState);
    let nextThread = Array.isArray(currentVoiceState.coachThread) ? currentVoiceState.coachThread : [];

    if (typeof userMessage === 'string' && userMessage.trim()) {
      nextThread = appendVoiceCoachThreadMessage({
        ...currentVoiceState,
        coachThread: nextThread,
      }, 'user', userMessage.trim(), userKind);
    }

    if (typeof coachMessage === 'string' && coachMessage.trim()) {
      nextThread = appendVoiceCoachThreadMessage({
        ...currentVoiceState,
        coachThread: nextThread,
      }, 'coach', coachMessage.trim(), coachKind);
    }

    return updateSessionVoiceState(session, {
      ...currentVoiceState,
      lastCoachMessage: typeof coachMessage === 'string' && coachMessage.trim()
        ? coachMessage.trim()
        : currentVoiceState.lastCoachMessage,
      lastCoachGeneratedAt: typeof coachMessage === 'string' && coachMessage.trim()
        ? Date.now()
        : currentVoiceState.lastCoachGeneratedAt,
      coachThread: nextThread,
    });
  }

  function hasVoiceSessionActivity(session) {
    if (!session) return false;
    const voiceState = normalizeVoiceState(session.voiceState);
    const activeStatuses = new Set(['ready', 'active', 'ended', 'reference-loaded']);
    return Boolean(
      voiceState.voiceSessionId
        || voiceState.referenceClipId
        || voiceState.referenceClipName
        || voiceState.targetVoiceProfile
        || voiceState.phraseForecast
        || voiceState.forecastPhrase
        || voiceState.lastSummary
        || voiceState.lastAttemptArtifact
        || (Array.isArray(voiceState.attemptArtifacts) && voiceState.attemptArtifacts.length > 0)
        || (typeof voiceState.status === 'string' && activeStatuses.has(voiceState.status))
    );
  }

  function hasDeepTutorVoiceSessionActivity(session) {
    if (!session) return false;
    const deeptutorVoiceState = normalizeDeepTutorVoiceState(session.deeptutorVoiceState);
    return Boolean(
      deeptutorVoiceState.guideSessionId
        || deeptutorVoiceState.currentKnowledge
        || deeptutorVoiceState.lastTutorMessage
        || deeptutorVoiceState.lastUserMessage
        || deeptutorVoiceState.status !== 'idle'
        || deeptutorVoiceState.runtimeState !== 'off'
    );
  }

  function shouldPersistSession(session) {
    if (!session) return false;
    return (session.messages?.length || 0) > 0 || hasVoiceSessionActivity(session) || hasDeepTutorVoiceSessionActivity(session);
  }

  function getVoiceStudentModelId(session) {
    const explicitId = typeof session?.voiceStudentModelId === 'string'
      ? session.voiceStudentModelId.trim()
      : '';
    if (explicitId) {
      return explicitId;
    }

    const deeptutorVoiceState = typeof normalizeDeepTutorVoiceState === 'function'
      ? normalizeDeepTutorVoiceState(session?.deeptutorVoiceState)
      : (session?.deeptutorVoiceState || null);
    const deeptutorStudentId = typeof deeptutorVoiceState?.studentId === 'string'
      ? deeptutorVoiceState.studentId.trim()
      : '';
    if (deeptutorStudentId) {
      return deeptutorStudentId;
    }

    const storedStudentId = typeof session?.studentId === 'string'
      ? session.studentId.trim()
      : '';
    return storedStudentId || DEFAULT_VOICE_STUDENT_ID;
  }

  function getVoiceStudentPresetTargets(targetPreset) {
    return VOICE_STUDENT_MODEL_PRESETS[targetPreset] || VOICE_STUDENT_MODEL_PRESETS['cute-feminine'];
  }

  function formatVoiceStudentConceptName(conceptId) {
    if (!conceptId) return 'Voice skill';
    return VOICE_STUDENT_MODEL_CONCEPTS[conceptId]
      || String(conceptId)
        .replace(/^voice[_-]?/, '')
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (char) => char.toUpperCase());
  }

  function normalizeStudentModelReviewQueue(reviewQueue) {
    if (!Array.isArray(reviewQueue)) {
      return [];
    }

    return reviewQueue
      .map((item) => {
        if (Array.isArray(item)) {
          const conceptId = String(item[0] || '').trim();
          return conceptId
            ? {
                conceptId,
                name: formatVoiceStudentConceptName(conceptId),
                urgency: Number(item[1] || 0),
              }
            : null;
        }

        if (item && typeof item === 'object') {
          const conceptId = String(item.concept_id || item.conceptId || '').trim();
          return conceptId
            ? {
                conceptId,
                name: item.name || formatVoiceStudentConceptName(conceptId),
                urgency: Number(item.urgency || 0),
              }
            : null;
        }

        const conceptId = String(item || '').trim();
        return conceptId
          ? {
              conceptId,
              name: formatVoiceStudentConceptName(conceptId),
              urgency: 0,
            }
          : null;
      })
      .filter(Boolean);
  }

  function buildVoiceStudentModelEvaluations(summary, voiceState) {
    const targetPreset = summary?.targetPreset || voiceState?.targetPreset || 'cute-feminine';
    const thresholds = getVoiceStudentPresetTargets(targetPreset);
    return buildVoiceStudentModelEvaluationsPure({
      summary,
      voiceState,
      thresholds,
      concepts: VOICE_STUDENT_MODEL_CONCEPTS,
    });
  }

  return {
    appendDeepTutorVoiceThread,
    buildDefaultVoiceInputRuntimeState,
    buildDefaultVoiceState,
    buildVoiceSessionSummary,
    buildVoiceStudentModelEvaluations,
    createVoiceCoachMessageId,
    getVoiceStudentModelId,
    // Exported so the v4 calibration test can pin each preset's resonance mark
    // against the analyzer's own TARGET_PROFILES table rather than a second copy.
    getVoiceStudentPresetTargets,
    normalizeStudentModelReviewQueue,
    normalizeVoiceAdvancedPanelState,
    normalizeVoiceAttemptArtifact,
    normalizeVoiceAttemptArtifactList,
    normalizeVoiceAttemptIdList,
    normalizeVoiceCoachInputConfidence,
    normalizeVoiceCoachInputProvider,
    normalizeVoiceCoachOptionalInputProvider,
    normalizeVoiceCoachMessage,
    normalizeVoiceCoachVoiceState,
    normalizeVoiceConditioningState,
    normalizeVoiceInputRuntimeDuration,
    normalizeVoiceInputRuntimeState,
    normalizeVoiceInputRuntimeStatus,
    normalizeVoiceInputRuntimeText,
    normalizeVoiceInputRuntimeTimestamp,
    normalizeVoiceLastCueGiven,
    normalizeVoiceSectionLoopState,
    normalizeVoiceSelfReportPayload,
    normalizeVoiceState,
    resolveVoiceRealtimeCoachModel,
    shouldPersistSession,
    updateSessionDeepTutorVoiceState,
    updateSessionVoiceState,
  };
}

module.exports = {
  createVoiceSessionStateRuntime,
};
