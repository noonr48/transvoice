'use strict';

const { resolveVoiceMeasurementUsability } = require('../voice-measurement-validity');

/**
 * Strain guardian — the vocal-health firewall (PRACTICE-PHILOSOPHY §6 / V1.5 §3).
 *
 * Deterministic protection NOW; the v3 model learns to speak it natively later.
 * This module is the per-session strain accumulator + the stop-rules. It is kept
 * PURE and side-effect-free so the runtime stays thin: the runtime feeds it one
 * take's strain evidence at finalize-time, and it returns the guardian decision
 * (level + a deterministic coach line + the compact strainWatch field). The
 * runtime owns persistence (the accumulator instance lives per voice session) and
 * thread/coach insertion; this file owns ONLY the rules + templates.
 *
 * PHILOSOPHY (binding): protective, not gatekeeping. The guardian advises, the
 * person decides. Controls are NEVER locked. It speaks at most:
 *   - 'ease'  once per qualifying window (re-arms only after it de-escalates),
 *   - 'close' once, then — if the person keeps going — exactly one more time,
 *     then it stays SILENT (it said its piece; adult autonomy).
 * No guilt, no streaks, no red. The lines are warm and name the good takes.
 *
 * ── Strain evidence (the field we keyed on — VERIFIED in the DSP artifact) ──
 * The DSP attempt artifact is `result.attemptArtifact` from finalizeVoiceTake.
 * Strain evidence per take is read from the artifact metrics:
 *   artifact.metrics.advanced.quality.strainRisk   (float 0..1 | null)
 *   artifact.metrics.advanced.quality.breathyRisk  (float 0..1 | null)
 *   artifact.reliabilityFlags / artifact.metrics.advanced.reliabilityFlags (string[])
 * Source of truth:
 *   services/voice-trainer/src/services/contracts.py
 *     - VoiceAttemptQualityMetrics.strainRisk / .breathyRisk         (~L116-117)
 *     - VoiceAttemptAdvancedMetrics.quality / .reliabilityFlags      (~L152-153)
 *     - VoiceAttemptArtifact.metrics / .reliabilityFlags             (~L224-225)
 *   services/voice-trainer/src/services/audio_analysis.py
 *     - strain_risk = clamp(...) computed ~L1335-1340
 *     - the DSP's OWN "this take is strained" issue trigger is strainRisk > 0.52
 *       (~L2527-2531); breathyRisk > 0.58 is its airy/breathy trigger (~L2515-2519).
 * Thresholds are resolved by coaching/safety-thresholds.js, the canonical
 * safety contract shared with the live safety gate. Target-profile quality
 * ceilings may tighten them, and vocalise take kinds may raise only the warn
 * bar while leaving the hard-stop tier intact.
 */

const { resolveStrainThresholds, resolveBreathyThreshold } = require('../coaching/safety-thresholds');

const DEFAULT_STRAIN_THRESHOLDS = resolveStrainThresholds({});
const DEFAULT_BREATHY_THRESHOLD = resolveBreathyThreshold({});

// ── Tunable constants (ALL guardian tuning lives here, per the contract) ──────
const GUARDIAN_CONSTANTS = Object.freeze({
  // A take counts as "strained" at/above this DSP strainRisk (0..1).
  STRAIN_RISK_THRESHOLD: DEFAULT_STRAIN_THRESHOLDS.warn,
  // breathyRisk only counts as strain evidence at/above this (higher bar).
  BREATHY_RISK_THRESHOLD: DEFAULT_BREATHY_THRESHOLD.warn,
  // Ease-off: strain on >= this many of the last EASE_WINDOW takes.
  EASE_STRAIN_COUNT: 2,
  EASE_WINDOW: 4,
  // Close: strain on >= this many takes total in the session...
  CLOSE_TOTAL_STRAIN_COUNT: 4,
  // ...OR active minutes over this AND any strain in the last CLOSE_RECENT_WINDOW.
  CLOSE_SESSION_MINUTES: 25,
  CLOSE_RECENT_WINDOW: 3,
  // Active-time accounting (2026-07-28): sessionMinutes counts PRACTICE time
  // accrued between takes, not wall clock since session creation. A take-to-take
  // gap longer than this is a break, not practice — the clock pauses instead of
  // accruing idle time (a session created 3 days ago no longer opens with
  // thousands of "minutes" and the close posture permanently armed).
  ACTIVE_IDLE_GAP_MINUTES: 10,
  // After 'close' has been said, the guardian may repeat 'close' at most this
  // many additional times, then it stays silent forever for the session.
  CLOSE_MAX_REPEATS: 1,
  // Reliability flags that are genuine strain markers (NOT capture-quality flags
  // like low_voiced_coverage / quiet_input, which are not strain).
  STRAIN_FLAGS: Object.freeze(['strain', 'vocal_strain', 'strained', 'high_strain']),
});

// ── Deterministic templates (warm, named, no guilt; ink not alarm) ───────────
const GUARDIAN_TEMPLATES = Object.freeze({
  // 2026-07-26 whole-body register: releasing the shoulders and neck is the
  // fastest way to take load off the voice, and it is prop-free. The safety
  // content is unchanged — volume and effort come down, and nothing is pushed.
  ease: 'Let your shoulders drop and the neck go loose, then bring the volume and effort down with a gentle hum or lip trill — no pushing.',
  close: 'Keep the sound very gentle and unforced. Do not push through discomfort.',
});

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull the strain evidence out of a DSP attempt artifact (or a summary that
 * carries the same `metrics` shape). Total + crash-proof: any missing layer
 * degrades to "no evidence" rather than throwing. Returns a normalized record:
 *   { strained: boolean, strainRisk: number|null, breathyRisk: number|null, flags: string[] }
 */
function extractStrainEvidence(artifactOrSummary, options = {}) {
  const root = isRecord(artifactOrSummary) ? artifactOrSummary : {};
  const metrics = isRecord(root.metrics) ? root.metrics : {};
  const advanced = isRecord(metrics.advanced) ? metrics.advanced : {};
  const quality = isRecord(advanced.quality) ? advanced.quality : {};
  const qualityBands = isRecord(options.qualityBands) ? options.qualityBands : {};
  const takeKind = typeof options.takeKind === 'string' ? options.takeKind : null;
  const strainThresholds = resolveStrainThresholds(qualityBands, { takeKind });
  const breathyThreshold = resolveBreathyThreshold(qualityBands);
  const measurementAvailable = advanced.measurementAvailable === true
    ? true
    : advanced.measurementAvailable === false ? false : null;
  const measurementUsable = resolveVoiceMeasurementUsability(advanced).usableForScoring;

  const strainRisk = toFiniteOrNull(quality.strainRisk);
  const breathyRisk = toFiniteOrNull(quality.breathyRisk);

  const flags = []
    .concat(Array.isArray(root.reliabilityFlags) ? root.reliabilityFlags : [])
    .concat(Array.isArray(advanced.reliabilityFlags) ? advanced.reliabilityFlags : [])
    .filter((f) => typeof f === 'string' && f.trim())
    .map((f) => f.trim());

  const flaggedStrain = flags.some((f) => GUARDIAN_CONSTANTS.STRAIN_FLAGS.includes(f.toLowerCase()));

  const strained = !measurementUsable
    ? false
    : (
      (strainRisk != null && strainRisk >= strainThresholds.warn)
      || (breathyRisk != null && breathyRisk >= breathyThreshold.warn)
      || flaggedStrain
    );

  return {
    strained,
    strainRisk,
    breathyRisk,
    flags,
    measurementAvailable,
    measurementUsable,
    takeKind,
    thresholds: {
      strainWarn: Number(strainThresholds.warn.toFixed(3)),
      strainStop: Number(strainThresholds.stop.toFixed(3)),
      breathyWarn: Number(breathyThreshold.warn.toFixed(3)),
      source: strainThresholds.source,
      interpretation: strainThresholds.interpretation,
    },
  };
}

/**
 * Per-session strain accumulator. One instance per voice session, owned by the
 * runtime. `recordTake` is fed every finalized take's evidence and returns the
 * guardian decision for THAT take (deterministic). The instance keeps minimal
 * state: when the session started, total takes, total strained takes, the recent
 * strained-flag history, and what the guardian has already said (so it doesn't
 * nag). `now` is injectable for tests.
 */
class StrainGuardian {
  constructor({ sessionStartedAt = null, now = () => Date.now() } = {}) {
    this._now = typeof now === 'function' ? now : () => Date.now();
    this._startedAt = toFiniteOrNull(sessionStartedAt) || this._now();
    this._takeCount = 0;
    this._strainedTotal = 0;
    // Newest-last booleans: was take N strained? (only last EASE_WINDOW needed,
    // but we keep a bounded tail for clarity.)
    this._recentStrained = [];
    // What has the guardian already emitted this session?
    this._easeAnnounced = false; // armed/disarmed: true while an ease window holds
    this._closeAnnounced = false; // has 'close' fired at least once?
    this._closeRepeats = 0; // extra 'close' lines after the first
    this._silenced = false; // said its piece — stays quiet
    // 2026-07-28: active practice time. Accrued take-to-take in recordTake
    // (capped per gap), NOT wall clock since _startedAt.
    this._activeMs = 0;
    this._lastTakeAt = null;
  }

  /** Active PRACTICE minutes this session (floored at 0). Idle gaps — a break,
   * or days between sessions on a long-lived session object — never count, so
   * the close rule's >25-minutes leg means 25 minutes of actual practice. */
  sessionMinutes() {
    return this._activeMs / 60000;
  }

  /** The compact field that rides on the coaching signal + session payload. */
  strainWatch() {
    const recentFlags = this._recentStrained
      .slice(-GUARDIAN_CONSTANTS.EASE_WINDOW)
      .filter(Boolean).length;
    return {
      recentFlags,
      sessionMinutes: Number(this.sessionMinutes().toFixed(2)),
      strainedTotal: this._strainedTotal,
      takeCount: this._takeCount,
    };
  }

  _countRecentStrained(window) {
    return this._recentStrained.slice(-window).filter(Boolean).length;
  }

  /**
   * Record one finalized take. `evidence` may be a DSP attempt artifact, a
   * summary with the same metrics shape, or a pre-extracted evidence record
   * ({ strained, ... }). Returns the guardian decision for this take:
   *   { level: 'none'|'ease'|'close', line: string|null, spoke: boolean, strainWatch }
   * `spoke` is true only when a NEW template line should be inserted into the
   * coach thread this take (so the runtime never double-inserts).
   */
  recordTake(evidence = {}, options = {}) {
    // 2026-07-28 active-time accounting: minutes accrue BETWEEN takes, capped
    // at ACTIVE_IDLE_GAP_MINUTES per gap. Runs before the rejected-capture early
    // return on purpose: a rejected take is not a vocal-health sample, but the
    // learner was still practicing during it.
    const nowMs = this._now();
    if (this._lastTakeAt != null) {
      const gapMs = Math.max(0, nowMs - this._lastTakeAt);
      this._activeMs += Math.min(gapMs, GUARDIAN_CONSTANTS.ACTIVE_IDLE_GAP_MINUTES * 60000);
    }
    this._lastTakeAt = nowMs;

    const ev = (typeof evidence.strained === 'boolean')
      ? evidence
      : extractStrainEvidence(evidence, options);

    // A rejected/no-voice capture is telemetry, not a vocal-health sample. It
    // must not dilute or advance the recent-strain window. Preserve any posture
    // already active without emitting a new line.
    if (ev.measurementAvailable === false || ev.measurementUsable === false) {
      const level = this._closeAnnounced
        ? 'close'
        : this._countRecentStrained(GUARDIAN_CONSTANTS.EASE_WINDOW) >= GUARDIAN_CONSTANTS.EASE_STRAIN_COUNT
          ? 'ease'
          : 'none';
      return {
        level,
        line: null,
        spoke: false,
        ignored: true,
        evidence: ev,
        strainWatch: this.strainWatch(),
      };
    }

    this._takeCount += 1;
    this._recentStrained.push(Boolean(ev.strained));
    if (ev.strained) {
      this._strainedTotal += 1;
    }
    // Keep the tail bounded (only the close/ease windows are ever inspected).
    const maxTail = Math.max(GUARDIAN_CONSTANTS.EASE_WINDOW, GUARDIAN_CONSTANTS.CLOSE_RECENT_WINDOW) + 2;
    if (this._recentStrained.length > maxTail) {
      this._recentStrained = this._recentStrained.slice(-maxTail);
    }

    const watch = this.strainWatch();

    // ── Close rule (takes precedence over ease) ──────────────────────────────
    const totalTrip = this._strainedTotal >= GUARDIAN_CONSTANTS.CLOSE_TOTAL_STRAIN_COUNT;
    const minutesTrip = (
      this.sessionMinutes() > GUARDIAN_CONSTANTS.CLOSE_SESSION_MINUTES
      && this._countRecentStrained(GUARDIAN_CONSTANTS.CLOSE_RECENT_WINDOW) > 0
    );
    const closeQualifies = totalTrip || minutesTrip;

    if (closeQualifies && !this._silenced) {
      if (!this._closeAnnounced) {
        // First close.
        this._closeAnnounced = true;
        return {
          level: 'close', line: GUARDIAN_TEMPLATES.close, spoke: true, evidence: ev, strainWatch: watch,
        };
      }
      // Already announced close; the person kept going. Repeat at most CLOSE_MAX_REPEATS.
      if (this._closeRepeats < GUARDIAN_CONSTANTS.CLOSE_MAX_REPEATS) {
        this._closeRepeats += 1;
        return {
          level: 'close', line: GUARDIAN_TEMPLATES.close, spoke: true, evidence: ev, strainWatch: watch,
        };
      }
      // Said its piece — surface the level (so the UI keeps the calm close hint)
      // but stay SILENT (no new line).
      this._silenced = true;
      return { level: 'close', line: null, spoke: false, evidence: ev, strainWatch: watch };
    }

    if (this._closeAnnounced) {
      // Once close has fired, the session stays in the close posture for the UI
      // hint even on a non-qualifying take; but never speaks again here.
      return { level: 'close', line: null, spoke: false, evidence: ev, strainWatch: watch };
    }

    // ── Ease rule ────────────────────────────────────────────────────────────
    const easeQualifies = (
      this._countRecentStrained(GUARDIAN_CONSTANTS.EASE_WINDOW) >= GUARDIAN_CONSTANTS.EASE_STRAIN_COUNT
    );

    if (easeQualifies) {
      if (!this._easeAnnounced) {
        this._easeAnnounced = true;
        return {
          level: 'ease', line: GUARDIAN_TEMPLATES.ease, spoke: true, evidence: ev, strainWatch: watch,
        };
      }
      // Still in the ease window — keep the level (UI hint persists) but don't repeat.
      return { level: 'ease', line: null, spoke: false, evidence: ev, strainWatch: watch };
    }

    // Window cleared — re-arm ease so a fresh strain cluster can speak again.
    this._easeAnnounced = false;
    return { level: 'none', line: null, spoke: false, evidence: ev, strainWatch: watch };
  }
}

function createStrainGuardian(options = {}) {
  return new StrainGuardian(options);
}

/**
 * THE shared second-strike window rule (2026-07-18 truth+safety wave).
 *
 * The guardian is the strain authority: its accumulator counts strained takes
 * over the last EASE_WINDOW takes and publishes that count as
 * `strainWatch.recentFlags` (mirrored onto voiceState at take-finalize by the
 * runtime). A "second strike" — the same rule that arms the guardian's ease
 * line — is recentFlags >= EASE_STRAIN_COUNT (2 of the last 4 takes).
 *
 * safety-gates.js uses this to gate its warn/'reset' tier: a single warn-tier
 * take (>= warn threshold but < stop) does NOT interrupt; a second strike
 * within the recent window does. The hard stop tier never consults this —
 * one genuinely risky take stops immediately (safety first). The rule lives
 * HERE so guardian.js remains the one place the windowing is defined.
 *
 * Accepts the compact strainWatch record ({ recentFlags, ... }) or null.
 */
function hasRecentStrainStrike(strainWatch) {
  const recentFlags = Number(strainWatch && strainWatch.recentFlags);
  if (!Number.isFinite(recentFlags)) return false;
  return recentFlags >= GUARDIAN_CONSTANTS.EASE_STRAIN_COUNT;
}

module.exports = {
  StrainGuardian,
  createStrainGuardian,
  extractStrainEvidence,
  hasRecentStrainStrike,
  GUARDIAN_CONSTANTS,
  GUARDIAN_TEMPLATES,
};
