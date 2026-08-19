'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { config } = require('./config');
const { masteryStep, sm2Step, DAY_MS } = require('./coaching/spaced-rep');
const { normalizeMotorMap } = require('./coaching/motor-map');
const { normalizeBeginnerMasteryState } = require('./coaching/beginner-mastery');
const { resolveVoiceMeasurementUsability } = require('./voice-measurement-validity');
const {
  canonicalizeVoiceTargetSource,
  isVoiceRecordComparableToTarget,
  normalizeVoiceTargetKey,
  resolveVoiceTargetIdentity,
  resolveVoiceTargetIdentityFromAttempt,
} = require('./voice-target-identity');
// v3 one-real-sentence: the pure entry/normalize helpers live in the lessons
// module so the service stays a thin persistence layer over them.
const {
  normalizeRealSentences,
  findTodaysSentence,
  findPendingDebrief,
  REAL_SENTENCES_CAP,
} = require('./lessons/real-sentence');
const { PREFERENCE_RULES } = require('./coaching/memory-extract');

// Structured-memory substrate (deterministic, fail-soft). Wired ADDITIVELY into
// the longitudinal model: every call is best-effort and MUST NOT affect the
// coaching turn. We tolerate the module being absent (older deployments).
let structuredCall = null;
try {
  ({ structuredCall } = require('./cli-tools/structured-memory-tools'));
} catch {
  structuredCall = null;
}

// v6 (additive, exact-target + privacy/recovery):
//   - voice.targetBinding: the one canonical preset/reference/target identity.
//   - voice.learningByTarget[targetKey]: target-scoped mastery/review/cue state.
//   - voice.coachCheckpoint: self-sufficient compact recovery record for the
//     continuing lesson/preset/line and lifecycle timestamps, without transcript,
//     message history, raw model text, or audio.
//   - corruption quarantine + previous-valid generation recovery, bounded event
//     rotation, complete reset/delete receipts, and canonical preference IDs.
// v4 (additive, tutor-memory upgrades — see docs/TUTOR-MEMORY-AUDIT.md gaps 1-4):
//   - voice.sessions[] (ring cap 60): per-session log {date, startedAt, minutes,
//     takes, focusAxis, oneLine} + voice.lastSessionAt — gives the tutor a sense
//     of TIME (gap-aware greeting, focusHistory).
//   - voice.moments[] (cap 40): identity-moments {kind, text, date} — fed by the
//     memory-ops channel + real-sentence outcomes.
//   - voice.coachPreferences[] (cap 10): {text, date} — coaching preferences the
//     tutor remembered ("imagery cues confuse her — use mechanical cues").
//   - whatWorked entries upgraded from plain strings to {text, axis?, date} so the
//     memo can pick CURRENT-FOCUS wins first. BACK-COMPAT: an old string entry
//     normalizes to {text, axis:null, date:''}; every reader was adapted.
// v3: additive one-real-sentence field (voice.realSentences — newest first, cap
// 60). v2: learner-memo fields (profile.{displayName,topics,hobbies} +
// voice.{whatWorked,lastReference}). All back-compatible via default-merge in
// normalizeProfile, so older v1/v2/v3 files normalize cleanly with empty defaults.
const LEARNER_CONTEXT_SCHEMA_VERSION = 'sloane.learner_context.v6';
const LEARNER_CONTEXT_EVENT_SCHEMA_VERSION = 'sloane.learner_context.event.v1';
const DEFAULT_LEARNER_CONTEXT_ROOT = config.LEARNER_CONTEXT_STATE_PATH
  || path.join(config.STATE_ROOT, 'learner-context');
const RECENT_ATTEMPT_LIMIT = 24;
const REVIEW_QUEUE_LIMIT = 12;
const STRUGGLE_LIMIT = 12;
const TARGET_HISTORY_LIMIT = 12;
// Learner-memo caps (the memo is injected into the coach prompt — keep it small).
// v4: topic/hobby caps raised 8 -> 12 so the memory-ops apply contract ("dedupe,
// cap 12 each") holds end-to-end (the memo still surfaces only the top 3).
const PROFILE_TOPIC_LIMIT = 12;
const PROFILE_HOBBY_LIMIT = 12;
const WHAT_WORKED_LIMIT = 10;
// v4 tutor-memory caps + vocab.
const SESSIONS_LIMIT = 60; // voice.sessions[] ring (newest last, cap 60)
const MOMENTS_LIMIT = 40; // voice.moments[] (newest first, cap 40)
const COACH_PREFERENCES_LIMIT = 10; // voice.coachPreferences[] (newest first, cap 10)
const WHAT_WORKED_TEXT_LIMIT = 200; // a whatWorked entry's text is clamped to this
const FOCUS_AXES = Object.freeze(['pitch', 'resonance', 'weight', 'prosody']);
const MOMENT_KINDS = Object.freeze(['gendered-right', 'hard-moment', 'milestone']);
// Flow-session backbone (B-SESS 2026-07-19): how a session ended + what shape it
// had. Both are ADDITIVE + nullable — ring entries written before this upgrade
// normalize to null and stay valid.
const SESSION_END_REASONS = Object.freeze(['completed', 'cut-short', 'learner-stopped']);
const SESSION_TIERS = Object.freeze(['full', 'quiet', 'silent']);
const COACH_CHECKPOINT_STATES = Object.freeze(['active', 'stopped']);
const DEFAULT_EVENT_MAX_BYTES = 1024 * 1024;
const TARGET_LEARNING_FIELDS = Object.freeze([
  'conceptStats',
  'reviewSchedule',
  'reviewQueue',
  'struggles',
  'avoid',
  'whatWorked',
]);
const PREFERENCE_RULE_BY_ID = new Map(PREFERENCE_RULES.map((rule) => [rule.id, rule]));
const PREFERENCE_RULE_BY_VALUE = new Map(PREFERENCE_RULES.map((rule) => [
  rule.value.toLowerCase().replace(/\s+/g, ' ').trim(),
  rule,
]));

// Phase 1.3: baseline capture.
// On the first BASELINE_FREEZE_THRESHOLD takes for a new targetPreset, we
// capture a frozen snapshot of the learner's voice metrics. The snapshot is
// used by the coaching signal to report "vs baseline" deltas.
const BASELINE_FREEZE_THRESHOLD = 3;
const BASELINE_PRESET_KEY_LIMIT = 16;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value, maxLength = 240) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, maxLength) : '';
}

function normalizeStudentId(value) {
  const normalized = normalizeText(value, 160);
  return normalized || 'default-voice-learner';
}

function getStudentFileKey(studentId) {
  return encodeURIComponent(normalizeStudentId(studentId)).replace(/[!'()*]/g, (char) => (
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

function normalizeTimestamp(value, now) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : now();
}

function normalizeBoolean(value, fallback = false) {
  return value === true ? true : value === false ? false : fallback;
}

function normalizeFiniteNumber(value, fallback = null) {
  if (value == null || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function resolveAttemptLearningUsability(advancedMetrics = {}) {
  const advanced = isRecord(advancedMetrics) ? advancedMetrics : {};
  const reliabilityFlags = Array.isArray(advanced.reliabilityFlags)
    ? advanced.reliabilityFlags.map((value) => normalizeText(value, 120)).filter(Boolean)
    : [];
  const rejectionReasons = Array.isArray(advanced.measurementRejectionReasons)
    ? advanced.measurementRejectionReasons.map((value) => normalizeText(value, 120)).filter(Boolean)
    : [];
  const validity = resolveVoiceMeasurementUsability({
    ...advanced,
    reliabilityFlags,
    measurementRejectionReasons: rejectionReasons,
  });
  return {
    usableForLearning: validity.usableForScoring,
    measurementAvailable: validity.measurementAvailable,
    reliabilityFlags: uniqueStrings(reliabilityFlags, 12),
    rejectionReasons: uniqueStrings(validity.reasons, 12),
  };
}

function uniqueStrings(values = [], limit = Infinity) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = normalizeText(value, 160);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
    if (output.length >= limit) {
      break;
    }
  }
  return output;
}

function ensureDirectory(fsModule, dirPath) {
  if (!fsModule.existsSync(dirPath)) {
    fsModule.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
  if (typeof fsModule.chmodSync === 'function') {
    try {
      fsModule.chmodSync(dirPath, 0o700);
    } catch {
      // Best-effort only; some filesystems ignore POSIX modes.
    }
  }
}

function readJsonFile(fsModule, filePath, fallback = null) {
  try {
    if (!fsModule.existsSync(filePath)) {
      return fallback;
    }
    const parsed = JSON.parse(fsModule.readFileSync(filePath, 'utf8'));
    return isRecord(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonFile(fsModule, filePath, payload) {
  ensureDirectory(fsModule, path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fsModule.writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fsModule.renameSync(tmpPath, filePath);
  if (typeof fsModule.chmodSync === 'function') {
    try {
      fsModule.chmodSync(filePath, 0o600);
    } catch {
      // Best-effort only; some filesystems ignore POSIX modes.
    }
  }
}

function appendJsonlFile(fsModule, filePath, payload) {
  ensureDirectory(fsModule, path.dirname(filePath));
  fsModule.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  if (typeof fsModule.chmodSync === 'function') {
    try {
      fsModule.chmodSync(filePath, 0o600);
    } catch {
      // Best-effort only; some filesystems ignore POSIX modes.
    }
  }
}

function normalizeReviewQueueItem(item, fallback = {}) {
  if (!isRecord(item)) {
    return null;
  }
  const conceptId = normalizeText(item.conceptId || item.concept_id || fallback.conceptId, 120);
  if (!conceptId) {
    return null;
  }
  const name = normalizeText(item.name || item.conceptName || item.concept_name || fallback.name || conceptId, 160);
  const urgency = Math.max(0, Math.min(1, normalizeFiniteNumber(item.urgency, fallback.urgency || 0.5)));
  return {
    conceptId,
    name,
    urgency: Number(urgency.toFixed(3)),
    reason: normalizeText(item.reason || item.misconception || fallback.reason, 240) || null,
    updatedAt: normalizeFiniteNumber(item.updatedAt || fallback.updatedAt, null),
  };
}

function mergeReviewQueue(existing = [], additions = []) {
  const merged = new Map();
  for (const item of existing) {
    const normalized = normalizeReviewQueueItem(item);
    if (normalized) {
      merged.set(normalized.conceptId, normalized);
    }
  }
  for (const item of additions) {
    const normalized = normalizeReviewQueueItem(item);
    if (!normalized) {
      continue;
    }
    const previous = merged.get(normalized.conceptId);
    merged.set(normalized.conceptId, previous
      ? {
        ...previous,
        ...normalized,
        urgency: Math.max(previous.urgency || 0, normalized.urgency || 0),
      }
      : normalized);
  }
  return Array.from(merged.values())
    .sort((a, b) => (b.urgency || 0) - (a.urgency || 0))
    .slice(0, REVIEW_QUEUE_LIMIT);
}

function normalizeEvaluation(evaluation, nowValue) {
  if (!isRecord(evaluation)) {
    return null;
  }
  const conceptId = normalizeText(evaluation.conceptId || evaluation.concept_id, 120);
  if (!conceptId) {
    return null;
  }
  return {
    conceptId,
    conceptName: normalizeText(evaluation.conceptName || evaluation.concept_name || evaluation.name || conceptId, 160),
    correct: evaluation.correct === true,
    misconception: normalizeText(evaluation.misconception || evaluation.reason, 240) || null,
    updatedAt: nowValue,
  };
}

function updateConceptStats(conceptStats = {}, evaluations = []) {
  const nextStats = isRecord(conceptStats) ? { ...conceptStats } : {};
  for (const evaluation of evaluations) {
    const current = isRecord(nextStats[evaluation.conceptId])
      ? nextStats[evaluation.conceptId]
      : {
        conceptId: evaluation.conceptId,
        name: evaluation.conceptName,
        correct: 0,
        total: 0,
      };
    const prevAttempts = Math.max(0, Number(current.total) || 0);
    const prevSuccesses = Math.max(0, Number(current.correct) || 0);
    // v5: per-concept EWMA mastery. Back-compat: a concept created before v5 has
    // no ewma -> seed it from its historic success ratio so the first v5 update
    // doesn't snap to the latest single outcome.
    const prevEwma = Number.isFinite(current.ewma)
      ? current.ewma
      : (prevAttempts > 0 ? prevSuccesses / prevAttempts : 0);
    const m = masteryStep({ attempts: prevAttempts, successes: prevSuccesses, ewma: prevEwma }, evaluation.correct === true);
    nextStats[evaluation.conceptId] = {
      ...current,
      name: evaluation.conceptName || current.name || evaluation.conceptId,
      correct: m.successes,
      total: m.attempts,
      ewma: Number(m.ewma.toFixed(4)),
      level: m.level,
      lastCorrect: evaluation.correct,
      updatedAt: evaluation.updatedAt,
    };
  }
  return nextStats;
}

// v2 learner memo: derive "what worked" cue strings from an attempt's
// evaluations — the inverse of the struggles derivation. When an evaluation is
// clearly correct, we keep a compact 'Concept: cue-style' string (the concept
// name, lightly styled) so the coach memo / greeting can reflect recent wins.
// Mirrors struggles: deduped + capped by the caller via uniqueStrings.
function buildWhatWorkedFromEvaluations(evaluations = []) {
  return evaluations
    .filter((evaluation) => evaluation && evaluation.correct === true)
    .map((evaluation) => {
      const name = normalizeText(evaluation.conceptName || evaluation.conceptId, 120);
      return name ? `${name}: landed cleanly` : '';
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// v4 whatWorked tagging: entries are {text, axis?, date}. Back-compat is total —
// an old plain-string entry normalizes to {text, axis:null, date:''}. A bare
// object missing fields fills defaults. dedupe is BY TEXT (case-insensitive).
// ---------------------------------------------------------------------------

function localDateStringFor(value) {
  // Local YYYY-MM-DD for a ms epoch (matches real-sentence pickedAt semantics).
  const numeric = Number(value);
  const d = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function normalizeFocusAxis(value) {
  const axis = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return FOCUS_AXES.includes(axis) ? axis : null;
}

// Normalize ONE whatWorked entry to {text, axis, date}. Accepts a plain string
// (legacy v2/v3) or an object. Returns null when there's no usable text.
function normalizeWhatWorkedEntry(value) {
  if (typeof value === 'string') {
    const text = normalizeText(value, WHAT_WORKED_TEXT_LIMIT);
    return text ? { text, axis: null, date: '' } : null;
  }
  if (!isRecord(value)) return null;
  const text = normalizeText(value.text, WHAT_WORKED_TEXT_LIMIT);
  if (!text) return null;
  return {
    text,
    axis: normalizeFocusAxis(value.axis),
    // date is a free 'YYYY-MM-DD' string; accept whatever's given (trimmed) else ''.
    date: normalizeText(value.date, 32),
  };
}

// Merge whatWorked lists newest-first, dedupe by text (case-insensitive), cap.
// `additions` are prepended ahead of `existing` (newest first), matching the v2
// append semantics. Each item may be a string or an object.
function mergeWhatWorked(additions = [], existing = [], limit = WHAT_WORKED_LIMIT) {
  const seen = new Set();
  const out = [];
  for (const raw of [...(Array.isArray(additions) ? additions : []), ...(Array.isArray(existing) ? existing : [])]) {
    const entry = normalizeWhatWorkedEntry(raw);
    if (!entry) continue;
    const key = entry.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

// Normalize the persisted whatWorked list (drop empties, dedupe, cap). Used by
// normalizeProfile so every read returns the {text,axis,date} shape regardless of
// how old the file is.
function normalizeWhatWorkedList(list) {
  return mergeWhatWorked([], list, WHAT_WORKED_LIMIT);
}

// ── v4 identity-moments (voice.moments[]): {kind, text, date}, newest first ──
function normalizeMomentEntry(value) {
  if (!isRecord(value)) return null;
  const text = normalizeText(value.text, 200);
  if (!text) return null;
  // v6: case-insensitive kind (a 'Hard-Moment' is preserved as 'hard-moment', not lost
  // to 'milestone') — matches the memo's hard-moment exclusion + the dataset validator.
  const kind = (typeof value.kind === 'string' ? value.kind.trim() : '').toLowerCase();
  return {
    // v6: stable id so the learner can delete a specific moment (preserved if present).
    id: normalizeText(value.id, 40),
    kind: MOMENT_KINDS.includes(kind) ? kind : 'milestone',
    text,
    date: normalizeText(value.date, 32),
  };
}

function normalizeMomentsList(list) {
  const arr = Array.isArray(list) ? list : [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const entry = normalizeMomentEntry(item);
    if (!entry) continue;
    // Dedupe by kind+text so the same moment isn't logged twice.
    const key = `${entry.kind}::${entry.text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= MOMENTS_LIMIT) break;
  }
  return out;
}

// ── v6 coaching preferences: closed, canonical policy identifiers ─────────────
function resolveCanonicalPreference(value) {
  const source = typeof value === 'string' ? { text: value } : (isRecord(value) ? value : {});
  const requestedId = normalizeText(source.id || source.preferenceId, 80).toLowerCase();
  if (requestedId && PREFERENCE_RULE_BY_ID.has(requestedId)) {
    return PREFERENCE_RULE_BY_ID.get(requestedId);
  }
  const textKey = normalizeText(source.text || source.value, 200)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return PREFERENCE_RULE_BY_VALUE.get(textKey) || null;
}

function normalizeCoachPreferenceEntry(value) {
  const rule = resolveCanonicalPreference(value);
  if (!rule) return null;
  const source = isRecord(value) ? value : {};
  return {
    id: rule.id,
    text: rule.value,
    date: normalizeText(source.date, 32),
    source: normalizeText(source.source, 40) || 'learner',
  };
}

function normalizeCoachPreferencesList(list) {
  const arr = Array.isArray(list) ? list : [];
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const entry = normalizeCoachPreferenceEntry(item);
    if (!entry) continue;
    const key = entry.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= COACH_PREFERENCES_LIMIT) break;
  }
  return out;
}

// ── v4 sessions ring (voice.sessions[]): newest LAST, cap 60 ──────────────────
// {date, startedAt, minutes (active), takes, focusAxis (dominant), oneLine}.
// B-SESS flow-session fields (all additive, nullable on pre-upgrade entries):
//   sessionId — the standalone session id (dedupe key: one ring entry per session).
//   at        — ms epoch of the entry's (latest) session-end signal.
//   endReason — 'completed' (clean close) | 'learner-stopped' (explicit,
//               resumable End) | 'cut-short' (pagehide / staleness sweep) |
//               null (pre-upgrade entry).
//   tier      — the session's sessionScope tier 'full'|'quiet'|'silent' | null.
function normalizeSessionEntry(value) {
  if (!isRecord(value)) return null;
  const date = normalizeText(value.date, 32);
  const startedAt = normalizeFiniteNumber(value.startedAt, null);
  // A session entry must at least carry a date OR a startedAt to be meaningful.
  if (!date && startedAt == null) return null;
  const minutes = normalizeFiniteNumber(value.minutes, 0);
  const takes = normalizeFiniteNumber(value.takes, 0);
  const focusAxis = normalizeFocusAxis(value.focusAxis);
  const at = normalizeFiniteNumber(value.at ?? value.endedAt, null);
  return {
    date: date || localDateStringFor(startedAt),
    startedAt: startedAt != null ? Math.round(startedAt) : null,
    minutes: minutes != null ? Math.max(0, Number(minutes.toFixed(2))) : 0,
    takes: takes != null ? Math.max(0, Math.round(takes)) : 0,
    focusAxis, // null when no dominant axis was determined
    oneLine: normalizeText(value.oneLine, 120),
    sessionId: normalizeText(value.sessionId, 160) || null,
    at: at != null ? Math.round(at) : null,
    endReason: SESSION_END_REASONS.includes(value.endReason) ? value.endReason : null,
    tier: SESSION_TIERS.includes(value.tier) ? value.tier : null,
  };
}

function normalizeSessionsList(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  for (const item of arr) {
    const entry = normalizeSessionEntry(item);
    if (entry) out.push(entry);
  }
  // Ring semantics: keep the newest SESSIONS_LIMIT (the tail), preserving order.
  return out.slice(-SESSIONS_LIMIT);
}

function emptyTargetLearningBucket() {
  return {
    conceptStats: {},
    reviewSchedule: {},
    reviewQueue: [],
    struggles: [],
    avoid: [],
    whatWorked: [],
    motorMap: normalizeMotorMap(null),
  };
}

function normalizeTargetLearningBucket(value) {
  const source = isRecord(value) ? value : {};
  return {
    conceptStats: isRecord(source.conceptStats) ? source.conceptStats : {},
    reviewSchedule: isRecord(source.reviewSchedule) ? source.reviewSchedule : {},
    reviewQueue: mergeReviewQueue(source.reviewQueue || []),
    struggles: uniqueStrings(Array.isArray(source.struggles) ? source.struggles : [], STRUGGLE_LIMIT),
    avoid: uniqueStrings(Array.isArray(source.avoid) ? source.avoid : [], STRUGGLE_LIMIT),
    whatWorked: normalizeWhatWorkedList(source.whatWorked),
    motorMap: normalizeMotorMap(source.motorMap),
  };
}

function targetLearningBucketFromLegacyVoice(voice) {
  return normalizeTargetLearningBucket({
    conceptStats: voice.conceptStats,
    reviewSchedule: voice.reviewSchedule,
    reviewQueue: voice.reviewQueue,
    struggles: voice.struggles,
    avoid: voice.avoid,
    whatWorked: voice.whatWorked,
  });
}

function normalizeTargetBinding(value, fallback = {}) {
  const source = isRecord(value) ? value : {};
  const profile = isRecord(source.targetVoiceProfile) ? source.targetVoiceProfile : {};
  const targetPreset = normalizeText(
    source.targetPreset || profile.targetPreset || fallback.targetPreset,
    80,
  ) || 'cute-feminine';
  const targetSource = canonicalizeVoiceTargetSource(
    source.targetSource || fallback.targetSource,
  );
  const targetProfileId = normalizeText(
    source.targetProfileId || profile.profileId || fallback.targetProfileId,
    160,
  ) || null;
  const referenceClipId = normalizeText(
    source.referenceClipId || profile.clipId || fallback.referenceClipId,
    160,
  ) || null;
  const analysisVersion = normalizeText(
    source.analysisVersion || profile.analysisVersion || fallback.analysisVersion,
    120,
  ) || null;
  const direction = normalizeText(
    source.direction || profile.direction || fallback.direction,
    40,
  ) || null;
  const band = (name) => normalizeFiniteNumber(
    source[name] ?? profile[name] ?? fallback[name],
    null,
  );
  const identity = resolveVoiceTargetIdentity({
    targetPreset,
    targetSource,
    targetProfileId,
    referenceClipId,
    analysisVersion,
    direction,
    pitchFloorHz: band('pitchFloorHz'),
    pitchCeilingHz: band('pitchCeilingHz'),
    resonanceFloor: band('resonanceFloor'),
    resonanceCeiling: band('resonanceCeiling'),
    weightFloor: band('weightFloor'),
    weightCeiling: band('weightCeiling'),
  });
  const storedTargetKey = normalizeVoiceTargetKey(source.targetKey || fallback.targetKey);
  const targetKey = identity.valid ? identity.targetKey : storedTargetKey;
  if (!targetKey) return null;
  return {
    presetId: normalizeText(source.presetId || source.id || fallback.presetId, 160) || null,
    presetName: normalizeText(source.presetName || source.name || fallback.presetName, 160) || null,
    referenceClipId,
    targetPreset,
    targetSource,
    targetKey,
    targetProfileId,
    analysisVersion,
    direction,
    pitchFloorHz: band('pitchFloorHz'),
    pitchCeilingHz: band('pitchCeilingHz'),
    resonanceFloor: band('resonanceFloor'),
    resonanceCeiling: band('resonanceCeiling'),
    weightFloor: band('weightFloor'),
    weightCeiling: band('weightCeiling'),
    updatedAt: normalizeFiniteNumber(source.updatedAt || fallback.updatedAt, null),
  };
}

function createDefaultTargetBinding(nowValue) {
  return normalizeTargetBinding({
    targetPreset: 'cute-feminine',
    targetSource: 'built-in',
    updatedAt: nowValue,
  });
}

function normalizeLearningByTarget(value, activeTargetKey, legacyVoice = {}) {
  const output = {};
  if (isRecord(value)) {
    for (const [rawTargetKey, rawBucket] of Object.entries(value)) {
      const targetKey = normalizeVoiceTargetKey(rawTargetKey);
      if (targetKey) output[targetKey] = normalizeTargetLearningBucket(rawBucket);
    }
  }
  if (activeTargetKey && !output[activeTargetKey]) {
    output[activeTargetKey] = targetLearningBucketFromLegacyVoice(legacyVoice);
  }
  return output;
}

function applyActiveLearningProjection(voice, learningByTarget, targetKey) {
  const bucket = normalizeTargetLearningBucket(
    targetKey && learningByTarget[targetKey]
      ? learningByTarget[targetKey]
      : emptyTargetLearningBucket(),
  );
  // Motor effectiveness is deterministic controller state, not model
  // context. Keep it nested by target and strip any legacy top-level copy.
  const { motorMap: _motorMap, ...projectedBucket } = bucket;
  const {
    motorMap: _legacyTopLevelMotorMap,
    ...voiceWithoutMotorMap
  } = isRecord(voice) ? voice : {};
  return {
    ...voiceWithoutMotorMap,
    learningByTarget,
    ...projectedBucket,
  };
}

// ── v6 spoken-Coach checkpoint ─────────────────────────────────────────────
// This is deliberately a compact navigation/index record, not conversational
// memory. Unknown fields are discarded so transcripts, message arrays, and raw
// model text cannot accidentally enter the durable learner profile.
function normalizeCoachCheckpoint(value) {
  if (!isRecord(value)) return null;
  const sessionId = normalizeText(value.sessionId, 160);
  if (!sessionId) return null;
  const timestamp = (candidate) => {
    const numeric = normalizeFiniteNumber(candidate, null);
    return numeric != null && numeric > 0 ? Math.round(numeric) : null;
  };
  const lesson = isRecord(value.lesson) ? value.lesson : {};
  const practice = isRecord(value.practice) ? value.practice : {};
  const preset = isRecord(value.preset) ? value.preset : {};
  const targetBinding = normalizeTargetBinding(value.targetBinding, {
    presetId: preset.id,
    presetName: preset.name,
    referenceClipId: preset.referenceClipId,
    targetPreset: preset.targetPreset,
    targetSource: preset.targetSource,
    targetProfileId: preset.targetProfileId,
    analysisVersion: preset.analysisVersion,
  });
  return {
    sessionId,
    state: COACH_CHECKPOINT_STATES.includes(value.state) ? value.state : 'stopped',
    startedAt: timestamp(value.startedAt),
    stoppedAt: timestamp(value.stoppedAt),
    lastRestartedAt: timestamp(value.lastRestartedAt),
    restartCount: Math.max(0, Math.round(normalizeFiniteNumber(value.restartCount, 0) || 0)),
    // lastSpokeAt remains the learner-speech compatibility alias. Separate
    // participant clocks make resumed-session continuity unambiguous.
    lastSpokeAt: timestamp(value.lastSpokeAt ?? value.lastLearnerSpokeAt),
    lastLearnerSpokeAt: timestamp(value.lastLearnerSpokeAt ?? value.lastSpokeAt),
    lastCoachSpokeAt: timestamp(value.lastCoachSpokeAt),
    lastActivityAt: timestamp(value.lastActivityAt),
    updatedAt: timestamp(value.updatedAt),
    lesson: {
      status: normalizeText(lesson.status, 60) || null,
      stage: normalizeText(lesson.stage, 80) || null,
      focus: normalizeText(lesson.focus, 120) || null,
      lessonId: normalizeText(lesson.lessonId, 160) || null,
      exerciseId: normalizeText(lesson.exerciseId, 160) || null,
      exerciseIndex: Math.max(0, Math.round(normalizeFiniteNumber(lesson.exerciseIndex, 0) || 0)),
    },
    practice: {
      lineId: normalizeText(practice.lineId, 160) || null,
      text: normalizeText(practice.text, 500) || null,
      pronunciation: normalizeText(practice.pronunciation, 500) || null,
      cardId: normalizeText(practice.cardId, 160) || null,
    },
    preset: {
      id: normalizeText(preset.id, 160) || null,
      name: normalizeText(preset.name, 160) || null,
      referenceClipId: normalizeText(preset.referenceClipId, 160) || null,
      targetPreset: normalizeText(preset.targetPreset, 120) || null,
      targetSource: normalizeText(preset.targetSource, 80) || null,
      targetProfileId: normalizeText(preset.targetProfileId, 160) || null,
    },
    targetBinding,
  };
}

function mergeCoachCheckpoint(current, patch, nowValue) {
  if (patch === null) return null;
  const previous = isRecord(current) ? current : {};
  const input = isRecord(patch) ? patch : {};
  return normalizeCoachCheckpoint({
    ...previous,
    ...input,
    lesson: {
      ...(isRecord(previous.lesson) ? previous.lesson : {}),
      ...(isRecord(input.lesson) ? input.lesson : {}),
    },
    practice: {
      ...(isRecord(previous.practice) ? previous.practice : {}),
      ...(isRecord(input.practice) ? input.practice : {}),
    },
    preset: {
      ...(isRecord(previous.preset) ? previous.preset : {}),
      ...(isRecord(input.preset) ? input.preset : {}),
    },
    targetBinding: isRecord(input.targetBinding)
      ? {
        ...(isRecord(previous.targetBinding) ? previous.targetBinding : {}),
        ...input.targetBinding,
      }
      : previous.targetBinding,
    updatedAt: nowValue,
  });
}

// v5: SM-2 review scheduling. Each evaluated concept gets a real next-due date
// (grade 4 on a pass, 1 on a miss => lapse). Pure; nowMs injected.
function updateReviewSchedule(reviewSchedule = {}, evaluations = [], nowMs = Date.now()) {
  const next = isRecord(reviewSchedule) ? { ...reviewSchedule } : {};
  for (const evaluation of evaluations) {
    if (!evaluation || !evaluation.conceptId) continue;
    const prev = isRecord(next[evaluation.conceptId]) ? next[evaluation.conceptId] : {};
    const grade = evaluation.correct === true ? 4 : 1;
    const s = sm2Step(prev, grade, nowMs);
    next[evaluation.conceptId] = {
      conceptId: evaluation.conceptId,
      name: evaluation.conceptName || prev.name || evaluation.conceptId,
      ease: Number(s.ease.toFixed(3)),
      intervalDays: s.intervalDays,
      reps: s.reps,
      lapses: s.lapses,
      dueAt: s.dueAt,
      updatedAt: evaluation.updatedAt,
    };
  }
  return next;
}

// v5: review URGENCY in [0,1] from real per-concept state — low mastery (EWMA),
// accumulated lapses, and overdue-ness all raise it. Replaces the flat 0.72.
function reviewUrgencyFor(sched, conceptStat, nowMs) {
  const ewma = conceptStat && Number.isFinite(conceptStat.ewma) ? conceptStat.ewma : 0.5;
  const masteryGap = Math.max(0, 1 - ewma);
  const lapseBoost = sched && Number(sched.lapses) > 0 ? Math.min(0.3, Number(sched.lapses) * 0.15) : 0;
  const overdue = sched && Number.isFinite(sched.dueAt) && sched.dueAt <= nowMs
    ? Math.min(0.25, ((nowMs - sched.dueAt) / DAY_MS) * 0.05) : 0;
  return Number(Math.max(0, Math.min(1, 0.2 + 0.55 * masteryGap + lapseBoost + overdue)).toFixed(3));
}

// v5: derive the review queue from real state: this session's missed concepts
// (preserve the existing "review what you struggled with" behaviour) PLUS any
// scheduled concept now overdue (dueAt <= now). Ordered by urgency, capped.
function buildReviewQueue(evaluations = [], reviewSchedule = {}, conceptStats = {}, nowMs = Date.now()) {
  const out = new Map();
  for (const evaluation of evaluations) {
    if (!evaluation || evaluation.correct === true || !evaluation.conceptId) continue;
    out.set(evaluation.conceptId, {
      conceptId: evaluation.conceptId,
      name: evaluation.conceptName || evaluation.conceptId,
      urgency: reviewUrgencyFor(reviewSchedule[evaluation.conceptId], conceptStats[evaluation.conceptId], nowMs),
      reason: evaluation.misconception || 'Needs another easy pass.',
      updatedAt: evaluation.updatedAt,
    });
  }
  for (const [conceptId, sched] of Object.entries(isRecord(reviewSchedule) ? reviewSchedule : {})) {
    if (out.has(conceptId) || !sched || !Number.isFinite(sched.dueAt) || sched.dueAt > nowMs) continue;
    out.set(conceptId, {
      conceptId,
      name: sched.name || conceptId,
      urgency: reviewUrgencyFor(sched, conceptStats[conceptId], nowMs),
      reason: Number(sched.lapses) > 0 ? 'Lapsed — due for an easy pass.' : 'Due for review.',
      updatedAt: sched.updatedAt,
    });
  }
  return Array.from(out.values())
    .sort((a, b) => (b.urgency || 0) - (a.urgency || 0))
    .slice(0, REVIEW_QUEUE_LIMIT);
}

function inferMasteryLevel(conceptStats = {}) {
  const stats = Object.values(isRecord(conceptStats) ? conceptStats : {});
  const total = stats.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
  const correct = stats.reduce((sum, item) => sum + (Number(item.correct) || 0), 0);
  if (total < 4) {
    return 'beginner';
  }
  const ratio = total > 0 ? correct / total : 0;
  if (ratio >= 0.82 && total >= 12) {
    return 'advanced';
  }
  if (ratio >= 0.62) {
    return 'intermediate';
  }
  return 'beginner';
}

function buildReviewPrompt(reviewQueue = []) {
  if (!reviewQueue.length) {
    return '';
  }
  const topItems = reviewQueue.slice(0, 3).map((item) => item.name || item.conceptId);
  return `Review ${topItems.join(', ')} in the next voice practice pass.`;
}

// ---------------------------------------------------------------------------
// Structured-memory substrate bridge (ADDITIVE, FAIL-SOFT).
//
// These helpers mirror selected longitudinal signals into the deterministic
// /structured/* substrate. They NEVER throw, never block the coaching turn, and
// have no effect on the file-backed profile that is the source of truth. If the
// substrate client is missing or the cross-API is unreachable, every call is a
// silent no-op (fail-closed for writes, fall-back for reads).
// ---------------------------------------------------------------------------

// Build the student scope. Returns null (fail-closed) when no learner id is
// resolvable so callers SKIP silently rather than writing to a bogus scope.
function buildStudentScope(learnerId) {
  const scopeId = typeof learnerId === 'string' ? learnerId.trim() : '';
  if (!scopeId) return null;
  // Fail-closed for anonymous: the 'default-voice-learner' sentinel means no
  // real learner id was supplied. Don't write/read a SHARED anonymous scope
  // (it would conflate distinct anonymous users); skip the substrate instead.
  if (scopeId === 'default-voice-learner') return null;
  const scope = { scope_type: 'student', scope_id: scopeId };
  // tenant_id is readily available from config; include it so the substrate is
  // not dependent on the cross-API process seeing the same env.
  const tenantId = config && typeof config.SIMPLEMEM_TENANT_ID === 'string'
    ? config.SIMPLEMEM_TENANT_ID.trim()
    : '';
  if (tenantId) scope.tenant_id = tenantId;
  return scope;
}

// Fire-and-forget mirror of a recorded voice attempt into the substrate.
// Accepts the already-normalized attemptRecord + evaluations and a primaryIssue
// hint. Swallows every error; returns a Promise that always resolves.
async function mirrorAttemptToSubstrate(
  learnerId,
  attemptRecord,
  evaluations,
  extras = {},
  substrateCall = structuredCall,
) {
  if (typeof substrateCall !== 'function') return;
  const scope = buildStudentScope(learnerId);
  if (!scope) return; // fail-closed: no learner id -> skip silently

  const usableForLearning = attemptRecord?.usableForLearning !== false;
  if (usableForLearning) {
    // 1) Numeric metrics -> time-series. resonanceMean is the resonance signal
    //    alongside frontnessScore; both are mirrored when present.
    const metricKeys = ['meanPitchHz', 'pitchRangeSt', 'targetHitPct', 'frontnessScore', 'resonanceMean'];
    for (const metric of metricKeys) {
      const value = normalizeFiniteNumber(attemptRecord?.[metric], null);
      if (value == null) continue;
      try {
        await substrateCall('POST', '/structured/metrics', {
          body: { scope, metric, value },
        });
      } catch {
        // fail-soft: ignore substrate errors
      }
    }

    // 2) Per-concept correctness -> mastery (counts + EWMA + level on the server).
    for (const evaluation of (Array.isArray(evaluations) ? evaluations : [])) {
      const skill = evaluation && typeof evaluation.conceptId === 'string' ? evaluation.conceptId.trim() : '';
      if (!skill) continue;
      try {
        await substrateCall('POST', '/structured/mastery', {
          body: { scope, skill, correct: evaluation.correct === true },
        });
      } catch {
        // fail-soft
      }
    }
  }

  // 3) One compact coaching event into the append-only log.
  try {
    const primaryIssue = (Array.isArray(attemptRecord?.issues) && attemptRecord.issues.length)
      ? attemptRecord.issues[0]
      : (extras.primaryIssue || null);
    await substrateCall('POST', '/structured/events', {
      body: {
        scope,
        event_type: usableForLearning ? 'voice_attempt' : 'voice_attempt_rejected',
        payload: {
          targetPreset: attemptRecord?.targetPreset || null,
          primaryIssue,
          attemptId: attemptRecord?.attemptId || null,
          sessionId: attemptRecord?.sessionId || null,
          targetHitPct: normalizeFiniteNumber(attemptRecord?.targetHitPct, null),
          meanPitchHz: normalizeFiniteNumber(attemptRecord?.meanPitchHz, null),
          evaluationCount: Array.isArray(evaluations) ? evaluations.length : 0,
          usableForLearning,
          measurementRejectionReasons: Array.isArray(attemptRecord?.measurementRejectionReasons)
            ? attemptRecord.measurementRejectionReasons
            : [],
        },
      },
    });
  } catch {
    // fail-soft
  }
}

// Read-side enrichment from the substrate. Returns a compact, optional object
// or null. ALWAYS resolves; never throws. Designed to be merged into the
// snapshot as a NEW field without altering any existing local signal, so the
// coaching turn falls back to the file-backed model whenever this is null.
async function readSubstrateEnrichment(learnerId, substrateCall = structuredCall) {
  if (typeof substrateCall !== 'function') return null;
  const scope = buildStudentScope(learnerId);
  if (!scope) return null;

  const query = {
    scope_type: scope.scope_type,
    scope_id: scope.scope_id,
    ...(scope.tenant_id ? { tenant_id: scope.tenant_id } : {}),
  };

  let mastery = null;
  try {
    const masteryResp = await substrateCall('GET', '/structured/mastery', { query });
    if (masteryResp && masteryResp.success !== false && Array.isArray(masteryResp.skills) && masteryResp.skills.length) {
      mastery = masteryResp.skills;
    }
  } catch {
    mastery = null;
  }

  let due = null;
  try {
    const dueResp = await substrateCall('GET', '/structured/review/due', { query: { ...query, limit: REVIEW_QUEUE_LIMIT } });
    if (dueResp && dueResp.success !== false && Array.isArray(dueResp.due) && dueResp.due.length) {
      due = dueResp.due;
    }
  } catch {
    due = null;
  }

  if (!mastery && !due) return null;
  return {
    source: 'structured-memory',
    masterySkills: mastery,
    reviewDue: due,
  };
}

function normalizeConsent(value = {}) {
  const source = isRecord(value) ? value : {};
  const status = normalizeText(source.status, 40).toLowerCase();
  return {
    status: ['granted', 'denied', 'unknown'].includes(status) ? status : 'unknown',
    updatedAt: normalizeFiniteNumber(source.updatedAt, null),
    source: normalizeText(source.source, 120) || null,
  };
}

function normalizeEligibility(value = {}) {
  const source = isRecord(value) ? value : {};
  const status = normalizeText(source.status, 40).toLowerCase();
  return {
    status: ['eligible', 'ineligible', 'unknown'].includes(status) ? status : 'unknown',
    updatedAt: normalizeFiniteNumber(source.updatedAt, null),
    reason: normalizeText(source.reason, 180) || null,
  };
}

// v6: transition direction — an explicit, learner-correctable identity anchor so
// the coach uses the right pronouns/language.
// 2026-07-26 MTF-ONLY: 'ftm' is retired; a stored ftm profile degrades to
// 'unspecified' through the existing unknown-value path, which is the same
// fail-closed "no direction claimed" state an unset profile already produces.
function normalizeDirection(value) {
  const d = normalizeText(value, 20).toLowerCase();
  return ['mtf', 'neutral', 'unspecified'].includes(d) ? d : 'unspecified';
}

// v2 learner memo: the "who the person is" block (name + topics/hobbies the
// phrase content can be drawn from). Additive, normalized, length-capped.
// v6: + identity anchors (pronouns/direction/goal). pronouns is a HARD recall constraint.
function normalizeLearnerProfile(value = {}) {
  const source = isRecord(value) ? value : {};
  return {
    displayName: normalizeText(source.displayName, 80),
    pronouns: normalizeText(source.pronouns, 40),
    direction: normalizeDirection(source.direction),
    goal: normalizeText(source.goal, 200),
    topics: uniqueStrings(Array.isArray(source.topics) ? source.topics : [], PROFILE_TOPIC_LIMIT),
    hobbies: uniqueStrings(Array.isArray(source.hobbies) ? source.hobbies : [], PROFILE_HOBBY_LIMIT),
  };
}

// v2 learner memo: the last reference voice the learner practiced against, so a
// returning session can re-attach it (welcome-back card) and the memo can name
// it. clipId is the durable handle; name/summary are display text.
function normalizeLastReference(value = {}) {
  const source = isRecord(value) ? value : {};
  return {
    clipId: normalizeText(source.clipId, 160),
    name: normalizeText(source.name, 160),
    summary: normalizeText(source.summary, 240),
  };
}

function createDefaultProfile(studentId, nowValue) {
  const targetBinding = createDefaultTargetBinding(nowValue);
  const learningByTarget = {
    [targetBinding.targetKey]: emptyTargetLearningBucket(),
  };
  return {
    schemaVersion: LEARNER_CONTEXT_SCHEMA_VERSION,
    studentId: normalizeStudentId(studentId),
    createdAt: nowValue,
    updatedAt: nowValue,
    enabled: true,
    consent: normalizeConsent(),
    eligibility: normalizeEligibility(),
    exclusions: [],
    preferences: {
      learningPace: 'moderate',
      preferredStyle: 'practical',
    },
    // v2 learner memo: who the person is (drives greeting + phrase content).
    profile: {
      displayName: '',
      pronouns: '',
      direction: 'unspecified',
      goal: '',
      topics: [],
      hobbies: [],
    },
    voice: {
      targetBinding,
      targetPreset: targetBinding.targetPreset,
      targetSource: targetBinding.targetSource,
      targetKey: targetBinding.targetKey,
      targetProfileId: targetBinding.targetProfileId,
      targetAnalysisVersion: targetBinding.analysisVersion,
      targetHistory: [],
      learningByTarget,
      // Beginner skill acquisition is learner-level: changing a reference target
      // must not erase pitch/resonance skills the learner already acquired.
      beginnerMastery: normalizeBeginnerMasteryState(null),
      conceptStats: {},
      // v5: per-concept SM-2 review schedule {conceptId:{ease,intervalDays,reps,lapses,dueAt}}.
      reviewSchedule: {},
      recentAttempts: [],
      reviewQueue: [],
      struggles: [],
      // v6: what to AVOID / what didn't work (coach-facing, mirror of struggles).
      avoid: [],
      // v2 learner memo: cues/concepts that have clicked (mirror of struggles).
      // v4: entries are {text, axis?, date} (back-compat-normalized from strings).
      whatWorked: [],
      // v3 one-real-sentence: the daily sentences the person is carrying into the
      // world (newest first, cap 60). See lessons/real-sentence.js.
      realSentences: [],
      // v4 tutor-memory (gaps 2-4):
      //   sessions: per-session log ring (newest LAST, cap 60) for the sense of time.
      //   lastSessionAt: ms epoch of the most recent session end ('' when none).
      //   moments: identity-moments {kind,text,date} (newest first, cap 40).
      //   coachPreferences: {text,date} coaching prefs the tutor remembered (cap 10).
      sessions: [],
      lastSessionAt: '',
      // v5: compact pointer/state for one continuing spoken Coach lesson.
      // Rich lesson state stays in the standalone session store.
      coachCheckpoint: null,
      moments: [],
      coachPreferences: [],
      // v2 learner memo: last reference voice (re-attachable on return).
      lastReference: { clipId: '', name: '', summary: '' },
      notepadHandoff: null,
      // Phase 1.3: per-targetPreset frozen baseline snapshots. Keyed by preset id.
      // Each entry is created on the first BASELINE_FREEZE_THRESHOLD takes
      // for that preset and never overwritten.
      baseline: {},
    },
  };
}

function normalizeProfile(rawProfile, studentId, nowValue) {
  const source = isRecord(rawProfile) ? rawProfile : {};
  const voice = isRecord(source.voice) ? source.voice : {};
  const targetBinding = normalizeTargetBinding(voice.targetBinding, {
    presetId: voice.selectedCustomPresetId,
    presetName: voice.selectedCustomPresetName,
    referenceClipId: voice.lastReference?.clipId,
    targetPreset: voice.targetPreset,
    targetSource: voice.targetSource,
    targetKey: voice.targetKey,
    targetProfileId: voice.targetProfileId,
    analysisVersion: voice.targetAnalysisVersion,
    updatedAt: voice.targetBinding?.updatedAt || source.updatedAt,
  }) || createDefaultTargetBinding(nowValue);
  const learningByTarget = normalizeLearningByTarget(
    voice.learningByTarget,
    targetBinding.targetKey,
    voice,
  );
  const activeLearning = normalizeTargetLearningBucket(learningByTarget[targetBinding.targetKey]);
  return {
    ...createDefaultProfile(studentId, nowValue),
    ...source,
    schemaVersion: LEARNER_CONTEXT_SCHEMA_VERSION,
    studentId: normalizeStudentId(source.studentId || studentId),
    createdAt: normalizeTimestamp(source.createdAt, () => nowValue),
    updatedAt: normalizeTimestamp(source.updatedAt, () => nowValue),
    enabled: normalizeBoolean(source.enabled, true),
    consent: normalizeConsent(source.consent),
    eligibility: normalizeEligibility(source.eligibility),
    exclusions: uniqueStrings(Array.isArray(source.exclusions) ? source.exclusions : [], 20),
    preferences: {
      learningPace: normalizeText(source.preferences?.learningPace, 80) || 'moderate',
      preferredStyle: normalizeText(source.preferences?.preferredStyle, 80) || 'practical',
    },
    // v2 learner memo: normalized "who the person is" block (back-compat: absent
    // on v1 files -> empty defaults via normalizeLearnerProfile({}) ).
    profile: normalizeLearnerProfile(source.profile),
    voice: {
      targetBinding,
      targetPreset: targetBinding.targetPreset,
      targetSource: targetBinding.targetSource,
      targetKey: targetBinding.targetKey,
      targetProfileId: targetBinding.targetProfileId,
      targetAnalysisVersion: targetBinding.analysisVersion,
      targetHistory: Array.isArray(voice.targetHistory) ? voice.targetHistory.filter(isRecord).slice(-TARGET_HISTORY_LIMIT) : [],
      learningByTarget,
      beginnerMastery: normalizeBeginnerMasteryState(voice.beginnerMastery),
      conceptStats: activeLearning.conceptStats,
      // v5: SM-2 review schedule (back-compat: absent on <=v4 files -> {}).
      reviewSchedule: activeLearning.reviewSchedule,
      recentAttempts: Array.isArray(voice.recentAttempts) ? voice.recentAttempts.filter(isRecord).slice(-RECENT_ATTEMPT_LIMIT) : [],
      reviewQueue: activeLearning.reviewQueue,
      struggles: activeLearning.struggles,
      avoid: activeLearning.avoid,
      // v2 learner memo / v4: what clicked, now {text,axis?,date} (deduped by text,
      // capped). Back-compat: legacy string entries normalize to {text,axis:null,date:''}.
      whatWorked: activeLearning.whatWorked,
      // v3 one-real-sentence: drop empties, keep newest-first order, cap at 60.
      // Back-compat: absent on v1/v2 files -> [] via normalizeRealSentences([]).
      realSentences: normalizeRealSentences(voice.realSentences),
      // v4 tutor-memory: sense-of-time + identity-moments + coaching prefs. All
      // absent on v1/v2/v3 files -> [] / '' via the normalizers below.
      sessions: normalizeSessionsList(voice.sessions),
      lastSessionAt: normalizeFiniteNumber(voice.lastSessionAt, null) != null
        ? Math.round(Number(voice.lastSessionAt))
        : '',
      coachCheckpoint: normalizeCoachCheckpoint(voice.coachCheckpoint),
      moments: normalizeMomentsList(voice.moments),
      coachPreferences: normalizeCoachPreferencesList(voice.coachPreferences),
      lastReference: normalizeLastReference(voice.lastReference),
      notepadHandoff: isRecord(voice.notepadHandoff) ? voice.notepadHandoff : null,
      // Phase 1.3: baseline is keyed by targetPreset. Always a plain object;
      // missing presets are filled in lazily on the next recordVoiceAttempt.
      baseline: normalizeBaselineMap(voice.baseline),
    },
  };
}

// ---------------------------------------------------------------------------
// Phase 1.3: Baseline capture
// ---------------------------------------------------------------------------

/**
 * Normalize a single baseline snapshot. Each field is independently null-coerced
 * — partial data is OK (we use whatever we have for the few deltas we compute).
 */
function normalizeBaselineSnapshot(value) {
  if (!isRecord(value)) return null;
  const capturedAt = normalizeFiniteNumber(value.capturedAt, null);
  if (!capturedAt) return null; // A captured snapshot must have a timestamp.
  return {
    targetKey: normalizeVoiceTargetKey(value.targetKey),
    targetSource: canonicalizeVoiceTargetSource(value.targetSource),
    targetProfileId: normalizeText(value.targetProfileId, 160) || null,
    analysisVersion: normalizeText(value.analysisVersion, 120) || null,
    // v4 baseline honesty: the analyzer calibration the frozen averages below were
    // MEASURED under. Absent on every baseline frozen before 2026-07-26, which is
    // exactly why null must read as "unknown calibration" (=> not comparable), never
    // as "same as whatever is running now".
    measurementAnalysisVersion: normalizeText(value.measurementAnalysisVersion, 120) || null,
    targetPreset: normalizeText(value.targetPreset, 80) || 'cute-feminine',
    capturedAt,
    attemptCount: Math.max(1, Math.min(20, Math.round(normalizeFiniteNumber(value.attemptCount, 3) || 3))),
    source: normalizeText(value.source, 80) || 'first-three-takes',
    // Frozen metric averages
    meanPitchHz: normalizeFiniteNumber(value.meanPitchHz, null),
    pitchRangeSt: normalizeFiniteNumber(value.pitchRangeSt, null),
    pitchP10Hz: normalizeFiniteNumber(value.pitchP10Hz, null),
    pitchP90Hz: normalizeFiniteNumber(value.pitchP90Hz, null),
    pitchStdSt: normalizeFiniteNumber(value.pitchStdSt, null),
    resonanceMean: normalizeFiniteNumber(value.resonanceMean, null),
    weightMean: normalizeFiniteNumber(value.weightMean, null),
    targetHitPct: normalizeFiniteNumber(value.targetHitPct, null),
    // Advanced / quality
    pitchTargetOccupancyPct: normalizeFiniteNumber(value.pitchTargetOccupancyPct, null),
    phraseFinalDropSemitones: normalizeFiniteNumber(value.phraseFinalDropSemitones, null),
    harmonicRatioMean: normalizeFiniteNumber(value.harmonicRatioMean, null),
    spectralCentroidMeanHz: normalizeFiniteNumber(value.spectralCentroidMeanHz, null),
    cppsLike: normalizeFiniteNumber(value.cppsLike, null),
    harmonicStrength: normalizeFiniteNumber(value.harmonicStrength, null),
    breathyRisk: normalizeFiniteNumber(value.breathyRisk, null),
    strainRisk: normalizeFiniteNumber(value.strainRisk, null),
    formantF2MedianHz: normalizeFiniteNumber(value.formantF2MedianHz, null),
    frontnessScore: normalizeFiniteNumber(value.frontnessScore, null),
    sampleArtifactIds: Array.isArray(value.sampleArtifactIds)
      ? value.sampleArtifactIds.filter((id) => typeof id === 'string').slice(0, 8)
      : [],
    frozen: true,
  };
}

function normalizeBaselineMap(value) {
  if (!isRecord(value)) return {};
  const out = {};
  let count = 0;
  for (const [preset, snapshot] of Object.entries(value)) {
    if (count >= BASELINE_PRESET_KEY_LIMIT) break;
    const normalized = normalizeBaselineSnapshot(snapshot);
    if (normalized) {
      out[preset] = normalized;
      count += 1;
    }
  }
  return out;
}

/**
 * Build a baseline snapshot from a list of attempts (already filtered to a
 * single targetPreset). Returns null if there aren't enough attempts.
 *
 * The attempt list is the FULL set of recent takes for that preset — not just
 * the first 3 — so a snapshot can also be reconstructed manually if needed.
 *
 * v4 baseline honesty (2026-07-26): `measurementVersion` is the analyzer
 * calibration the resulting baseline is declared to be measured under, and the
 * sample set is filtered to takes carrying exactly that stamp. Averaging across
 * calibrations would bake the instrument change INTO the baseline, so that every
 * later comparison reported part of a measurement change as learner progress —
 * the precise dishonesty this field exists to prevent. Returns null (no capture,
 * any existing snapshot left untouched) until enough same-calibration takes exist.
 */
function baselineMeasurementVersionOf(record) {
  return normalizeText(record?.measurementAnalysisVersion, 120) || null;
}

function buildBaselineFromAttempts(identity, attempts, nowValue, measurementVersion = null) {
  const learningAttempts = (Array.isArray(attempts) ? attempts : [])
    .filter((attempt) => attempt?.usableForLearning !== false)
    .filter((attempt) => baselineMeasurementVersionOf(attempt) === measurementVersion);
  if (learningAttempts.length < BASELINE_FREEZE_THRESHOLD) {
    return null;
  }
  // Take the first N attempts (chronologically).
  const samples = learningAttempts.slice(0, BASELINE_FREEZE_THRESHOLD);
  const safeMean = (key) => {
    const values = samples
      .map((a) => normalizeFiniteNumber(a?.[key], null))
      .filter((v) => v != null);
    if (values.length === 0) return null;
    return values.reduce((s, v) => s + v, 0) / values.length;
  };
  return {
    targetKey: identity.targetKey,
    targetSource: identity.targetSource,
    targetProfileId: identity.targetProfileId || null,
    analysisVersion: identity.analysisVersion || null,
    measurementAnalysisVersion: measurementVersion,
    targetPreset: identity.targetPreset,
    capturedAt: nowValue,
    attemptCount: samples.length,
    source: 'first-three-takes',
    meanPitchHz: safeMean('meanPitchHz'),
    pitchRangeSt: safeMean('pitchRangeSt'),
    pitchP10Hz: safeMean('pitchP10Hz'),
    pitchP90Hz: safeMean('pitchP90Hz'),
    pitchStdSt: safeMean('pitchStdSt'),
    resonanceMean: safeMean('resonanceMean'),
    weightMean: safeMean('weightMean'),
    targetHitPct: safeMean('targetHitPct'),
    pitchTargetOccupancyPct: safeMean('pitchTargetOccupancyPct'),
    phraseFinalDropSemitones: safeMean('phraseFinalDropSemitones'),
    harmonicRatioMean: safeMean('harmonicRatioMean'),
    spectralCentroidMeanHz: safeMean('spectralCentroidMeanHz'),
    cppsLike: safeMean('cppsLike'),
    harmonicStrength: safeMean('harmonicStrength'),
    breathyRisk: safeMean('breathyRisk'),
    strainRisk: safeMean('strainRisk'),
    formantF2MedianHz: safeMean('formantF2MedianHz'),
    frontnessScore: safeMean('frontnessScore'),
    sampleArtifactIds: samples.map((a) => a.attemptId).filter(Boolean).slice(0, 8),
    frozen: true,
  };
}

/**
 * Should a frozen baseline be replaced because the measuring instrument changed?
 *
 * v4 baseline honesty (2026-07-26). A frozen baseline is a promise that its
 * numbers and a later take are on one scale. When the analyzer's calibration
 * moves (VOICE_ANALYSIS_VERSION v3 -> `voice-metrics-v4-formants`, where a
 * front-vowel F2 misread of ~798 vs a true 2761 Hz was repaired), that promise is
 * void: the same voice now measures differently. Such a baseline is not evidence
 * of where the learner started, so it is eligible for replacement rather than
 * frozen forever. A missing stamp on either side is UNKNOWN calibration and is
 * treated as a mismatch — the fail-closed direction, because the alternative is
 * to assume a pre-v4 snapshot was measured by the current instrument.
 */
function isBaselineCalibrationStale(existingBaseline, takeMeasurementVersion) {
  if (!existingBaseline || !existingBaseline.frozen) return false;
  const baselineVersion = baselineMeasurementVersionOf(existingBaseline);
  if (baselineVersion === null || takeMeasurementVersion === null) return true;
  return baselineVersion !== takeMeasurementVersion;
}

/**
 * Capture a baseline for the given preset if (a) no baseline exists yet or the
 * frozen one was measured under a different analyzer calibration, and (b) we have
 * at least BASELINE_FREEZE_THRESHOLD takes for that preset on the CURRENT
 * calibration.
 *
 * Returns the new baseline entry, or null if no capture happened.
 */
function captureBaselineIfReady(voiceProfile, identity, nowValue, measurementVersion = null) {
  if (!identity?.valid || !identity.targetKey) return null;
  const existing = voiceProfile?.baseline?.[identity.targetKey];
  // Never overwrite a frozen snapshot — unless the instrument that produced it
  // has been replaced, in which case it is no longer a baseline of anything.
  if (existing && existing.frozen && !isBaselineCalibrationStale(existing, measurementVersion)) {
    return null;
  }
  const allForTarget = (voiceProfile?.recentAttempts || [])
    .filter((attempt) => isVoiceRecordComparableToTarget(attempt, identity))
    // recentAttempts is stored newest-last, so reverse for chronological order
    .slice()
    .reverse();
  return buildBaselineFromAttempts(identity, allForTarget, nowValue, measurementVersion);
}

function createLearnerContextService(options = {}) {
  const {
    fsModule = fs,
    logger = console,
    now = () => Date.now(),
    storageRoot = DEFAULT_LEARNER_CONTEXT_ROOT,
  } = options;
  const structuredMemoryEnabled = options.structuredMemoryEnabled === true
    || typeof options.structuredCall === 'function';
  const substrateCall = structuredMemoryEnabled
    ? (typeof options.structuredCall === 'function' ? options.structuredCall : structuredCall)
    : null;
  const resolvedStorageRoot = path.resolve(storageRoot);
  const studentsRoot = path.join(resolvedStorageRoot, 'students');
  const eventsRoot = path.join(resolvedStorageRoot, 'events');
  const eventMaxBytes = Number.isFinite(Number(options.eventMaxBytes))
    ? Math.max(4096, Math.round(Number(options.eventMaxBytes)))
    : DEFAULT_EVENT_MAX_BYTES;
  const writeBlockedStudents = new Set();
  const storageHealth = {
    status: 'healthy',
    lastSuccessAt: null,
    lastError: null,
    lastQuarantinePath: null,
    recoveries: 0,
    failures: 0,
  };

  function getProfilePath(studentId) {
    return path.join(studentsRoot, `${getStudentFileKey(studentId)}.json`);
  }

  function getEventsPath(studentId) {
    return path.join(eventsRoot, `${getStudentFileKey(studentId)}.jsonl`);
  }

  function getProfileBackupPath(studentId) {
    return `${getProfilePath(studentId)}.bak`;
  }

  function removeFileIfPresent(filePath) {
    if (!fsModule.existsSync(filePath)) return false;
    if (typeof fsModule.unlinkSync === 'function') {
      fsModule.unlinkSync(filePath);
    } else if (fsModule.files && typeof fsModule.files.delete === 'function') {
      fsModule.files.delete(filePath);
    } else {
      return false;
    }
    return true;
  }

  function parseRecordFile(filePath) {
    const parsed = JSON.parse(fsModule.readFileSync(filePath, 'utf8'));
    if (!isRecord(parsed)) {
      throw new Error('JSON root must be an object');
    }
    return parsed;
  }

  function quarantineFile(filePath, studentId, reason) {
    if (!fsModule.existsSync(filePath)) return null;
    const quarantinePath = `${filePath}.corrupt.${now()}`;
    try {
      fsModule.renameSync(filePath, quarantinePath);
      if (typeof fsModule.chmodSync === 'function') {
        try { fsModule.chmodSync(quarantinePath, 0o600); } catch { /* best effort */ }
      }
      storageHealth.lastQuarantinePath = quarantinePath;
      return quarantinePath;
    } catch (error) {
      logger.warn?.(`[LearnerContext] Failed to quarantine ${filePath}: ${error.message}`);
      writeBlockedStudents.add(normalizeStudentId(studentId));
      storageHealth.lastError = `${reason}: quarantine failed`;
      return null;
    }
  }

  function readProfile(studentId) {
    const normalizedStudentId = normalizeStudentId(studentId);
    if (writeBlockedStudents.has(normalizedStudentId)) {
      throw new Error(`Learner context for ${normalizedStudentId} is corrupt; writes are blocked until it is deleted or restored.`);
    }
    const nowValue = now();
    const profilePath = getProfilePath(normalizedStudentId);
    if (!fsModule.existsSync(profilePath)) {
      return normalizeProfile(null, normalizedStudentId, nowValue);
    }
    try {
      const profile = normalizeProfile(parseRecordFile(profilePath), normalizedStudentId, nowValue);
      storageHealth.status = storageHealth.recoveries > 0 ? 'recovered' : 'healthy';
      storageHealth.lastSuccessAt = nowValue;
      storageHealth.lastError = null;
      return profile;
    } catch (primaryError) {
      storageHealth.failures += 1;
      quarantineFile(profilePath, normalizedStudentId, primaryError.message);
      const backupPath = getProfileBackupPath(normalizedStudentId);
      try {
        if (!fsModule.existsSync(backupPath)) throw new Error('no previous valid generation');
        const recovered = normalizeProfile(parseRecordFile(backupPath), normalizedStudentId, nowValue);
        writeJsonFile(fsModule, profilePath, recovered);
        storageHealth.status = 'recovered';
        storageHealth.recoveries += 1;
        storageHealth.lastSuccessAt = nowValue;
        storageHealth.lastError = null;
        writeBlockedStudents.delete(normalizedStudentId);
        logger.warn?.(`[LearnerContext] Recovered ${normalizedStudentId} from its previous valid generation.`);
        return recovered;
      } catch (backupError) {
        writeBlockedStudents.add(normalizedStudentId);
        storageHealth.status = 'failed';
        storageHealth.lastError = `profile corruption: ${backupError.message}`;
        throw new Error(`Learner context is corrupt and no valid previous generation is available: ${backupError.message}`);
      }
    }
  }

  function writeProfile(profile) {
    const normalizedStudentId = normalizeStudentId(profile?.studentId);
    if (writeBlockedStudents.has(normalizedStudentId)) {
      throw new Error(`Learner context for ${normalizedStudentId} is corrupt; writes are blocked until it is deleted or restored.`);
    }
    const normalized = normalizeProfile(profile, normalizedStudentId, now());
    const profilePath = getProfilePath(normalized.studentId);
    if (fsModule.existsSync(profilePath)) {
      try {
        const currentRaw = fsModule.readFileSync(profilePath, 'utf8');
        const currentParsed = JSON.parse(currentRaw);
        if (!isRecord(currentParsed)) throw new Error('JSON root must be an object');
        writeJsonFile(fsModule, getProfileBackupPath(normalized.studentId), currentParsed);
      } catch (error) {
        writeBlockedStudents.add(normalized.studentId);
        storageHealth.status = 'failed';
        storageHealth.failures += 1;
        storageHealth.lastError = `refused to overwrite unreadable profile: ${error.message}`;
        throw new Error(`Learner context is corrupt; refusing to overwrite it: ${error.message}`);
      }
    }
    writeJsonFile(fsModule, profilePath, normalized);
    storageHealth.status = storageHealth.recoveries > 0 ? 'recovered' : 'healthy';
    storageHealth.lastSuccessAt = now();
    storageHealth.lastError = null;
    return normalized;
  }

  function appendBoundedEvent(eventPath, event) {
    const serializedEvent = JSON.stringify(event);
    const originalBytes = Buffer.byteLength(`${serializedEvent}\n`);
    const boundedEvent = originalBytes <= eventMaxBytes
      ? event
      : {
        schemaVersion: LEARNER_CONTEXT_EVENT_SCHEMA_VERSION,
        type: 'event_payload_oversize',
        studentId: normalizeStudentId(event?.studentId),
        occurredAt: Number(event?.occurredAt) || now(),
        payload: {
          originalType: normalizeText(event?.type, 80) || 'learner_context_event',
          originalBytes,
          sha256: crypto.createHash('sha256').update(serializedEvent).digest('hex'),
        },
      };
    const line = `${JSON.stringify(boundedEvent)}\n`;
    let prior = '';
    if (fsModule.existsSync(eventPath)) {
      try {
        prior = String(fsModule.readFileSync(eventPath, 'utf8') || '');
      } catch {
        prior = '';
      }
    }
    if (Buffer.byteLength(prior) + Buffer.byteLength(line) > eventMaxBytes && prior) {
      const previousPath = `${eventPath}.previous`;
      const summaryPath = `${eventPath}.summary.json`;
      let previousHash = null;
      try {
        if (fsModule.existsSync(summaryPath)) {
          previousHash = parseRecordFile(summaryPath).sha256 || null;
        }
      } catch {
        previousHash = null;
      }
      const sha256 = crypto.createHash('sha256').update(prior).digest('hex');
      ensureDirectory(fsModule, path.dirname(previousPath));
      fsModule.writeFileSync(previousPath, prior, { encoding: 'utf8', mode: 0o600 });
      try { fsModule.chmodSync?.(previousPath, 0o600); } catch { /* best effort */ }
      writeJsonFile(fsModule, summaryPath, {
        schemaVersion: 'sloane.learner_context.event_archive_summary.v1',
        rotatedAt: now(),
        bytes: Buffer.byteLength(prior),
        sha256,
        previousSha256: previousHash,
      });
      fsModule.writeFileSync(eventPath, line, { encoding: 'utf8', mode: 0o600 });
      try { fsModule.chmodSync?.(eventPath, 0o600); } catch { /* best effort */ }
      return;
    }
    appendJsonlFile(fsModule, eventPath, boundedEvent);
  }

  function appendEvent(studentId, type, payload = {}) {
    const normalizedStudentId = normalizeStudentId(studentId);
    const event = {
      schemaVersion: LEARNER_CONTEXT_EVENT_SCHEMA_VERSION,
      type: normalizeText(type, 80) || 'learner_context_event',
      studentId: normalizedStudentId,
      occurredAt: now(),
      payload: isRecord(payload) ? payload : {},
    };
    appendBoundedEvent(getEventsPath(normalizedStudentId), event);
    return event;
  }

  function updateProfile(studentId, updater, eventType = 'learner_context_updated', eventPayload = {}) {
    const current = readProfile(studentId);
    const updated = typeof updater === 'function' ? updater(current) : current;
    const normalized = writeProfile({
      ...updated,
      updatedAt: now(),
    });
    const resolvedEventType = typeof eventType === 'function'
      ? eventType({ current, updated, normalized })
      : eventType;
    if (resolvedEventType) {
      const resolvedEventPayload = typeof eventPayload === 'function'
        ? eventPayload({ current, updated, normalized })
        : eventPayload;
      appendEvent(normalized.studentId, resolvedEventType, {
        ...(isRecord(resolvedEventPayload) ? resolvedEventPayload : {}),
        consentStatus: normalized.consent.status,
        eligibilityStatus: normalized.eligibility.status,
        excludedFromExport: normalized.exclusions.length > 0,
      });
    }
    return normalized;
  }

  function setDatasetControls(studentId, controls = {}) {
    return updateProfile(studentId, (profile) => ({
      ...profile,
      consent: Object.prototype.hasOwnProperty.call(controls, 'consent')
        ? normalizeConsent(controls.consent)
        : profile.consent,
      eligibility: Object.prototype.hasOwnProperty.call(controls, 'eligibility')
        ? normalizeEligibility(controls.eligibility)
        : profile.eligibility,
      exclusions: Object.prototype.hasOwnProperty.call(controls, 'exclusions')
        ? uniqueStrings(Array.isArray(controls.exclusions) ? controls.exclusions : [], 20)
        : profile.exclusions,
    }), 'dataset_controls_updated');
  }

  function setActiveVoiceTarget(studentId, bindingInput = {}) {
    const binding = normalizeTargetBinding(bindingInput);
    if (!binding?.targetKey) {
      throw new Error('Voice target binding is incomplete or invalid.');
    }
    if (
      binding.targetSource !== 'built-in'
      && !binding.presetId
    ) {
      throw new Error('A custom voice target binding requires its saved preset.');
    }
    if (
      binding.targetSource.includes('reference')
      && !binding.referenceClipId
    ) {
      throw new Error('A reference voice target binding requires its reference clip.');
    }
    const updatedAt = now();
    const nextBinding = { ...binding, updatedAt };
    return updateProfile(studentId, (profile) => {
      const learningByTarget = {
        ...(isRecord(profile.voice.learningByTarget) ? profile.voice.learningByTarget : {}),
      };
      if (!learningByTarget[nextBinding.targetKey]) {
        learningByTarget[nextBinding.targetKey] = emptyTargetLearningBucket();
      }
      const targetHistory = [
        ...(profile.voice.targetHistory || []).filter((entry) => entry?.targetKey !== nextBinding.targetKey),
        {
          targetKey: nextBinding.targetKey,
          targetPreset: nextBinding.targetPreset,
          targetSource: nextBinding.targetSource,
          targetProfileId: nextBinding.targetProfileId,
          analysisVersion: nextBinding.analysisVersion,
          presetId: nextBinding.presetId,
          referenceClipId: nextBinding.referenceClipId,
          updatedAt,
        },
      ].slice(-TARGET_HISTORY_LIMIT);
      const projectedVoice = applyActiveLearningProjection({
        ...profile.voice,
        targetBinding: nextBinding,
        targetPreset: nextBinding.targetPreset,
        targetSource: nextBinding.targetSource,
        targetKey: nextBinding.targetKey,
        targetProfileId: nextBinding.targetProfileId,
        targetAnalysisVersion: nextBinding.analysisVersion,
        targetHistory,
        lastReference: nextBinding.referenceClipId
          ? normalizeLastReference({
            clipId: nextBinding.referenceClipId,
            name: nextBinding.presetName || profile.voice.lastReference?.name || '',
            summary: profile.voice.lastReference?.summary || '',
          })
          : profile.voice.lastReference,
      }, learningByTarget, nextBinding.targetKey);
      return { ...profile, voice: projectedVoice };
    }, 'voice_target_bound', {
      target_identity_present: true,
      target_source: nextBinding.targetSource,
    });
  }


function getTargetMotorMap(studentId, targetKey = null) {
  const profile = readProfile(studentId);
  const hasExplicitTarget = targetKey != null && String(targetKey).trim() !== '';
  const explicitTargetKey = hasExplicitTarget ? normalizeVoiceTargetKey(targetKey) : null;
  if (hasExplicitTarget && !explicitTargetKey) {
    throw new Error('Target learning bucket key is invalid.');
  }
  const activeTargetKey = profile.voice.targetBinding?.targetKey || profile.voice.targetKey || null;
  const resolvedTargetKey = explicitTargetKey || activeTargetKey;
  if (!resolvedTargetKey) return normalizeMotorMap(null);
  const bucket = profile.voice.learningByTarget?.[resolvedTargetKey] || null;
  return normalizeMotorMap(bucket?.motorMap);
}

function updateTargetMotorMap(studentId, { targetKey = null, motorMap = null } = {}) {
  const hasExplicitTarget = targetKey != null && String(targetKey).trim() !== '';
  const explicitTargetKey = hasExplicitTarget ? normalizeVoiceTargetKey(targetKey) : null;
  if (hasExplicitTarget && !explicitTargetKey) {
    throw new Error('Target learning bucket key is invalid.');
  }
  const normalizedMotorMap = normalizeMotorMap(motorMap);
  return updateProfile(studentId, (profile) => {
    const activeTargetKey = profile.voice.targetBinding?.targetKey || profile.voice.targetKey || null;
    const resolvedTargetKey = explicitTargetKey || activeTargetKey;
    if (!resolvedTargetKey) {
      throw new Error('Target learning bucket is unavailable for motor-map persistence.');
    }
    const learningByTarget = {
      ...(isRecord(profile.voice.learningByTarget) ? profile.voice.learningByTarget : {}),
    };
    if (explicitTargetKey && !learningByTarget[resolvedTargetKey]) {
      throw new Error('Target learning bucket does not exist for this learner.');
    }
    if (!learningByTarget[resolvedTargetKey]) {
      if (resolvedTargetKey !== activeTargetKey) {
        throw new Error('Target learning bucket does not exist for this learner.');
      }
      learningByTarget[resolvedTargetKey] = emptyTargetLearningBucket();
    }
    const bucket = normalizeTargetLearningBucket(learningByTarget[resolvedTargetKey]);
    learningByTarget[resolvedTargetKey] = {
      ...bucket,
      motorMap: normalizedMotorMap,
    };
    return {
      ...profile,
      voice: applyActiveLearningProjection(profile.voice, learningByTarget, activeTargetKey),
    };
  }, 'voice_target_motor_map_updated', {
    // No target keys or cue IDs in the generic learner event log.
    target_identity_present: true,
    cue_count: Object.keys(normalizedMotorMap.byCue || {}).length,
  });
}


  function getBeginnerMastery(studentId) {
    const profile = readProfile(studentId);
    return normalizeBeginnerMasteryState(profile.voice.beginnerMastery);
  }

  function updateBeginnerMastery(studentId, { mastery = null } = {}) {
    const normalizedMastery = normalizeBeginnerMasteryState(mastery);
    return updateProfile(studentId, (profile) => ({
      ...profile,
      voice: {
        ...profile.voice,
        beginnerMastery: normalizedMastery,
      },
    }), 'voice_beginner_mastery_updated', {
      // Keep the generic learner event compact: no cue IDs, attempt IDs, or
      // per-step counters are duplicated into the event log.
      curriculum_phase: normalizedMastery.curriculumPhase,
    });
  }

  // v2 learner memo: write the "who the person is" block + optionally append
  // wins. Mirrors setDatasetControls' has-own-property gating so a partial body
  // only touches the fields it supplies; whatWorked APPENDS (deduped, capped).
  function updateLearnerProfile(studentId, updates = {}) {
    const input = isRecord(updates) ? updates : {};
    return updateProfile(studentId, (profile) => {
      const nextProfile = { ...profile.profile };
      if (Object.prototype.hasOwnProperty.call(input, 'displayName')) {
        nextProfile.displayName = normalizeText(input.displayName, 80);
      }
      if (Object.prototype.hasOwnProperty.call(input, 'topics')) {
        nextProfile.topics = uniqueStrings(Array.isArray(input.topics) ? input.topics : [], PROFILE_TOPIC_LIMIT);
      }
      if (Object.prototype.hasOwnProperty.call(input, 'hobbies')) {
        nextProfile.hobbies = uniqueStrings(Array.isArray(input.hobbies) ? input.hobbies : [], PROFILE_HOBBY_LIMIT);
      }
      // v6: identity anchors — learner-editable (the learner can correct these).
      if (Object.prototype.hasOwnProperty.call(input, 'pronouns')) {
        nextProfile.pronouns = normalizeText(input.pronouns, 40);
      }
      if (Object.prototype.hasOwnProperty.call(input, 'direction')) {
        nextProfile.direction = normalizeDirection(input.direction);
      }
      if (Object.prototype.hasOwnProperty.call(input, 'goal')) {
        nextProfile.goal = normalizeText(input.goal, 200);
      }
      let nextVoice = { ...profile.voice };
      const activeTargetKey = profile.voice.targetBinding?.targetKey || profile.voice.targetKey;
      const learningByTarget = {
        ...(isRecord(profile.voice.learningByTarget) ? profile.voice.learningByTarget : {}),
      };
      const activeLearning = normalizeTargetLearningBucket(
        learningByTarget[activeTargetKey] || targetLearningBucketFromLegacyVoice(profile.voice),
      );
      if (Object.prototype.hasOwnProperty.call(input, 'avoid')) {
        activeLearning.avoid = uniqueStrings(Array.isArray(input.avoid) ? input.avoid : [], STRUGGLE_LIMIT);
      }
      if (Object.prototype.hasOwnProperty.call(input, 'whatWorked')) {
        // Append the supplied wins ahead of the existing list (newest first).
        // v4: entries may be strings or {text,axis?,date}; mergeWhatWorked dedupes
        // by text and normalizes both shapes.
        activeLearning.whatWorked = mergeWhatWorked(
          Array.isArray(input.whatWorked) ? input.whatWorked : [],
          activeLearning.whatWorked,
          WHAT_WORKED_LIMIT,
        );
      }
      if (activeTargetKey) {
        learningByTarget[activeTargetKey] = activeLearning;
        nextVoice = applyActiveLearningProjection(nextVoice, learningByTarget, activeTargetKey);
      }
      return { ...profile, profile: nextProfile, voice: nextVoice };
    }, 'learner_profile_updated');
  }

  // ── v4 tutor-memory apply helpers (the memory-ops channel writes through these,
  //    the sessions ring is written at session end). All additive + fail-soft via
  //    normalizeProfile's default merge; they never disturb the rest of the profile.

  // APPEND topics/hobbies (vs updateLearnerProfile, which REPLACES). Dedupe + cap
  // is enforced by uniqueStrings against PROFILE_*_LIMIT (12). The memory-ops
  // applier routes 'topic'/'hobby' remembers here so existing topics survive.
  function appendLearnerTopics(studentId, topics = []) {
    const additions = Array.isArray(topics) ? topics : [];
    if (!additions.length) return readProfile(studentId);
    return updateProfile(studentId, (profile) => ({
      ...profile,
      profile: {
        ...profile.profile,
        topics: uniqueStrings([...(profile.profile.topics || []), ...additions], PROFILE_TOPIC_LIMIT),
      },
    }), 'learner_profile_updated');
  }

  function appendLearnerHobbies(studentId, hobbies = []) {
    const additions = Array.isArray(hobbies) ? hobbies : [];
    if (!additions.length) return readProfile(studentId);
    return updateProfile(studentId, (profile) => ({
      ...profile,
      profile: {
        ...profile.profile,
        hobbies: uniqueStrings([...(profile.profile.hobbies || []), ...additions], PROFILE_HOBBY_LIMIT),
      },
    }), 'learner_profile_updated');
  }

  // Append an identity-moment {kind, text, date} (newest first, cap 40). date
  // defaults to today's local string when not supplied.
  function addMoment(studentId, moment = {}) {
    const entry = normalizeMomentEntry({
      id: moment.id || `m_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
      kind: moment.kind,
      text: moment.text,
      date: moment.date || localDateStringFor(now()),
    });
    if (!entry) return readProfile(studentId);
    return updateProfile(studentId, (profile) => ({
      ...profile,
      voice: {
        ...profile.voice,
        moments: normalizeMomentsList([entry, ...(profile.voice.moments || [])]),
      },
    }), 'voice_moment_recorded', ({ normalized }) => ({
      momentKind: normalized.voice.moments?.[0]?.kind || null,
    }));
  }

  // Append a coaching preference {text, date} (newest first, cap 10).
  function addCoachPreference(studentId, preference = {}) {
    const entry = normalizeCoachPreferenceEntry(
      typeof preference === 'string'
        ? preference
        : {
          id: preference.id || preference.preferenceId,
          text: preference.text,
          date: preference.date || localDateStringFor(now()),
          source: preference.source,
        },
    );
    if (!entry) return readProfile(studentId);
    if (!entry.date) entry.date = localDateStringFor(now());
    return updateProfile(studentId, (profile) => ({
      ...profile,
      voice: {
        ...profile.voice,
        coachPreferences: normalizeCoachPreferencesList([entry, ...(profile.voice.coachPreferences || [])]),
      },
    }), 'coach_preference_recorded');
  }

  // v6 LEARNER CONTROL: delete a specific moment (by id, or exact text for legacy
  // entries with no id) — basic trust control for a sensitive identity memory.
  function removeMoment(studentId, idOrText) {
    const needle = normalizeText(idOrText, 200);
    if (!needle) return readProfile(studentId);
    return updateProfile(studentId, (profile) => ({
      ...profile,
      voice: {
        ...profile.voice,
        moments: (profile.voice.moments || []).filter((m) => m && m.id !== needle && m.text !== needle),
      },
    }), 'voice_moment_removed');
  }

  // v6 LEARNER CONTROL: delete a coaching preference (matched by normalized text).
  function removeCoachPreference(studentId, idOrText) {
    const needle = normalizeText(idOrText, 200).toLowerCase();
    if (!needle) return readProfile(studentId);
    return updateProfile(studentId, (profile) => ({
      ...profile,
      voice: {
        ...profile.voice,
        coachPreferences: (profile.voice.coachPreferences || []).filter((p) => (
          p
          && String(p.id || '').toLowerCase() !== needle
          && String(p.text || '').toLowerCase() !== needle
        )),
      },
    }), 'coach_preference_removed');
  }

  // v5 spoken-Coach continuity. Partial patches merge nested lesson/practice/
  // preset blocks and normalize to a closed schema. The event payload is
  // categorical on purpose: no line text, pronunciation, preset name, transcript,
  // or coach prose is copied into the append-only event ledger.
  function updateCoachCheckpoint(studentId, patch = {}, metadata = {}) {
    const reason = normalizeText(metadata?.reason, 80) || 'checkpoint-updated';
    return updateProfile(studentId, (profile) => ({
      ...profile,
      voice: {
        ...profile.voice,
        coachCheckpoint: mergeCoachCheckpoint(profile.voice.coachCheckpoint, patch, now()),
      },
    }), 'coach_checkpoint_updated', ({ normalized }) => {
      const checkpoint = normalized.voice.coachCheckpoint;
      return {
        reason,
        state: checkpoint?.state || null,
        restartCount: checkpoint?.restartCount || 0,
        hasPractice: Boolean(checkpoint?.practice?.lineId || checkpoint?.practice?.cardId || checkpoint?.practice?.text),
        hasPreset: Boolean(checkpoint?.preset?.id || checkpoint?.preset?.referenceClipId),
      };
    });
  }

  // v6 LEARNER CONTROL: "forget what you've learned about me" — clears the accumulated
  // MEMORY (moments, preferences, wins, struggles, avoid, sessions, mastery, review
  // state). Keeps the identity the learner explicitly set (name/pronouns/direction/goal).
  function resetLearnerMemory(studentId) {
    return updateProfile(studentId, (profile) => {
      const targetBinding = profile.voice.targetBinding || createDefaultTargetBinding(now());
      const learningByTarget = {
        [targetBinding.targetKey]: emptyTargetLearningBucket(),
      };
      const voice = applyActiveLearningProjection({
        ...profile.voice,
        targetBinding,
        targetPreset: targetBinding.targetPreset,
        targetSource: targetBinding.targetSource,
        targetKey: targetBinding.targetKey,
        targetProfileId: targetBinding.targetProfileId,
        targetAnalysisVersion: targetBinding.analysisVersion,
        targetHistory: [],
        recentAttempts: [],
        beginnerMastery: normalizeBeginnerMasteryState(null),
        moments: [],
        coachPreferences: [],
        sessions: [],
        realSentences: [],
        lastSessionAt: '',
        coachCheckpoint: null,
        lastReference: targetBinding.referenceClipId
          ? normalizeLastReference({
            clipId: targetBinding.referenceClipId,
            name: targetBinding.presetName || '',
            summary: '',
          })
          : normalizeLastReference(),
        notepadHandoff: null,
        baseline: {},
      }, learningByTarget, targetBinding.targetKey);
      return { ...profile, voice };
    }, 'learner_memory_reset');
  }

  // Append a session-end entry to the sessions ring (newest LAST, cap 60) and set
  // voice.lastSessionAt. `session` = {date?, startedAt, minutes, takes, focusAxis,
  // oneLine, sessionId?, endedAt?/at?, endReason?, tier?}. Fail-soft: a malformed
  // entry is dropped and only lastSessionAt is set.
  //
  // B-SESS ring dedupe (idempotence contract): when the entry carries a sessionId,
  // there is at most ONE ring entry per sessionId — a later write for the same
  // session REPLACES the earlier one (moved to the tail, so newest-LAST stays
  // ordered by end signal). 'completed' is terminal: a 'cut-short' write never
  // downgrades an entry already marked 'completed' (that write is a no-op on the
  // ring; lastSessionAt still refreshes). End reasons have an authority order:
  // completed > learner-stopped > cut-short. This is what makes the explicit
  // learner End, pause beacon, staleness sweep, and a clean close converge on
  // one truthful entry no matter the order they fire in.
  function addSession(studentId, session = {}) {
    const entry = normalizeSessionEntry(session);
    const stamp = normalizeFiniteNumber(session.endedAt ?? session.at, null);
    return updateProfile(studentId, (profile) => {
      const existing = Array.isArray(profile.voice.sessions) ? profile.voice.sessions : [];
      let nextSessions;
      if (!entry) {
        nextSessions = normalizeSessionsList(existing);
      } else if (entry.sessionId) {
        const prior = existing.find((e) => isRecord(e) && e.sessionId === entry.sessionId) || null;
        const endReasonRank = {
          'cut-short': 1,
          'learner-stopped': 2,
          completed: 3,
        };
        if (
          prior
          && (endReasonRank[prior.endReason] || 0) > (endReasonRank[entry.endReason] || 0)
        ) {
          // Never let an incidental lifecycle signal downgrade a more
          // authoritative learner/session boundary.
          nextSessions = normalizeSessionsList(existing);
        } else {
          nextSessions = normalizeSessionsList([
            ...existing.filter((e) => !(isRecord(e) && e.sessionId === entry.sessionId)),
            entry,
          ]);
        }
      } else {
        nextSessions = normalizeSessionsList([...existing, entry]);
      }
      return {
        ...profile,
        voice: {
          ...profile.voice,
          sessions: nextSessions,
          lastSessionAt: stamp != null ? Math.round(stamp) : Math.round(now()),
        },
      };
    }, 'voice_session_logged', ({ normalized }) => ({
      sessionCount: normalized.voice.sessions?.length || 0,
      focusAxis: entry?.focusAxis || null,
      endReason: entry?.endReason || null,
    }));
  }

  // ── v3 one-real-sentence: the daily-sentence list (newest first, cap 60) ──
  //
  // The runtime/route-handlers own the lifecycle; these methods own ONLY the
  // persisted list. All are additive + fail-soft via normalizeProfile's default
  // merge, so they never disturb the rest of the profile.

  // Prepend a new (already-normalized) entry to the front of realSentences
  // (newest first), cap at REAL_SENTENCES_CAP. Returns the normalized profile.
  // `entry` should be the output of createRealSentenceEntry (id + text + pickedAt
  // + status:'picked'); we re-normalize defensively.
  function addRealSentence(studentId, entry = {}) {
    return updateProfile(studentId, (profile) => {
      const existing = Array.isArray(profile.voice.realSentences) ? profile.voice.realSentences : [];
      const next = normalizeRealSentences([entry, ...existing]).slice(0, REAL_SENTENCES_CAP);
      return { ...profile, voice: { ...profile.voice, realSentences: next } };
    }, 'real_sentence_picked', ({ normalized }) => ({
      realSentenceId: normalized.voice.realSentences?.[0]?.id || null,
    }));
  }

  // Update an entry by id (status / outcome / note). Only the fields supplied are
  // touched (has-own-property gated). Unknown id -> no-op. Returns the normalized
  // profile. NEVER writes any negative record — the caller handles warm copy.
  function updateRealSentence(studentId, id, updates = {}) {
    const targetId = normalizeText(id, 80);
    if (!targetId) return readProfile(studentId);
    const input = isRecord(updates) ? updates : {};
    return updateProfile(studentId, (profile) => {
      const list = Array.isArray(profile.voice.realSentences) ? profile.voice.realSentences : [];
      let touched = false;
      const next = list.map((entry) => {
        if (!isRecord(entry) || entry.id !== targetId) return entry;
        touched = true;
        const merged = { ...entry };
        if (Object.prototype.hasOwnProperty.call(input, 'status')) merged.status = input.status;
        if (Object.prototype.hasOwnProperty.call(input, 'outcome')) merged.outcome = input.outcome;
        if (Object.prototype.hasOwnProperty.call(input, 'note')) merged.note = input.note;
        return merged;
      });
      if (!touched) return profile; // unknown id -> no change
      // normalizeRealSentences (via normalizeProfile) coerces bad status/outcome.
      return { ...profile, voice: { ...profile.voice, realSentences: next } };
    }, 'real_sentence_updated', () => ({ realSentenceId: targetId }));
  }

  // Read-only view of the real-sentence state (the list + today's + the single
  // pending debrief). `now` flows through the service clock so tests are
  // deterministic. Fail-soft: a read error yields empty state.
  function getRealSentenceState(studentId) {
    try {
      const profile = readProfile(studentId);
      const nowValue = now();
      const realSentences = Array.isArray(profile.voice.realSentences) ? profile.voice.realSentences : [];
      return {
        realSentences,
        today: findTodaysSentence(realSentences, nowValue),
        pendingDebrief: findPendingDebrief(realSentences, nowValue),
      };
    } catch {
      return { realSentences: [], today: null, pendingDebrief: null };
    }
  }

  function updateNotepadHandoff(studentId, handoff = {}) {
    const content = normalizeText(handoff.content || handoff.summary || handoff.note, 1200);
    const items = Array.isArray(handoff.items)
      ? uniqueStrings(handoff.items, 8)
      : [];
    return updateProfile(studentId, (profile) => ({
      ...profile,
      voice: {
        ...profile.voice,
        notepadHandoff: {
          content,
          items,
          source: normalizeText(handoff.source, 120) || 'voice-runtime',
          sessionId: normalizeText(handoff.sessionId, 120) || null,
          updatedAt: now(),
        },
      },
    }), 'notepad_handoff_updated');
  }

  function recordVoiceAttempt(studentId, attempt = {}) {
    const normalizedStudentId = normalizeStudentId(studentId);
    const nowValue = now();
    const summary = isRecord(attempt.summary) ? attempt.summary : {};
    const metrics = isRecord(summary.metrics) ? summary.metrics : {};
    const advanced = isRecord(metrics.advanced) ? metrics.advanced : {};
    const quality = isRecord(advanced.quality) ? advanced.quality : {};
    const formantLite = isRecord(advanced.formantLite) ? advanced.formantLite : {};
    const voiceState = isRecord(attempt.voiceState) ? attempt.voiceState : {};
    const submittedEvaluations = (Array.isArray(attempt.evaluations) ? attempt.evaluations : [])
      .map((evaluation) => normalizeEvaluation(evaluation, nowValue))
      .filter(Boolean);
    const measurement = resolveAttemptLearningUsability(advanced);
    const evaluations = measurement.usableForLearning ? submittedEvaluations : [];
    const target = isRecord(summary.target) ? summary.target : {};
    const targetProfile = isRecord(voiceState.targetVoiceProfile) ? voiceState.targetVoiceProfile : {};
    const targetIdentity = resolveVoiceTargetIdentityFromAttempt(summary, voiceState);
    const targetPreset = targetIdentity.targetPreset
      || normalizeText(summary.targetPreset || voiceState.targetPreset, 80)
      || 'cute-feminine';
    const attemptId = normalizeText(
      attempt.attemptId
        || attempt.attemptArtifact?.attemptId
        || summary.attemptId
        || summary.id,
      160,
    ) || `attempt-${nowValue}`;
    // v2: persist the reference clip this attempt practiced against. voiceState
    // carries it (referenceClipId); summary may also surface it. Durable so a
    // returning session / replay can re-attach the same reference voice.
    const referenceClipId = normalizeText(
      voiceState.referenceClipId || summary.referenceClipId,
      160,
    ) || null;
    const referenceClipName = normalizeText(
      voiceState.referenceClipName || summary.referenceClipName,
      160,
    ) || null;
    const attemptBinding = targetIdentity.valid
      ? normalizeTargetBinding({
        presetId: voiceState.selectedCustomPresetId,
        presetName: voiceState.selectedCustomPresetName || referenceClipName,
        referenceClipId,
        targetPreset,
        targetSource: targetIdentity.targetSource,
        targetKey: targetIdentity.targetKey,
        targetProfileId: targetIdentity.targetProfileId,
        analysisVersion: targetIdentity.analysisVersion,
        targetVoiceProfile: targetProfile,
        direction: target.direction || targetProfile.direction,
        updatedAt: nowValue,
      })
      : null;
    const attemptRecord = {
      attemptId,
      sessionId: normalizeText(attempt.sessionId, 120) || null,
      targetPreset,
      targetKey: targetIdentity.targetKey,
      targetSource: targetIdentity.targetSource,
      targetProfileId: targetIdentity.targetProfileId,
      analysisVersion: targetIdentity.analysisVersion,
      // v4 baseline honesty (2026-07-26): the analyzer calibration THIS TAKE'S
      // NUMBERS were measured under. Deliberately a separate field from
      // `analysisVersion` above, which is the TARGET's provenance — that one is
      // null for every built-in preset (voice-target-identity.js) and is folded
      // into the targetKey hash, so it can neither witness nor survive a change
      // of measuring instrument on a built-in target. This one can.
      measurementAnalysisVersion: normalizeText(summary.analysisVersion, 120) || null,
      referenceClipId,
      recordedAt: nowValue,
      durationMs: normalizeFiniteNumber(summary.durationMs, null),
      usableForLearning: measurement.usableForLearning,
      measurementAvailable: measurement.measurementAvailable,
      measurementRejectionReasons: measurement.rejectionReasons,
      reliabilityFlags: measurement.reliabilityFlags,
      scoreConfidence: normalizeFiniteNumber(advanced.scoreConfidence, null),
      voicedFramePct: normalizeFiniteNumber(advanced.voicedFramePct, null),
      captureReliability: normalizeFiniteNumber(advanced.captureReliability, null),
      // Core metrics
      meanPitchHz: normalizeFiniteNumber(metrics.meanPitchHz, null),
      pitchRangeSt: normalizeFiniteNumber(metrics.pitchRangeSt, null),
      resonanceMean: normalizeFiniteNumber(metrics.resonanceMean, null),
      weightMean: normalizeFiniteNumber(metrics.weightMean, null),
      targetHitPct: normalizeFiniteNumber(metrics.targetHitPct, null),
      // Phase 1.2: advanced coaching metrics
      pitchP10Hz: normalizeFiniteNumber(advanced.pitchP10Hz, null),
      pitchP90Hz: normalizeFiniteNumber(advanced.pitchP90Hz, null),
      pitchStdSt: normalizeFiniteNumber(advanced.pitchStdSt, null),
      pitchTargetOccupancyPct: normalizeFiniteNumber(advanced.pitchTargetOccupancyPct, null),
      phraseFinalDropSemitones: normalizeFiniteNumber(advanced.phraseFinalDropSemitones, null),
      harmonicRatioMean: normalizeFiniteNumber(advanced.harmonicRatioMean, null),
      spectralCentroidMeanHz: normalizeFiniteNumber(advanced.spectralCentroidMeanHz, null),
      cppsLike: normalizeFiniteNumber(quality.cppsLike, null),
      harmonicStrength: normalizeFiniteNumber(quality.harmonicStrength, null),
      breathyRisk: normalizeFiniteNumber(quality.breathyRisk, null),
      strainRisk: normalizeFiniteNumber(quality.strainRisk, null),
      formantF2MedianHz: normalizeFiniteNumber(formantLite.f2MedianHz, null),
      frontnessScore: normalizeFiniteNumber(formantLite.frontnessScore, null),
      // Free-form
      issues: uniqueStrings(Array.isArray(summary.issues) ? summary.issues : [], 6),
      nextDrills: uniqueStrings(Array.isArray(summary.nextDrills) ? summary.nextDrills : [], 6),
      evaluationConceptIds: evaluations.map((evaluation) => evaluation.conceptId),
    };

    // ADDITIVE substrate mirror: detect whether this attempt is already on file
    // (re-record / retry) so we don't double-count it in the substrate. This
    // read is best-effort and never affects the recording below.
    let wasAlreadyRecorded = false;
    try {
      const priorProfile = readProfile(normalizedStudentId);
      wasAlreadyRecorded = priorProfile.voice.recentAttempts.some((entry) => entry.attemptId === attemptId);
    } catch {
      wasAlreadyRecorded = false;
    }

    const recordedProfile = updateProfile(normalizedStudentId, (profile) => {
      const duplicateAttempt = profile.voice.recentAttempts.some((entry) => entry.attemptId === attemptId);
      const learningTargetKey = attemptBinding?.targetKey
        || profile.voice.targetBinding?.targetKey
        || profile.voice.targetKey;
      const learningByTarget = {
        ...(isRecord(profile.voice.learningByTarget) ? profile.voice.learningByTarget : {}),
      };
      const targetLearning = normalizeTargetLearningBucket(
        learningByTarget[learningTargetKey] || emptyTargetLearningBucket(),
      );
      const conceptStats = duplicateAttempt
        ? targetLearning.conceptStats
        : updateConceptStats(targetLearning.conceptStats, evaluations);
      // v5: SM-2 schedule (skip on duplicate) + queue derived from real state.
      const reviewSchedule = duplicateAttempt
        ? targetLearning.reviewSchedule
        : updateReviewSchedule(targetLearning.reviewSchedule, evaluations, nowValue);
      const reviewQueue = buildReviewQueue(evaluations, reviewSchedule, conceptStats, nowValue);
      const struggles = uniqueStrings([
        ...evaluations
          .filter((evaluation) => evaluation.correct !== true)
          .map((evaluation) => evaluation.misconception || evaluation.conceptName),
        ...targetLearning.struggles,
      ], STRUGGLE_LIMIT);
      // v2 learner memo: mirror of struggles, inverted — recent wins first.
      // v4: derived wins are dated (today) and carry no axis; mergeWhatWorked
      // normalizes + dedupes by text against the existing {text,axis,date} list.
      const derivedWins = buildWhatWorkedFromEvaluations(evaluations)
        .map((text) => ({ text, axis: null, date: localDateStringFor(nowValue) }));
      const whatWorked = mergeWhatWorked(derivedWins, targetLearning.whatWorked, WHAT_WORKED_LIMIT);
      // v2 learner memo: refresh the last reference voice when this attempt has
      // one. summary prefers the target profile's stylePrompt, else the name.
      const lastReference = referenceClipId
        ? normalizeLastReference({
          clipId: referenceClipId,
          name: referenceClipName || targetProfile.sourceFilename || profile.voice.lastReference?.name || '',
          summary: normalizeText(targetProfile.stylePrompt, 240)
            || profile.voice.lastReference?.summary
            || referenceClipName
            || '',
        })
        : normalizeLastReference(profile.voice.lastReference);
      const targetHistory = attemptBinding
        ? [
          ...profile.voice.targetHistory.filter((entry) => entry?.targetKey !== attemptBinding.targetKey),
          {
            targetKey: attemptBinding.targetKey,
            targetPreset,
            targetSource: attemptBinding.targetSource,
            targetProfileId: attemptBinding.targetProfileId,
            analysisVersion: attemptBinding.analysisVersion,
            presetId: attemptBinding.presetId,
            referenceClipId: attemptBinding.referenceClipId,
            updatedAt: nowValue,
          },
        ].slice(-TARGET_HISTORY_LIMIT)
        : profile.voice.targetHistory;

      // Phase 1.3: Build the next recentAttempts list first, then check whether
      // a baseline capture is now ready. We never overwrite a frozen baseline.
      const nextRecentAttempts = [
        ...profile.voice.recentAttempts.filter((entry) => entry.attemptId !== attemptId),
        attemptRecord,
      ].slice(-RECENT_ATTEMPT_LIMIT);

      let nextBaseline = profile.voice.baseline || {};
      let existingBaseline = targetIdentity.valid
        ? nextBaseline[targetIdentity.targetKey]
        : null;
      // One-way migration for old preset-keyed built-in baselines. Custom and
      // reference targets can never inherit this ambiguous legacy bucket.
      if (
        !existingBaseline
        && targetIdentity.valid
        && targetIdentity.targetSource === 'built-in'
        && nextBaseline[targetPreset]?.frozen
      ) {
        const legacyBaseline = nextBaseline[targetPreset];
        const { [targetPreset]: _removedLegacy, ...remainingBaselines } = nextBaseline;
        existingBaseline = {
          ...legacyBaseline,
          targetKey: targetIdentity.targetKey,
          targetSource: 'built-in',
          targetProfileId: null,
          analysisVersion: null,
        };
        nextBaseline = {
          ...remainingBaselines,
          [targetIdentity.targetKey]: existingBaseline,
        };
      }
      // v4 baseline honesty: the calibration THIS take was measured under drives
      // both the stamp on any new snapshot and the staleness test on the old one.
      const takeMeasurementVersion = attemptRecord.measurementAnalysisVersion;
      const baselineCalibrationStale = isBaselineCalibrationStale(
        existingBaseline,
        takeMeasurementVersion,
      );
      if (
        targetIdentity.valid
        && (!existingBaseline || !existingBaseline.frozen || baselineCalibrationStale)
      ) {
        // Build a synthetic "voiceProfile" view for the capture helper so it
        // sees the would-be next list.
        const provisionalVoiceProfile = {
          ...profile.voice,
          recentAttempts: nextRecentAttempts,
        };
        const captured = buildBaselineFromAttempts(
          targetIdentity,
          (provisionalVoiceProfile.recentAttempts || [])
            .filter((entry) => isVoiceRecordComparableToTarget(entry, targetIdentity))
            .slice()
            .reverse(),
          nowValue,
          takeMeasurementVersion,
        );
        // A stale snapshot is REPLACED only once a same-calibration replacement
        // actually exists. Until then it is kept (nothing is destroyed) and the
        // comparison side refuses to render numbers against it, so the learner
        // sees no progress claim rather than a fabricated one.
        if (captured) {
          nextBaseline = { ...nextBaseline, [targetIdentity.targetKey]: captured };
        }
      }

      learningByTarget[learningTargetKey] = normalizeTargetLearningBucket({
        ...targetLearning,
        conceptStats,
        reviewSchedule,
        reviewQueue,
        struggles,
        whatWorked,
      });
      const activeBinding = attemptBinding || profile.voice.targetBinding;
      const nextVoice = applyActiveLearningProjection({
        ...profile.voice,
        targetBinding: activeBinding,
        targetPreset: activeBinding?.targetPreset || profile.voice.targetPreset,
        targetKey: activeBinding?.targetKey || profile.voice.targetKey,
        targetSource: activeBinding?.targetSource || profile.voice.targetSource,
        targetProfileId: activeBinding?.targetProfileId || null,
        targetAnalysisVersion: activeBinding?.analysisVersion || null,
        targetHistory,
        recentAttempts: nextRecentAttempts,
        lastReference,
        baseline: nextBaseline,
      }, learningByTarget, activeBinding?.targetKey || learningTargetKey);
      return { ...profile, voice: nextVoice };
    }, ({ current }) => (
      current.voice.recentAttempts.some((entry) => entry.attemptId === attemptId)
        ? null
        : 'voice_attempt_recorded'
    ), {
      attemptId,
      sessionId: attemptRecord.sessionId,
      targetPreset,
      target_identity_present: Boolean(targetIdentity.targetKey),
      target_source: targetIdentity.targetSource,
      evaluationCount: evaluations.length,
      submittedEvaluationCount: submittedEvaluations.length,
      usableForLearning: measurement.usableForLearning,
      measurementRejectionReasons: measurement.rejectionReasons,
    });

    // ADDITIVE, FAIL-SOFT: mirror this attempt into the structured-memory
    // substrate. Fire-and-forget (not awaited) so it cannot slow or break the
    // coaching turn; only mirror genuinely-new attempts to avoid double counts.
    if (!wasAlreadyRecorded) {
      try {
        const mirrorPromise = mirrorAttemptToSubstrate(
          normalizedStudentId,
          attemptRecord,
          evaluations,
          { primaryIssue: attemptRecord.issues?.[0] || null },
          substrateCall,
        );
        if (mirrorPromise && typeof mirrorPromise.catch === 'function') {
          mirrorPromise.catch(() => { /* fail-soft: never surface substrate errors */ });
        }
      } catch {
        // fail-soft: substrate mirror must never affect recording
      }
    }

    return recordedProfile;
  }

  async function getVoiceStudentModelSnapshot(studentId, query = '') {
    try {
      const profile = readProfile(studentId);
      const conceptIds = Object.keys(profile.voice.conceptStats);
      const reviewQueue = mergeReviewQueue(
        profile.voice.reviewQueue,
        buildReviewQueue([], profile.voice.reviewSchedule, profile.voice.conceptStats, now()),
      );
      const exportEligible = (
        profile.consent.status === 'granted'
        && profile.eligibility.status === 'eligible'
        && profile.exclusions.length === 0
      );
      const activeTargetIdentity = {
        targetKey: profile.voice.targetKey,
        targetSource: profile.voice.targetSource,
        targetPreset: profile.voice.targetPreset,
        targetProfileId: profile.voice.targetProfileId,
        analysisVersion: profile.voice.targetAnalysisVersion,
        valid: Boolean(profile.voice.targetKey),
      };
      const baselineForTarget = profile.voice.baseline?.[profile.voice.targetKey]
        || (
          profile.voice.targetSource === 'built-in'
            ? profile.voice.baseline?.[profile.voice.targetPreset]
            : null
        )
        || null;

      // ADDITIVE, FAIL-SOFT substrate enrichment. These are NEW fields only —
      // existing values (masteryLevel, reviewQueue, reviewPrompt, ...) are left
      // exactly as the file-backed model computes them. On any error/empty the
      // enrichment is simply omitted (null) and callers fall back to the local
      // signals. Never throws out of this block.
      const substrate = await readSubstrateEnrichment(profile.studentId, substrateCall);

      // v2 learner memo: a compact recent-attempts view for the welcome-back
      // card's "last session" stat line (count + a streak proxy). Newest-last,
      // capped, only the fields the card/memo need.
      const recentAttempts = profile.voice.recentAttempts.slice(-RECENT_ATTEMPT_LIMIT).map((entry) => ({
        attemptId: entry.attemptId,
        recordedAt: entry.recordedAt || null,
        targetPreset: entry.targetPreset || null,
        targetKey: normalizeVoiceTargetKey(entry.targetKey),
        targetSource: canonicalizeVoiceTargetSource(entry.targetSource),
        targetProfileId: normalizeText(entry.targetProfileId, 160) || null,
        analysisVersion: normalizeText(entry.analysisVersion, 120) || null,
        // v4 baseline honesty: the coaching layer's VsBaseline path compares this
        // against the frozen baseline's stamp, so it must survive the projection.
        measurementAnalysisVersion: normalizeText(entry.measurementAnalysisVersion, 120) || null,
        meanPitchHz: normalizeFiniteNumber(entry.meanPitchHz, null),
        pitchRangeSt: normalizeFiniteNumber(entry.pitchRangeSt, null),
        resonanceMean: normalizeFiniteNumber(entry.resonanceMean, null),
        weightMean: normalizeFiniteNumber(entry.weightMean, null),
        targetHitPct: normalizeFiniteNumber(entry.targetHitPct, null),
        referenceClipId: entry.referenceClipId || null,
        usableForLearning: entry.usableForLearning !== false,
        measurementAvailable: entry.measurementAvailable === true
          ? true
          : entry.measurementAvailable === false ? false : null,
        measurementRejectionReasons: Array.isArray(entry.measurementRejectionReasons)
          ? entry.measurementRejectionReasons.slice(0, 8)
          : [],
      }));

      // v3 one-real-sentence: the list + the two derived views (today + the single
      // pending debrief). Surfaced so the greeting / frontend can render without a
      // separate fetch.
      const realSentences = Array.isArray(profile.voice.realSentences) ? profile.voice.realSentences : [];
      const todaysSentence = findTodaysSentence(realSentences, now());
      const pendingDebrief = findPendingDebrief(realSentences, now());

      return {
        available: true,
        enabled: profile.enabled,
        studentId: profile.studentId,
        masteryLevel: inferMasteryLevel(profile.voice.conceptStats),
        conceptsPracticed: conceptIds.length,
        conceptIds,
        reviewQueueSize: reviewQueue.length,
        reviewQueue,
        struggles: profile.voice.struggles,
        avoid: profile.voice.avoid,
        learningPace: profile.preferences.learningPace,
        preferredStyle: profile.preferences.preferredStyle,
        reviewPrompt: buildReviewPrompt(reviewQueue),
        // v2 learner memo: surface at the TOP LEVEL so the signal-builder (which
        // receives this whole snapshot as `learnerContext`) can read them.
        profile: profile.profile,
        whatWorked: profile.voice.whatWorked,
        lastReference: profile.voice.lastReference,
        recentAttempts,
        // v3 one-real-sentence: the list + today's + the single pending debrief.
        realSentences,
        realSentence: { today: todaysSentence, pendingDebrief },
        // v4 tutor-memory: surface at the TOP LEVEL so the signal-builder (memo
        // block) and the greeting handler (gap-aware line) can read them.
        sessions: profile.voice.sessions,
        lastSessionAt: profile.voice.lastSessionAt,
        moments: profile.voice.moments,
        coachPreferences: profile.voice.coachPreferences,
        coachCheckpoint: profile.voice.coachCheckpoint,
        targetBinding: profile.voice.targetBinding,
        learnerContext: {
          available: true,
          source: 'local-learner-context',
          schemaVersion: profile.schemaVersion,
          query: normalizeText(query, 160) || null,
          updatedAt: profile.updatedAt,
          targetPreset: profile.voice.targetPreset,
          targetKey: profile.voice.targetKey,
          targetSource: profile.voice.targetSource,
          targetProfileId: profile.voice.targetProfileId,
          targetAnalysisVersion: profile.voice.targetAnalysisVersion,
          targetBinding: profile.voice.targetBinding,
          recentAttemptCount: profile.voice.recentAttempts.length,
          notepadHandoff: profile.voice.notepadHandoff,
          consentStatus: profile.consent.status,
          eligibilityStatus: profile.eligibility.status,
          exclusions: profile.exclusions,
          exportEligible,
          // v2 learner memo: mirror the memo fields into the nested block too, so
          // the frontend (which reads response.learnerContext) can render the
          // welcome-back card without a separate fetch.
          profile: profile.profile,
          whatWorked: profile.voice.whatWorked,
          lastReference: profile.voice.lastReference,
          recentAttempts,
          // v3 one-real-sentence: mirror into the nested block too.
          realSentences,
          realSentence: { today: todaysSentence, pendingDebrief },
          // v4 tutor-memory: mirror into the nested block too (frontend reads
          // response.learnerContext).
          sessions: profile.voice.sessions,
          lastSessionAt: profile.voice.lastSessionAt,
          moments: profile.voice.moments,
          coachPreferences: profile.voice.coachPreferences,
          coachCheckpoint: profile.voice.coachCheckpoint,
          storageHealth: getStorageHealth(),
          // Phase 1.3: baseline snapshot for the active targetPreset, or null
          // if not yet captured (will be ready after BASELINE_FREEZE_THRESHOLD takes).
          baseline: baselineForTarget
            && isVoiceRecordComparableToTarget(baselineForTarget, activeTargetIdentity)
            ? baselineForTarget
            : null,
          // Structured-memory substrate signals (deterministic, optional). null
          // when the substrate is unavailable or has no data yet.
          substrate,
        },
        error: null,
      };
    } catch (error) {
      logger.warn?.(`[LearnerContext] Failed to read voice student snapshot: ${error.message}`);
      return {
        available: false,
        enabled: false,
        studentId: normalizeStudentId(studentId),
        masteryLevel: 'beginner',
        conceptsPracticed: 0,
        conceptIds: [],
        reviewQueueSize: 0,
        reviewQueue: [],
        struggles: [],
        learningPace: 'moderate',
        preferredStyle: 'practical',
        reviewPrompt: '',
        learnerContext: {
          available: false,
          source: 'local-learner-context',
          error: error.message,
        },
        error: error.message,
      };
    }
  }

  function getDatasetExportManifest(studentId, options = {}) {
    const profile = readProfile(studentId);
    const fileKey = getStudentFileKey(profile.studentId);
    const exportEligible = (
      profile.consent.status === 'granted'
      && profile.eligibility.status === 'eligible'
      && profile.exclusions.length === 0
    );
    const manifest = {
      schemaVersion: 'sloane.learner_context.dataset_manifest.v1',
      studentId: profile.studentId,
      generatedAt: now(),
      consent: profile.consent,
      eligibility: profile.eligibility,
      exclusions: profile.exclusions,
      exportEligible,
      recentAttemptCount: profile.voice.recentAttempts.length,
      // v6 PRIVACY: the eligibility flag is now ENFORCED, not advisory — the data refs
      // are exposed ONLY when export is actually permitted (consent/eligibility/no-exclusions).
      source: exportEligible ? {
        kind: 'learner-context-service',
        fileKey,
        profileRef: `students/${fileKey}.json`,
        eventsRef: `events/${fileKey}.jsonl`,
        localPathsRedacted: true,
      } : {
        kind: 'learner-context-service',
        withheld: true,
        reason: 'export not permitted (consent / eligibility / exclusions)',
      },
    };
    if (exportEligible && options.includeLocalPaths === true) {
      manifest.source = {
        ...manifest.source,
        localPathsRedacted: false,
        profilePath: getProfilePath(profile.studentId),
        eventsPath: getEventsPath(profile.studentId),
      };
    }
    return manifest;
  }

  function getStorageHealth() {
    return {
      ...storageHealth,
      writeBlocked: writeBlockedStudents.size > 0,
      writeBlockedLearners: writeBlockedStudents.size,
      structuredMemoryEnabled,
      eventMaxBytes,
    };
  }

  function deleteLearnerData(studentId) {
    const normalizedStudentId = normalizeStudentId(studentId);
    const profilePath = getProfilePath(normalizedStudentId);
    const eventsPath = getEventsPath(normalizedStudentId);
    const ownedPaths = [
      profilePath,
      getProfileBackupPath(normalizedStudentId),
      eventsPath,
      `${eventsPath}.previous`,
      `${eventsPath}.summary.json`,
    ];
    const candidates = new Set(ownedPaths);
    const escapePattern = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const basePath of ownedPaths) {
      const parent = path.dirname(basePath);
      const basename = path.basename(basePath);
      // Atomic writes create "<exact-name>.<pid>.<timestamp>.tmp"; profile
      // recovery creates "<exact-name>.corrupt.<timestamp>". Both patterns are
      // anchored. A broad prefix sweep is unsafe because valid learner IDs may
      // themselves contain periods (for example learner "a" and "a.json.b").
      const ownedArtifactPattern = new RegExp(
        `^${escapePattern(basename)}(?:\\.corrupt\\.\\d+|\\.\\d+\\.\\d+\\.tmp)$`,
      );
      try {
        for (const name of fsModule.readdirSync?.(parent) || []) {
          if (ownedArtifactPattern.test(name)) {
            candidates.add(path.join(parent, name));
          }
        }
      } catch {
        // Missing directories are already deleted.
      }
    }
    let deletedFiles = 0;
    const failures = [];
    for (const candidate of candidates) {
      try {
        if (removeFileIfPresent(candidate)) deletedFiles += 1;
      } catch (error) {
        logger.warn?.(`[LearnerContext] Failed to delete ${candidate}: ${error.message}`);
        failures.push(path.basename(candidate));
      }
    }
    const remainingArtifacts = [...candidates]
      .filter((candidate) => fsModule.existsSync(candidate))
      .map((candidate) => path.basename(candidate));
    const success = failures.length === 0 && remainingArtifacts.length === 0;
    if (success) {
      writeBlockedStudents.delete(normalizedStudentId);
    }
    if (success && writeBlockedStudents.size === 0) {
      storageHealth.status = storageHealth.recoveries > 0 ? 'recovered' : 'healthy';
      storageHealth.lastError = null;
    }
    return {
      success,
      studentId: normalizedStudentId,
      deletedFiles,
      failureCount: failures.length,
      remainingArtifactCount: remainingArtifacts.length,
      stores: {
        profile: !fsModule.existsSync(profilePath),
        profileBackup: !fsModule.existsSync(getProfileBackupPath(normalizedStudentId)),
        events: !fsModule.existsSync(eventsPath),
        eventArchive: !fsModule.existsSync(`${eventsPath}.previous`),
        eventArchiveSummary: !fsModule.existsSync(`${eventsPath}.summary.json`),
      },
    };
  }

  return {
    addCoachPreference,
    addMoment,
    removeMoment,
    removeCoachPreference,
    resetLearnerMemory,
    addRealSentence,
    addSession,
    appendEvent,
    appendLearnerHobbies,
    appendLearnerTopics,
    getDatasetExportManifest,
    getEventsPath,
    getProfilePath,
    getStorageHealth,
    getRealSentenceState,
    getBeginnerMastery,
    getTargetMotorMap,
    getVoiceStudentModelSnapshot,
    readProfile,
    recordVoiceAttempt,
    deleteLearnerData,
    setDatasetControls,
    setActiveVoiceTarget,
    storageRoot: resolvedStorageRoot,
    updateLearnerProfile,
    updateBeginnerMastery,
    updateTargetMotorMap,
    updateCoachCheckpoint,
    updateNotepadHandoff,
    updateProfile,
    updateRealSentence,
    writeProfile,
  };
}

module.exports = {
  DEFAULT_LEARNER_CONTEXT_ROOT,
  LEARNER_CONTEXT_EVENT_SCHEMA_VERSION,
  LEARNER_CONTEXT_SCHEMA_VERSION,
  // v4 caps + vocab (exported for tests + the signal-builder memo block).
  SESSIONS_LIMIT,
  MOMENTS_LIMIT,
  COACH_PREFERENCES_LIMIT,
  WHAT_WORKED_LIMIT,
  FOCUS_AXES,
  MOMENT_KINDS,
  // B-SESS flow-session vocab (ring entry endReason/tier enums).
  SESSION_END_REASONS,
  SESSION_TIERS,
  // v4 pure helpers (exported for unit tests + reuse).
  normalizeWhatWorkedEntry,
  mergeWhatWorked,
  normalizeMomentEntry,
  normalizeSessionEntry,
  normalizeCoachCheckpoint,
  createLearnerContextService,
};
