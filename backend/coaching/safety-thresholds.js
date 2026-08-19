'use strict';

/**
 * SafetyThresholds — the single canonical voice-safety threshold module.
 *
 * WHY THIS EXISTS (2026-07-18 truth+safety wave): safety-gates.js was ported from
 * deeptutor-voice-adapter.js but mis-read the adapter's call signature
 * `getVoiceSafetyThreshold(ceiling, OFFSET, FALLBACK)` as
 * `getThreshold(ceiling, softDefault, hardDefault)` — so the small per-metric
 * OFFSETS (0.10 / 0.24 / 0.12) became the live no-profile thresholds, and with a
 * profile the fire and stop tiers both collapsed to the same raw ceiling
 * (fire == stop). This module restores the adapter's exact original semantics and
 * is the ONE place the per-metric (offset, fallback) pairs live.
 *
 * This module is the source of truth consumed by both deterministic coaching
 * and the DeepTutor/Fable adapter. Do not re-type these offsets or fallbacks in
 * another layer; importing this module is what keeps safety holds, correction
 * text, telemetry, and UI interpretation calibrated to one contract.
 *
 * Contract (documented, tested):
 *   - No profile: strain warns at 0.52, stops at 0.70; breathy warns at 0.68.
 *   - With a profile ceiling c: warn = min(fallback, c + offset) — the ceiling
 *     TIGHTENS a threshold, never loosens it past the contract fallback.
 *   - The warn/stop offsets differ (0.10 vs 0.24), so warn < stop for every
 *     ceiling: a real hysteresis band always exists (no fire == stop collapse).
 *   - The breathy tier has NO stop pair in the adapter — breathy is warn-only.
 *
 */

/**
 * Normalize a 0..1 safety metric or ceiling: null/''/non-finite -> null,
 * otherwise clamped into [0, 1]. Mirrors the adapter's
 * normalizeVoiceSafetyMetric exactly.
 */
function normalizeVoiceSafetyMetric(value) {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : null;
}

/**
 * The adapter's exact threshold rule: a profile ceiling caps (tightens) the
 * contract fallback; no ceiling means the contract fallback applies.
 */
function getVoiceSafetyThreshold(ceiling, offset, fallback) {
  const normalizedCeiling = normalizeVoiceSafetyMetric(ceiling);
  return normalizedCeiling != null
    ? Math.min(fallback, normalizedCeiling + offset)
    : fallback;
}

/**
 * Per-metric (offset, fallback) pairs — extracted verbatim from the adapter
 * call sites listed in the header. These are the ONLY copies the coaching
 * pipeline may use; new call sites import from here, never re-type numbers.
 */
const VOICE_SAFETY_THRESHOLDS = Object.freeze({
  strain: Object.freeze({
    warn: Object.freeze({ offset: 0.1, fallback: 0.52 }),
    stop: Object.freeze({ offset: 0.24, fallback: 0.7 }),
  }),
  breathy: Object.freeze({
    warn: Object.freeze({ offset: 0.12, fallback: 0.68 }),
  }),
});

/**
 * 2026-07-19 zero-friction wave: LENIENT VOCALISE STRAIN.
 *
 * The analyzer's strain estimate includes an HNR term that reads clean,
 * steady SUSTAINED phonation (long vowels, hums/SOVT, siren glides) as
 * pressed — so ordinary healthy vocalises show mid-band strain readings that
 * a conversational phrase would not.
 *
 * MECHANISM (decided, tested): a RAISED WARN BAR for vocalise take kinds —
 * not a strain-INPUT adjustment. Rationale: dampening the input would shift
 * the effective STOP bar too, and the hard-stop tier must remain intact for
 * genuinely extreme values (owner safety law). Raising only the warn bar
 * keeps the two-tier semantics: the false-positive elevation lands in the
 * warn band, so that is the only tier that needs leniency.
 *
 * The lift is capped just below the resolved stop so a real hysteresis band
 * always survives (no warn == stop collapse), including under tight profile
 * ceilings, and the warn bar never moves DOWN (max with the base warn).
 */
const VOCALISE_TAKE_KINDS = Object.freeze(['sustained', 'hum_sovt', 'siren']);
const VOCALISE_STRAIN_WARN_LIFT = 0.1;
const VOCALISE_WARN_STOP_GAP = 0.02;

function isVocaliseTakeKind(takeKind) {
  return VOCALISE_TAKE_KINDS.includes(String(takeKind || '').toLowerCase());
}

/**
 * Resolve the strain warn/stop pair for a profile's quality bands
 * (voiceState.targetVoiceProfile.advancedBands.quality). Bands may be absent.
 *
 * `options.takeKind` (optional): vocalise kinds (sustained/hum_sovt/siren) get
 * the lenient warn bar described above. Stop is NEVER adjusted. The returned
 * `interpretation` field ('standard' | 'vocalise-lenient') feeds the witness.
 */
function resolveStrainThresholds(qualityBands = {}, options = {}) {
  const ceiling = qualityBands ? qualityBands.strainRiskCeiling : null;
  const baseWarn = getVoiceSafetyThreshold(
    ceiling,
    VOICE_SAFETY_THRESHOLDS.strain.warn.offset,
    VOICE_SAFETY_THRESHOLDS.strain.warn.fallback,
  );
  const stop = getVoiceSafetyThreshold(
    ceiling,
    VOICE_SAFETY_THRESHOLDS.strain.stop.offset,
    VOICE_SAFETY_THRESHOLDS.strain.stop.fallback,
  );
  const vocalise = isVocaliseTakeKind(options && options.takeKind);
  const warn = vocalise
    ? Math.max(baseWarn, Math.min(stop - VOCALISE_WARN_STOP_GAP, baseWarn + VOCALISE_STRAIN_WARN_LIFT))
    : baseWarn;
  return {
    warn,
    stop,
    source: normalizeVoiceSafetyMetric(ceiling) != null ? 'profile-capped' : 'contract',
    interpretation: vocalise ? 'vocalise-lenient' : 'standard',
  };
}

/**
 * 2026-07-26 breath-nag repair: an ABSOLUTE FLOOR under the resolved breathy warn.
 *
 * OBSERVED LIVE: a clean reference clip produces a very low breathyRiskCeiling,
 * so the profile cap (ceiling + 0.12) resolved to breathy_warn = 0.22 in the
 * coach_gates witness. That is far below the DSP breathy estimator's own noise
 * floor — when its inputs are missing the estimator still manufactures a
 * mid-band risk — so the breathy issue fired on nearly every take and
 * monopolized the coaching focus.
 *
 * This floor is DEFENSE IN DEPTH: the estimator's null-coercion is repaired in
 * the DSP layer (services/voice-trainer). Even with that fixed, no profile may
 * push the breathy warn bar below a value the estimator can clear on ordinary
 * clean phonation. Breathy is a warn-only tier with no stop pair, so raising
 * this bar cannot weaken any hard-stop safety tier.
 *
 * NOT applied to strain: the strain tiers (and especially the stop tier) are
 * owner safety law and are left exactly as they are.
 */
const BREATHY_WARN_FLOOR = 0.45;

/** Resolve the breathy warn threshold (warn-only tier; see header note). */
function resolveBreathyThreshold(qualityBands = {}) {
  const ceiling = qualityBands ? qualityBands.breathyRiskCeiling : null;
  const resolved = getVoiceSafetyThreshold(
    ceiling,
    VOICE_SAFETY_THRESHOLDS.breathy.warn.offset,
    VOICE_SAFETY_THRESHOLDS.breathy.warn.fallback,
  );
  const warn = Math.max(BREATHY_WARN_FLOOR, resolved);
  return {
    warn,
    source: normalizeVoiceSafetyMetric(ceiling) != null ? 'profile-capped' : 'contract',
    // Witness field: true when the profile resolution was below the floor and
    // the floor took over. Surfaces in the coach_gates event.
    floored: warn > resolved,
  };
}

module.exports = {
  getVoiceSafetyThreshold,
  normalizeVoiceSafetyMetric,
  resolveStrainThresholds,
  resolveBreathyThreshold,
  isVocaliseTakeKind,
  VOICE_SAFETY_THRESHOLDS,
  VOCALISE_TAKE_KINDS,
  VOCALISE_STRAIN_WARN_LIFT,
  BREATHY_WARN_FLOOR,
};
