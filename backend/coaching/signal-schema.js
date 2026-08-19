'use strict';

/**
 * CoachingSignal v2 — the contract between deterministic analysis and the LLM renderer.
 *
 * The signal tells the model WHAT to say. The model decides HOW to say it.
 * The signal is always valid JSON. The model never sees raw metrics.
 *
 * v2 redesign (vs v1):
 *   - Adds decision blocks (targetFit, coachingDecision) so the LLM phrases decisions
 *     the code already made, instead of reasoning from raw metrics to decisions.
 *   - Adds takeQuality block (usable, reasons, confidence) replacing the v1 capture
 *     reliability enum at the top level.
 *   - Adds doNotSay constraints (post-hoc enforced by sanitizer).
 *   - Adds history block with last-3-take summary and trend.
 *   - Keeps v1 fields (audioMetrics, capture, policy, coachMove, personalization)
 *     for backward compatibility with existing consumers and the prompt renderer.
 *
 * Field flow:
 *   raw metrics  ->  targetFit (pitch/resonance/weight status)  ->  coachingDecision (focus + drill)
 *   capture reliability + safety  ->  takeQuality + policy.safetyState
 *   userGoal + history  ->  coachingDecision.reason + history.trend
 */

const COACHING_SIGNAL_SCHEMA = 'transvoice.coaching_signal.v2';
const COACHING_SIGNAL_SCHEMA_V1 = 'transvoice.coaching_signal.v1';

const SIGNAL_INTENTS = [
  'single_actionable_cue',
  'continue_conversation',
  'repair_capture',
  'stop_and_reset',
  'lesson_transition',
  'reflection_summary',
  'mimic_directive',
  'acknowledge_win',
];

// v2 statuses — discrete, model-friendly values
const PITCH_STATUSES = ['below', 'in_band', 'above', 'unstable', 'uncertain'];
const RESONANCE_STATUSES = ['too_dark', 'target', 'too_bright', 'uncertain'];
const WEIGHT_STATUSES = ['too_heavy', 'target', 'too_light', 'uncertain'];

// v2 focus axes — what coachingDecision.primaryFocus can point at
const FOCUS_AXES = [
  'none',
  'pitch_floor',
  'pitch_lower',
  'pitch_stability',
  'resonance_forward',
  'vocal_weight',
  // 2026-07-26: renamed from 'breath_flow'. The underlying metric measures
  // glottal closure / airy phonation, NOT breathing — the old name pushed the
  // renderer toward breath cues on every take.
  'tone_clarity',
  'strain_reduction',
  'speech_rate',
  'phrase_ending',
];

const TREND_VALUES = ['improving', 'flat', 'fatiguing', 'uncertain'];

const SAFETY_STATES = ['normal', 'capture_only', 'fatigue_or_strain', 'stop'];

// 2026-07-19 zero-friction wave: what KIND of take this was. The metric
// contract per kind lives in signal-builder.buildKindMetrics — each kind gets
// only the metrics that are honest for it (a hum has no reliable F2; a trill is
// SUPPOSED to wobble). 'phrase' is the default scripted-line take.
const TAKE_KINDS = [
  'phrase',
  'siren',
  'sustained',
  'hum_sovt',
  'resonance_play',
  'trill',
  'spontaneous',
  'ear_training',
  'silent',
];

// 2026-07-19 zero-friction wave: how much voice the current place allows.
// full = speak freely; quiet = hums/soft-onset register; silent = listening/
// planning register only. eyesFree = learner cannot look at the screen (coach
// speaks phrases first; learner echoes).
const SESSION_TIERS = ['full', 'quiet', 'silent'];

// v3 — the per-turn coaching action the app decides and the model renders.
// coach=give a cue, gentle=one easy/warm low-effort cue when the learner asks to pace down,
// adapt=switch angle when a method stalls, breather=ease off no cue,
// converse=respond naturally to chat. See docs/ADAPTIVE-COACH-PLAN.md.
const COACHING_ACTIONS = ['coach', 'gentle', 'adapt', 'breather', 'converse'];

const CAPTURE_RELIABILITY = ['good', 'degraded', 'low', 'unusable'];

// v1 kept for backward compat
const SCHEMA_VERSIONS = [COACHING_SIGNAL_SCHEMA, COACHING_SIGNAL_SCHEMA_V1];

/**
 * Build a v2 CoachingSignal with sensible null defaults.
 *
 * v2 design principle: "Code decides what, model decides how."
 * Every block is a decision the LLM can phrase, not a metric dump.
 */
function buildCoachingSignal(overrides = {}) {
  return {
    schema: COACHING_SIGNAL_SCHEMA,

    // v1 fields (kept for backward compat with v1 consumers)
    mode: overrides.mode || 'active_drill',
    styleTarget: overrides.styleTarget || 'cute-feminine',
    // 2026-06-25: authoritative learner direction ('feminizing'|null; the
    // 'masculinizing' value was retired 2026-07-26 with the FTM direction),
    // resolved from profile.direction in buildSignal. The live sanitizer's direction
    // filter prefers this over styleTarget so an unknown/unmapped preset (e.g. 'x') or a
    // direction/preset mismatch still filters correctly.
    direction: overrides.direction || null,
    // 2026-07-26: WHERE `direction` came from — 'profile' (the learner stated it),
    // 'target' (derived from the selected voice style), or null (unknown/ambiguous
    // style, so nothing may be claimed). The renderer prints a Direction line only
    // when this is non-null; `direction` itself keeps its legacy resolution so the
    // sanitizer's cross-direction safety filter is unchanged.
    directionSource: overrides.directionSource || null,
    userUtterance: overrides.userUtterance || '',
    practiceLine: overrides.practiceLine || '',

    audioMetrics: {
      breathyRisk: overrides.audioMetrics?.breathyRisk ?? null,
      strainRisk: overrides.audioMetrics?.strainRisk ?? null,
      harmonicRatioMean: overrides.audioMetrics?.harmonicRatioMean ?? null,
      spectralTiltMeanDbPerOct: overrides.audioMetrics?.spectralTiltMeanDbPerOct ?? null,
      f1MedianHz: overrides.audioMetrics?.f1MedianHz ?? null,
      f2MedianHz: overrides.audioMetrics?.f2MedianHz ?? null,
      frontnessScore: overrides.audioMetrics?.frontnessScore ?? null,
      cppsLike: overrides.audioMetrics?.cppsLike ?? null,
      harmonicStrength: overrides.audioMetrics?.harmonicStrength ?? null,
      stabilityMean: overrides.audioMetrics?.stabilityMean ?? null,
      // New: pitch target occupancy & phrase-final drop
      pitchTargetOccupancy: overrides.audioMetrics?.pitchTargetOccupancy ?? null,
      phraseFinalDropHz: overrides.audioMetrics?.phraseFinalDropHz ?? null,
      phraseFinalDropSemitones: overrides.audioMetrics?.phraseFinalDropSemitones ?? null,
      // v1 extras
      jitterLocal: overrides.audioMetrics?.jitterLocal ?? null,
      jitterRap: overrides.audioMetrics?.jitterRap ?? null,
      shimmerLocal: overrides.audioMetrics?.shimmerLocal ?? null,
      shimmerApq3: overrides.audioMetrics?.shimmerApq3 ?? null,
      ...(overrides.audioMetrics || {}),
    },

    capture: {
      reliability: overrides.capture?.reliability || 'good',
      asrConfidence: overrides.capture?.asrConfidence || 'unknown',
      voicedCoverage: overrides.capture?.voicedCoverage || 'unknown',
      ...(overrides.capture || {}),
    },

    policy: {
      shouldCorrect: overrides.policy?.shouldCorrect ?? true,
      maxCueCount: overrides.policy?.maxCueCount ?? 1,
      avoidTopics: overrides.policy?.avoidTopics || [],
      safetyState: overrides.policy?.safetyState || 'normal',
      conversationPriority: overrides.policy?.conversationPriority || 'normal',
      coachingAction: overrides.policy?.coachingAction || 'coach',
      ...(overrides.policy || {}),
    },

    observation: {
      primaryIssue: overrides.observation?.primaryIssue || null,
      secondaryIssue: overrides.observation?.secondaryIssue || null,
      confidence: overrides.observation?.confidence ?? 0,
      plainEvidence: overrides.observation?.plainEvidence || '',
      ...(overrides.observation || {}),
    },

    coachMove: {
      intent: overrides.coachMove?.intent || 'single_actionable_cue',
      cue: overrides.coachMove?.cue || '',
      exampleRewrite: overrides.coachMove?.exampleRewrite || '',
      nextAction: overrides.coachMove?.nextAction || '',
      successCriteria: overrides.coachMove?.successCriteria || '',
      ...(overrides.coachMove || {}),
    },

    personalization: {
      recentWin: overrides.personalization?.recentWin || '',
      currentLesson: overrides.personalization?.currentLesson || '',
      preferredTone: overrides.personalization?.preferredTone || 'warm, conversational, not technical',
      ...(overrides.personalization || {}),
    },

    // ===== v2 new blocks =====

    // takeQuality — replaces/augments capture reliability with discrete decision
    takeQuality: {
      usable: overrides.takeQuality?.usable ?? true,
      reasons: overrides.takeQuality?.reasons || [],
      voicedCoveragePct: overrides.takeQuality?.voicedCoveragePct ?? null,
      confidence: overrides.takeQuality?.confidence || 'medium', // 'low' | 'medium' | 'high'
    },

    // targetFit — discrete status per axis. The model phrases what the code decided.
    targetFit: {
      pitch: {
        status: overrides.targetFit?.pitch?.status || 'uncertain',
        medianHz: overrides.targetFit?.pitch?.medianHz ?? null,
        semitoneDeltaToTargetCenter: overrides.targetFit?.pitch?.semitoneDeltaToTargetCenter ?? null,
        percentInBand: overrides.targetFit?.pitch?.percentInBand ?? null,
        bandFloorHz: overrides.targetFit?.pitch?.bandFloorHz ?? null,
        bandCeilingHz: overrides.targetFit?.pitch?.bandCeilingHz ?? null,
      },
      resonance: {
        status: overrides.targetFit?.resonance?.status || 'uncertain',
        evidence: overrides.targetFit?.resonance?.evidence || '',
      },
      weight: {
        status: overrides.targetFit?.weight?.status || 'uncertain',
        evidence: overrides.targetFit?.weight?.evidence || '',
      },
    },

    // coachingDecision — the core v2 decision block. The model phrases this.
    coachingDecision: {
      primaryFocus: overrides.coachingDecision?.primaryFocus || 'none',
      reason: overrides.coachingDecision?.reason || '',
      // Full object (not just ID) — model phrases the instruction, code already selected.
      recommendedDrill: overrides.coachingDecision?.recommendedDrill || {
        id: null,
        instruction: '',
        successCriteria: '',
      },
      // Cues to skip on this turn (intersected with the drill's avoidCues)
      avoidCues: overrides.coachingDecision?.avoidCues || [],
      // Cues that would count as a win on this turn
      successCriteria: overrides.coachingDecision?.successCriteria || [],
      // The model-facing intent (mirrors coachMove.intent for clarity)
      intent: overrides.coachingDecision?.intent || 'single_actionable_cue',
    },

    // safety at the top level (mirror policy.safetyState for v2 consumers)
    safety: {
      shouldStop: overrides.safety?.shouldStop ?? false,
      shouldHydrateOrRest: overrides.safety?.shouldHydrateOrRest ?? false,
      avoidHighPitchPush: overrides.safety?.avoidHighPitchPush ?? false,
      messageConstraint: overrides.safety?.messageConstraint || '',
    },

    // history — last-3-take summary and overall trend
    history: {
      last3TakeSummary: overrides.history?.last3TakeSummary || '',
      trend: overrides.history?.trend || 'uncertain',
      baseline: {
        // Frozen baseline deltas (null if no baseline captured yet)
        pitchMedianDeltaHz: overrides.history?.baseline?.pitchMedianDeltaHz ?? null,
        pitchMedianDeltaSt: overrides.history?.baseline?.pitchMedianDeltaSt ?? null,
        pitchRangeDeltaSt: overrides.history?.baseline?.pitchRangeDeltaSt ?? null,
        resonanceDeltaPct: overrides.history?.baseline?.resonanceDeltaPct ?? null,
        weightDeltaPct: overrides.history?.baseline?.weightDeltaPct ?? null,
        targetHitPctDelta: overrides.history?.baseline?.targetHitPctDelta ?? null,
      },
      // v4 baseline honesty: set only when a baseline exists but was measured
      // under a different analyzer calibration than the current take, in which
      // case every delta above stays null and this one neutral line is rendered
      // in place of the numeric VsBaseline comparison.
      baselineNote: overrides.history?.baselineNote || '',
    },

    // referenceFit — compares learner voice to a loaded reference voice clip.
    // When enabled, coaching should prioritize reference alignment over generic targetFit.
    referenceFit: {
      enabled: overrides.referenceFit?.enabled ?? false,
      clipId: overrides.referenceFit?.clipId ?? null,
      clipName: overrides.referenceFit?.clipName ?? null,
      referenceMetrics: {
        meanPitchHz: overrides.referenceFit?.referenceMetrics?.meanPitchHz ?? null,
        resonanceMean: overrides.referenceFit?.referenceMetrics?.resonanceMean ?? null,
        weightMean: overrides.referenceFit?.referenceMetrics?.weightMean ?? null,
      },
      pitch: {
        status: overrides.referenceFit?.pitch?.status || 'uncertain',
        semitoneDelta: overrides.referenceFit?.pitch?.semitoneDelta ?? null,
      },
      resonance: {
        status: overrides.referenceFit?.resonance?.status || 'uncertain',
        deltaPct: overrides.referenceFit?.resonance?.deltaPct ?? null,
      },
      weight: {
        status: overrides.referenceFit?.weight?.status || 'uncertain',
        deltaPct: overrides.referenceFit?.weight?.deltaPct ?? null,
      },
      alignmentScore: overrides.referenceFit?.alignmentScore ?? null,
    },

    // doNotSay — phrases the sanitizer MUST strip post-hoc.
    // Populated from drill contraindications, scenario avoidTopics, safety state, and
    // any explicit overrides (e.g. "never use 'masculine' or 'feminine' in the cue").
    doNotSay: overrides.doNotSay || [],

    // ===== 2026-07-19 zero-friction blocks =====

    // takeKind — what kind of take this turn reacted to (see TAKE_KINDS).
    takeKind: overrides.takeKind || 'phrase',

    // kindMetrics — the COMPACT per-kind metric block (signal-builder owns the
    // per-kind table). Empty object for kinds with no honest metrics
    // (ear_training/silent) and for 'phrase'/'spontaneous', which keep using
    // audioMetrics. All values null-tolerant.
    kindMetrics: (overrides.kindMetrics && typeof overrides.kindMetrics === 'object'
      && !Array.isArray(overrides.kindMetrics)) ? overrides.kindMetrics : {},

    // sessionScope — how much voice the current place allows + eyes-free flag.
    // tier source: 'explicit' (runtime/session), 'voice-state', 'ring-default'
    // (recalled from the sessions ring for this daypart), or 'default'.
    sessionScope: {
      tier: overrides.sessionScope?.tier || 'full',
      eyesFree: overrides.sessionScope?.eyesFree === true,
      source: overrides.sessionScope?.source || 'default',
    },

    // ===== 2026-07-30 cue carry-forward =====

    // previousCue — the cue the PREVIOUS coach turn gave, or null. Shape
    // { id, axis, instruction }, read off voiceState.lastCueGiven (the runtime
    // stamps it at the end of every coach turn from THIS block's
    // recommendedDrill).
    //
    // NOT a duplicate of coachingDecision.recommendedDrill. That field is the
    // drill for THIS turn — what she is about to be asked to do. This one is
    // what she was already doing when the take being judged was produced, which
    // is the only thing that lets a win line name the action instead of reaching
    // for a stock sentence. Consumers must never treat the pairing as causal:
    // at one attempt we know the cue and the improvement CO-OCCURRED, nothing more.
    previousCue: (overrides.previousCue && typeof overrides.previousCue === 'object'
      && !Array.isArray(overrides.previousCue) && overrides.previousCue.id)
      ? {
        id: overrides.previousCue.id,
        axis: overrides.previousCue.axis || null,
        instruction: overrides.previousCue.instruction || '',
      }
      : null,
  };
}

/**
 * v2 structural validation. Checks v1 + v2 required blocks.
 * The model can phrase anything — but the structure must be valid for the renderer
 * to format it without crashing and for the sanitizer to enforce doNotSay.
 */
function isValidCoachingSignal(signal) {
  if (!signal || typeof signal !== 'object') return false;
  if (!SCHEMA_VERSIONS.includes(signal.schema)) return false;

  // v1 required blocks
  if (!signal.capture || typeof signal.capture !== 'object') return false;
  if (!signal.policy || typeof signal.policy !== 'object') return false;
  if (!signal.coachMove || typeof signal.coachMove !== 'object') return false;
  if (!SIGNAL_INTENTS.includes(signal.coachMove.intent)) return false;
  if (!SAFETY_STATES.includes(signal.policy.safetyState)) return false;
  if (signal.policy.coachingAction && !COACHING_ACTIONS.includes(signal.policy.coachingAction)) return false;

  // v2 optional but validated when present
  if (signal.targetFit) {
    if (!PITCH_STATUSES.includes(signal.targetFit.pitch?.status)) return false;
    if (!RESONANCE_STATUSES.includes(signal.targetFit.resonance?.status)) return false;
    if (!WEIGHT_STATUSES.includes(signal.targetFit.weight?.status)) return false;
  }
  if (signal.coachingDecision) {
    if (!FOCUS_AXES.includes(signal.coachingDecision.primaryFocus)) return false;
    if (!SIGNAL_INTENTS.includes(signal.coachingDecision.intent)) return false;
  }
  if (signal.history && !TREND_VALUES.includes(signal.history.trend)) return false;
  if (signal.takeQuality && !['low', 'medium', 'high'].includes(signal.takeQuality.confidence)) {
    return false;
  }
  if (signal.referenceFit) {
    if (signal.referenceFit.enabled) {
      if (!PITCH_STATUSES.includes(signal.referenceFit.pitch?.status)) return false;
      if (!RESONANCE_STATUSES.includes(signal.referenceFit.resonance?.status)) return false;
      if (!WEIGHT_STATUSES.includes(signal.referenceFit.weight?.status)) return false;
    }
  }
  if (signal.doNotSay && !Array.isArray(signal.doNotSay)) return false;

  // 2026-07-19 zero-friction blocks (optional; validated when present)
  if (signal.takeKind != null && !TAKE_KINDS.includes(signal.takeKind)) return false;
  if (signal.kindMetrics != null
    && (typeof signal.kindMetrics !== 'object' || Array.isArray(signal.kindMetrics))) return false;
  if (signal.sessionScope != null) {
    if (typeof signal.sessionScope !== 'object' || Array.isArray(signal.sessionScope)) return false;
    if (signal.sessionScope.tier != null && !SESSION_TIERS.includes(signal.sessionScope.tier)) return false;
  }

  // 2026-07-30 cue carry-forward (optional; validated when present). A cue with
  // no id cannot be named later, so it is not a valid carried cue.
  if (signal.previousCue != null) {
    if (typeof signal.previousCue !== 'object' || Array.isArray(signal.previousCue)) return false;
    if (typeof signal.previousCue.id !== 'string' || !signal.previousCue.id.trim()) return false;
  }

  return true;
}

/**
 * Do the reference clip and the current take share one acoustic calibration?
 *
 * `analysisVersion` is stamped by the analyzer on both the stored reference
 * analysis and every take summary. The resonance/weight comparisons below are
 * FORMANT-DERIVED (resonance rides F2, weight rides F1 + pitch), so the formant
 * repair at `voice-metrics-v4-formants` changed what those numbers MEAN: a
 * front-vowel F2 that read ~798 Hz under v3 reads ~2761 under v4, moving
 * resonance from ~0.0 to ~0.8 with no change in the voice. Comparing a v3
 * reference against a v4 take therefore manufactures a ~0.7 delta out of the
 * instrument alone.
 *
 * The runtime's own bind-time gate (`assertReferenceCalibrationMatch`) only
 * proves the reference and its DERIVED PROFILE agree with EACH OTHER, so a
 * custom-reference preset saved before the bump binds as a self-consistent v3
 * pair and reaches here unflagged. This is that gate's missing half: the take.
 *
 * Returns true only when both versions are present and equal — an absent stamp
 * is unknown calibration, which is treated as a mismatch, never as a match.
 */
function isReferenceCalibrationComparable(voiceState) {
  const referenceVersion = voiceState?.referenceAnalysis?.analysisVersion;
  const takeVersion = voiceState?.lastSummary?.analysisVersion;
  if (typeof referenceVersion !== 'string' || !referenceVersion.trim()) return false;
  if (typeof takeVersion !== 'string' || !takeVersion.trim()) return false;
  return referenceVersion.trim() === takeVersion.trim();
}

/**
 * Build a referenceFit block comparing learner live metrics to the reference voice.
 * Returns { enabled: false } when no reference is loaded.
 */
function buildReferenceFit(voiceState, liveMetrics) {
  const ref = voiceState?.referenceAnalysis;
  if (!ref || !ref.metrics) {
    return { enabled: false };
  }

  const refMetrics = ref.metrics;
  const live = liveMetrics || {};
  // Pitch is measured by the pitch tracker and is untouched by the formant
  // repair, so it stays comparable across calibrations. Resonance and weight do
  // not — they are suppressed rather than reported when the versions disagree.
  const timbreComparable = isReferenceCalibrationComparable(voiceState);

  // Pitch comparison (in semitones)
  let pitchStatus = 'uncertain';
  let semitoneDelta = null;
  if (refMetrics.meanPitchHz && live.meanPitchHz) {
    semitoneDelta = 12 * Math.log2(live.meanPitchHz / refMetrics.meanPitchHz);
    if (Math.abs(semitoneDelta) < 2) pitchStatus = 'in_band';
    else if (semitoneDelta < -2) pitchStatus = 'below';
    else pitchStatus = 'above';
  }

  // Resonance comparison (percentage points). The +-0.05 tolerance is a
  // SAME-INSTRUMENT tolerance: it carries no assumption about the v3 or v4 scale,
  // only that both sides were measured the same way. That premise is what
  // `timbreComparable` enforces.
  let resonanceStatus = 'uncertain';
  let resonanceDelta = null;
  if (timbreComparable && refMetrics.resonanceMean != null && live.resonanceMean != null) {
    resonanceDelta = live.resonanceMean - refMetrics.resonanceMean;
    if (Math.abs(resonanceDelta) <= 0.05) resonanceStatus = 'target';
    else if (resonanceDelta > 0.05) resonanceStatus = 'too_bright';
    else resonanceStatus = 'too_dark';
  }

  // Weight comparison (percentage points)
  let weightStatus = 'uncertain';
  let weightDelta = null;
  if (timbreComparable && refMetrics.weightMean != null && live.weightMean != null) {
    weightDelta = live.weightMean - refMetrics.weightMean;
    if (Math.abs(weightDelta) <= 0.05) weightStatus = 'target';
    else if (weightDelta > 0.05) weightStatus = 'too_heavy';
    else weightStatus = 'too_light';
  }

  // Alignment score (0-100)
  const scores = [];
  if (semitoneDelta != null) scores.push(Math.max(0, 100 - Math.abs(semitoneDelta) * 20));
  if (resonanceDelta != null) scores.push(Math.max(0, 100 - Math.abs(resonanceDelta) * 500));
  if (weightDelta != null) scores.push(Math.max(0, 100 - Math.abs(weightDelta) * 500));
  const alignmentScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

  return {
    enabled: true,
    clipId: voiceState.referenceClipId || null,
    clipName: voiceState.referenceName || null,
    referenceMetrics: {
      meanPitchHz: refMetrics.meanPitchHz || null,
      resonanceMean: refMetrics.resonanceMean || null,
      weightMean: refMetrics.weightMean || null,
    },
    pitch: { status: pitchStatus, semitoneDelta },
    resonance: { status: resonanceStatus, deltaPct: resonanceDelta != null ? resonanceDelta * 100 : null },
    weight: { status: weightStatus, deltaPct: weightDelta != null ? weightDelta * 100 : null },
    alignmentScore,
  };
}

/**
 * Returns true if the signal is v2 (vs legacy v1).
 */
function isV2(signal) {
  return signal?.schema === COACHING_SIGNAL_SCHEMA;
}

module.exports = {
  COACHING_SIGNAL_SCHEMA,
  COACHING_SIGNAL_SCHEMA_V1,
  SCHEMA_VERSIONS,
  SIGNAL_INTENTS,
  PITCH_STATUSES,
  RESONANCE_STATUSES,
  WEIGHT_STATUSES,
  FOCUS_AXES,
  TREND_VALUES,
  SAFETY_STATES,
  COACHING_ACTIONS,
  CAPTURE_RELIABILITY,
  TAKE_KINDS,
  SESSION_TIERS,
  buildCoachingSignal,
  buildReferenceFit,
  isReferenceCalibrationComparable,
  isValidCoachingSignal,
  isV2,
};
