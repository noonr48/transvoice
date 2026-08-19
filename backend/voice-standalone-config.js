'use strict';

const os = require('os');
const path = require('path');

const DEFAULT_VOICE_STANDALONE_PORT = 3021;
const DEFAULT_VOICE_TRAINER_URL = 'http://127.0.0.1:8002';
const DEFAULT_VOICE_TUTOR_GGUF_BASE_URL = 'http://127.0.0.1:8019/v1';
const DEFAULT_VOICE_TUTOR_GGUF_MODEL = 'voice-tutor-gemma4-r128-clean-s070-iq4nl-attnq8-last10-gguf';
const DEFAULT_VOXCPM_URL = 'http://127.0.0.1:8020';
const DEFAULT_VOICE_ASR_URL = 'http://127.0.0.1:8765';
// 2026-07-26 decoding knobs for the fine-tuned coach model. Defaults are
// NEUTRAL: an A/B eval (seed 9001, temp 0.35, 89 turns) measured penalties
// 0.3/0.2 making the complaint metrics WORSE — breath mentions 13% vs 10%,
// collapsed phrase-ending cue 11 vs 6, learner-name use 25% vs 36% — because
// the prompt-side fixes (Direction line, actionable Focus/Drill/Win,
// specificity rubric) already carry the anti-collapse load. Caveat: the same
// pair of runs moved the composite judge metrics slightly the other way
// (suitable .663→.618, tone_ok .933→.910, direction .888→.876 — ~4/89 turns,
// plausibly noise); neutral was chosen because the user's complaint is the
// breath/vagueness axis. Knobs stay env-overridable for retuning.
const DEFAULT_VOICE_TUTOR_TOP_P = 1;
const DEFAULT_VOICE_TUTOR_FREQUENCY_PENALTY = 0;
const DEFAULT_VOICE_TUTOR_PRESENCE_PENALTY = 0;
const DEFAULT_VOICE_STANDALONE_SESSION_MAX_SESSIONS = 250;
const DEFAULT_VOICE_STANDALONE_SESSION_RETENTION_DAYS = 0;
const DEFAULT_SMART_TURN_RUNTIME_ROOT = path.join(
  os.homedir(),
  '.local',
  'share',
  'sloane',
  'transvoice',
  'smart-turn',
);

function parseBooleanFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) {
    return false;
  }
  return fallback;
}

/** Clamp a sampling probability into [0, 1]; unparseable input keeps the default. */
function normalizeUnitInterval(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

/** Clamp an OpenAI-style repetition penalty into [-2, 2]; default on bad input. */
function normalizePenalty(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(2, Math.max(-2, numeric));
}

function normalizeUrl(value, fallback) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || fallback).replace(/\/+$/, '');
}

function validateHttpUrl(value, fallback) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  const candidate = normalized || fallback;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fallback;
    }
    return candidate.replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

function normalizePort(value, fallback = DEFAULT_VOICE_STANDALONE_PORT) {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 && numeric <= 65535
    ? numeric
    : fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric >= 0 ? numeric : fallback;
}

// 2026-07-28 Phase 0 deterministic-first rendering: 'off' = the LLM serves and
// nothing is computed (byte-identical legacy path); 'shadow' = the direct-reply
// composer runs and its output is logged (coach_direct_reply_shadow) but never
// served; 'on' = the composer output serves (later phases — shares the shadow
// code path). Default 'off'.
// Phase 1+2 armed 2026-07-29: 'on' serves composed replies for the covered
// intents (validated by shadow data from the owner's live phone session).
const VOICE_DIRECT_REPLY_MODES = ['off', 'shadow', 'on'];

function normalizeDirectReplyMode(value, fallback = 'off') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!VOICE_DIRECT_REPLY_MODES.includes(normalized)) return fallback;
  return normalized;
}

function normalizeNumber(value, fallback, minimum, maximum) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(maximum, Math.max(minimum, numeric))
    : fallback;
}

function resolveDefaultStateRoot(env = process.env) {
  const explicitRoot = typeof env.SLOANE_STATE_ROOT === 'string' && env.SLOANE_STATE_ROOT.trim()
    ? env.SLOANE_STATE_ROOT.trim()
    : '';
  return explicitRoot || path.join(os.homedir(), '.local', 'state', 'sloane');
}

function resolveVoiceStandaloneConfig(options = {}) {
  const env = options.env || process.env;
  const stateRoot = path.resolve(
    options.stateRoot
      || env.VOICE_STANDALONE_STATE_ROOT
      || path.join(resolveDefaultStateRoot(env), 'voice-standalone'),
  );
  const voiceTrainerUrl = normalizeUrl(
    options.voiceTrainerUrl || env.VOICE_TRAINER_URL,
    DEFAULT_VOICE_TRAINER_URL,
  );
  const voiceTutorGgufBaseUrl = normalizeUrl(
    options.voiceTutorGgufBaseUrl
      || env.VOICE_TUTOR_GGUF_BASE_URL
      || env.VOICE_TUTOR_LLM_BASE_URL,
    DEFAULT_VOICE_TUTOR_GGUF_BASE_URL,
  );
  const voiceTutorGgufModel = (
    options.voiceTutorGgufModel
    || env.VOICE_TUTOR_GGUF_MODEL
    || env.VOICE_TUTOR_LLM_MODEL
    || DEFAULT_VOICE_TUTOR_GGUF_MODEL
  ).trim();
  const evalEnabled = options.evalPath
    ? true
    : parseBooleanFlag(
      options.evalEnabled ?? env.VOICE_STANDALONE_EVAL_ENABLED,
      false,
    );
  // Keep the owned ledger path known even while recording is disabled. Delete
  // All must still scrub a ledger left by an earlier enabled run.
  const evalStorePath = path.resolve(
    options.evalStorePath
      || options.evalPath
      || env.VOICE_STANDALONE_EVAL_PATH
      || path.join(stateRoot, 'eval-turns.jsonl'),
  );
  const evalPath = evalEnabled
    ? evalStorePath
    : null;

  return {
    host: options.host || env.VOICE_STANDALONE_HOST || '127.0.0.1',
    port: normalizePort(options.port || env.VOICE_STANDALONE_PORT || env.PORT),
    stateRoot,
    sessionStorePath: path.resolve(
      options.sessionStorePath
        || env.VOICE_STANDALONE_SESSION_STORE_PATH
        || path.join(stateRoot, 'sessions.json'),
    ),
    sessionStoreMaxSessions: normalizeNonNegativeInteger(
      options.sessionStoreMaxSessions ?? env.VOICE_STANDALONE_SESSION_MAX_SESSIONS,
      DEFAULT_VOICE_STANDALONE_SESSION_MAX_SESSIONS,
    ),
    sessionStoreRetentionDays: normalizeNonNegativeInteger(
      options.sessionStoreRetentionDays ?? env.VOICE_STANDALONE_SESSION_RETENTION_DAYS,
      DEFAULT_VOICE_STANDALONE_SESSION_RETENTION_DAYS,
    ),
    learnerContextRoot: path.resolve(
      options.learnerContextRoot
        || env.LEARNER_CONTEXT_STATE_PATH
        || path.join(stateRoot, 'learner-context'),
    ),
    // Live eval recording is opt-in because even categorical turn records are
    // durable learner-linked data. Isolated evaluators pass an explicit path.
    evalPath,
    // Cleanup ownership is independent of whether new recording is enabled.
    evalStorePath,
    voiceTrainerUrl,
    voiceTrainerAuthToken: (
      options.voiceTrainerAuthToken
      || env.VOICE_TRAINER_AUTH_TOKEN
      || ''
    ).trim(),
    voiceTutorGgufBaseUrl,
    voiceTutorGgufModel,
    voiceTutorGgufApiKey: (
      options.voiceTutorGgufApiKey
      || env.VOICE_TUTOR_GGUF_API_KEY
      || env.VOICE_TUTOR_LLM_API_KEY
      || ''
    ).trim(),
    // 2026-07-26 decoding knobs. The request body previously sent ONLY
    // temperature; these three are now always on the wire (llama.cpp's
    // OpenAI-compatible server accepts them) so a deploy can retune without a
    // code change. Defaults are neutral — the seeded A/B eval showed nonzero
    // penalties suppressing learner-name use while slightly INCREASING the
    // collapsed cues; the prompt-side repairs carry the anti-collapse load.
    voiceTutorTopP: normalizeUnitInterval(
      options.voiceTutorTopP ?? env.VOICE_TUTOR_TOP_P,
      DEFAULT_VOICE_TUTOR_TOP_P,
    ),
    voiceTutorFrequencyPenalty: normalizePenalty(
      options.voiceTutorFrequencyPenalty ?? env.VOICE_TUTOR_FREQUENCY_PENALTY,
      DEFAULT_VOICE_TUTOR_FREQUENCY_PENALTY,
    ),
    voiceTutorPresencePenalty: normalizePenalty(
      options.voiceTutorPresencePenalty ?? env.VOICE_TUTOR_PRESENCE_PENALTY,
      DEFAULT_VOICE_TUTOR_PRESENCE_PENALTY,
    ),
    enableDeepTutorVoiceRoutes: parseBooleanFlag(
      options.enableDeepTutorVoiceRoutes ?? env.VOICE_STANDALONE_ENABLE_DEEPTUTOR_ROUTES,
      false,
    ),
    corsEnabled: parseBooleanFlag(options.corsEnabled ?? env.VOICE_STANDALONE_CORS_ENABLED, true),
    requestJsonLimit: options.requestJsonLimit || env.VOICE_STANDALONE_JSON_LIMIT || '25mb',
    defaultStudentId: options.defaultStudentId || env.VOICE_STANDALONE_STUDENT_ID || 'default-voice-learner',
    voxcpmEnabled: parseBooleanFlag(options.voxcpmEnabled ?? env.VOXCPM_ENABLED, false),
    voxcpmUrl: validateHttpUrl(options.voxcpmUrl || env.VOXCPM_URL || env.NANOVLLM_VOXCPM_URL, DEFAULT_VOXCPM_URL),
    voxcpmModel: (options.voxcpmModel || env.VOXCPM_MODEL || 'openbmb/VoxCPM2').trim(),
    voxcpmTimeoutMs: normalizeNonNegativeInteger(options.voxcpmTimeoutMs ?? env.VOXCPM_TIMEOUT_MS, 30000),
    voiceAsrEnabled: parseBooleanFlag(options.voiceAsrEnabled ?? env.VOICE_ASR_ENABLED, true),
    voiceAsrUrl: validateHttpUrl(options.voiceAsrUrl || env.VOICE_ASR_URL, DEFAULT_VOICE_ASR_URL),
    voiceAsrApiStyle: (options.voiceAsrApiStyle || env.VOICE_ASR_API_STYLE || 'simple').trim().toLowerCase(),
    voiceAsrLanguage: (options.voiceAsrLanguage || env.VOICE_ASR_LANGUAGE || 'auto').trim(),
    voiceAsrTimeoutMs: normalizeNonNegativeInteger(options.voiceAsrTimeoutMs ?? env.VOICE_ASR_TIMEOUT_MS, 10000),
    voiceAsrLiveMode: (options.voiceAsrLiveMode || env.VOICE_ASR_LIVE_MODE || 'buffered').trim().toLowerCase(),
    // 2026-07-26: how long a coach turn will wait for the analyzer's one-shot
    // take before proceeding WITHOUT take evidence. The take runs concurrently
    // with the ASR, so this is a ceiling on the extra wall clock a turn can
    // ever pay for it, not the usual cost. Deliberately short: a spoken lesson
    // that stalls is worse than a turn coached from the drill alone.
    voiceCoachTakeTimeoutMs: normalizeNonNegativeInteger(
      options.voiceCoachTakeTimeoutMs ?? env.VOICE_COACH_TAKE_TIMEOUT_MS,
      2500,
    ),
    // How long a live turn may wait for its analyzer session to be BOUND
    // (2026-07-27). Paid at most once per coach session, and far below the 8s
    // `fetchJson` budget startVoiceSession may spend, because an additive
    // evidence channel must never stall the learner's first spoken turn. See
    // waitForCoachAnalyzerBind in voice-standalone-runtime.js.
    voiceCoachAnalyzerBindWaitMs: normalizeNonNegativeInteger(
      options.voiceCoachAnalyzerBindWaitMs ?? env.VOICE_COACH_ANALYZER_BIND_WAIT_MS,
      2000,
    ),
    // 2026-07-27: the RECORDED coach path (`POST /voice/input/turn`) carries
    // browser audio — ogg/opus or webm/opus — while the analyzer's one-shot take
    // wants 16 kHz mono PCM16. These two knobs govern that decode.
    //
    // ON by default because the alternative is the behaviour this replaces: the
    // recorded path dispatched ZERO analyzer takes, so a wordless-but-voiced
    // recorded take was indistinguishable from silence. Set false to return to
    // exactly that.
    voiceCoachTakeDecodeEnabled: parseBooleanFlag(
      options.voiceCoachTakeDecodeEnabled ?? env.VOICE_COACH_TAKE_DECODE_ENABLED,
      true,
    ),
    // Empty means "find ffmpeg on PATH", which is how the Python analyzer
    // resolves it too (shutil.which in audio_analysis.py). ffmpeg is OPTIONAL:
    // when it is missing, non-WAV recorded takes simply carry no take evidence
    // and the skip is witnessed by format — no turn ever fails for it.
    voiceCoachTakeFfmpegPath: (options.voiceCoachTakeFfmpegPath || env.VOICE_COACH_TAKE_FFMPEG_PATH || '').trim(),
    // Ceiling on the decode. It is dispatched alongside the ASR (whose own
    // budget is voiceAsrTimeoutMs, 10s), so it overlaps transcription rather
    // than preceding it — but the take is dispatched only AFTER the decode
    // resolves, so on a FAST ASR a turn can still grow by the decode+take tail.
    // MEASURED on this box: an ogg/opus decode of a 3s take took 51-56 ms.
    voiceCoachTakeDecodeTimeoutMs: normalizeNonNegativeInteger(
      options.voiceCoachTakeDecodeTimeoutMs ?? env.VOICE_COACH_TAKE_DECODE_TIMEOUT_MS,
      2000,
    ),
    smartTurnEnabled: parseBooleanFlag(options.smartTurnEnabled ?? env.SMART_TURN_ENABLED, true),
    smartTurnPythonPath: path.resolve(
      options.smartTurnPythonPath
        || env.SMART_TURN_PYTHON_PATH
        || path.join(DEFAULT_SMART_TURN_RUNTIME_ROOT, 'venv', 'bin', 'python'),
    ),
    smartTurnWorkerPath: path.resolve(
      options.smartTurnWorkerPath
        || env.SMART_TURN_WORKER_PATH
        || path.join(__dirname, '..', 'services', 'smart-turn', 'worker.py'),
    ),
    smartTurnModelPath: path.resolve(
      options.smartTurnModelPath
        || env.SMART_TURN_MODEL_PATH
        || path.join(DEFAULT_SMART_TURN_RUNTIME_ROOT, 'models', 'smart-turn-v3.2-cpu.onnx'),
    ),
    smartTurnTimeoutMs: normalizeNumber(
      options.smartTurnTimeoutMs ?? env.SMART_TURN_TIMEOUT_MS,
      500,
      100,
      3000,
    ),
    // Locked accessibility policy. Environment values remain documented for
    // rollout visibility, but cannot silently change the tested turn boundary.
    voiceLiveCandidateSilenceMs: 1800,
    voiceLiveFallbackSilenceMs: 4500,
    voiceLiveSemanticThreshold: normalizeNumber(
      options.voiceLiveSemanticThreshold ?? env.VOICE_LIVE_SEMANTIC_THRESHOLD,
      0.65,
      0.5,
      0.99,
    ),
    voiceLiveMaxAudioBytes: normalizeNonNegativeInteger(
      options.voiceLiveMaxAudioBytes ?? env.VOICE_LIVE_MAX_AUDIO_BYTES,
      4 * 1024 * 1024,
    ),
    voiceDirectReplyMode: normalizeDirectReplyMode(
      options.voiceDirectReplyMode ?? env.VOICE_DIRECT_REPLY_MODE,
    ),
    // 2026-07-29 L3 (TTS latency): session-start template segment pre-warm.
    // Default ON in production; tests that count upstream /generate calls
    // (reference-prewarm / speech-admission suites) opt out explicitly.
    ttsTemplatePrewarmEnabled: parseBooleanFlag(
      options.ttsTemplatePrewarmEnabled ?? env.VOICE_TTS_TEMPLATE_PREWARM_ENABLED,
      true,
    ),
    // 2026-07-29 L3 (TTS latency): pacing between template pre-warm segments.
    // A config knob so tests can run the enumeration without the real pacing.
    ttsTemplatePrewarmPaceMs: normalizeNonNegativeInteger(
      options.ttsTemplatePrewarmPaceMs ?? env.VOICE_TTS_TEMPLATE_PREWARM_PACE_MS,
      150,
    ),
    // 2026-07-30 call-and-response graph: measure the tutor's OWN synthesized
    // speech so the learner has a shape to copy. Runs on the pre-synthesis
    // path, off the reply's critical path; a failure means the graph misses a
    // turn, never that the tutor goes quiet. Default ON, killable in one flag.
    tutorMetricTrackEnabled: parseBooleanFlag(
      options.tutorMetricTrackEnabled ?? env.VOICE_TUTOR_METRIC_TRACK_ENABLED,
      true,
    ),
    // The analysis is CPU work on the shared analyzer, which also serves the
    // learner's takes. A short deadline means a busy analyzer costs the graph a
    // turn instead of queueing behind the learner.
    tutorMetricTrackTimeoutMs: normalizeNonNegativeInteger(
      options.tutorMetricTrackTimeoutMs ?? env.VOICE_TUTOR_METRIC_TRACK_TIMEOUT_MS,
      4000,
    ),
    tutorMetricTrackMaxPoints: normalizeNonNegativeInteger(
      options.tutorMetricTrackMaxPoints ?? env.VOICE_TUTOR_METRIC_TRACK_MAX_POINTS,
      24,
    ),
    tutorMetricTrackCacheEntries: normalizeNonNegativeInteger(
      options.tutorMetricTrackCacheEntries ?? env.VOICE_TUTOR_METRIC_TRACK_CACHE_ENTRIES,
      256,
    ),
  };
}

module.exports = {
  DEFAULT_VOICE_STANDALONE_PORT,
  DEFAULT_VOICE_TRAINER_URL,
  DEFAULT_VOICE_TUTOR_GGUF_BASE_URL,
  DEFAULT_VOICE_TUTOR_GGUF_MODEL,
  DEFAULT_VOXCPM_URL,
  DEFAULT_VOICE_ASR_URL,
  DEFAULT_VOICE_STANDALONE_SESSION_MAX_SESSIONS,
  DEFAULT_VOICE_STANDALONE_SESSION_RETENTION_DAYS,
  DEFAULT_SMART_TURN_RUNTIME_ROOT,
  VOICE_DIRECT_REPLY_MODES,
  normalizeDirectReplyMode,
  parseBooleanFlag,
  resolveVoiceStandaloneConfig,
};
