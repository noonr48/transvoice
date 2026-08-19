'use strict';

/**
 * SafetyGates — deterministic safety assessment from analyzer metrics and self-reports.
 *
 * Never uses LLM. Inspects raw metrics and produces a safety state + reasons.
 * Ported from deeptutor-voice-adapter.js collectDeepTutorVoiceAnalyzerSafetyReasons.
 *
 * 2026-07-18 truth+safety wave:
 *  - Thresholds come from coaching/safety-thresholds.js (the canonical module;
 *    the original port mis-read the adapter's (ceiling, offset, fallback)
 *    signature as (ceiling, soft, hard), which made the tiny OFFSETS the live
 *    no-profile thresholds — strain fired at 0.10 — and collapsed fire == stop
 *    whenever a profile ceiling existed).
 *  - VOICE strain/breathy triggers are now two-tier: an immediate 'stop' only
 *    at/above the stop threshold (one genuinely risky take stops the work —
 *    safety first), while the softer warn tier interrupts only on a SECOND
 *    strike within the guardian's recent-take window (guardian.js owns that
 *    window rule; its strainWatch is mirrored onto voiceState at take-finalize).
 *    One slightly-pressed take no longer flips the session into a hold.
 *  - Capture-reliability checks are unchanged.
 */

const {
  normalizeVoiceSafetyMetric,
  resolveStrainThresholds,
  resolveBreathyThreshold,
} = require('./safety-thresholds');
const { hasRecentStrainStrike, GUARDIAN_CONSTANTS } = require('../lessons/guardian');

function normalizeMetric(value) {
  // null/undefined = "no measurement" -> MUST stay null, never 0. Number(null)===0
  // is finite, so without this guard an absent metric (e.g. snrDb/transcriptConfidence
  // on a turn with no real audio capture) became a real 0 and tripped every
  // capture-reliability check that uses a `< threshold` test (snr<12, confidence<0.4,
  // captureReliability<0.3) -> false capture_only / 'unusable' -> breather on every
  // no-audio turn. Voice-safety checks use `>= threshold`, so 0 never tripped them:
  // this guard only removes the capture false-positives, leaving strain/breathy intact.
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatPercent(value) {
  return value != null ? `${Math.round(value * 100)}%` : '?';
}

/**
 * Collect analyzer-based safety reasons from voice state metrics.
 * Returns array of { label, severity: 'stop'|'reset', kind: 'voice'|'capture' }
 *
 * `witness` (optional) is mutated with the voice-tier threshold decisions
 * (threshold source, strike counts, fired/suppressed) so the runtime can log
 * one structured line per turn without this module owning a logger.
 *
 * `options.takeKind` (optional, 2026-07-19): vocalise kinds (sustained/
 * hum_sovt/siren) use the LENIENT strain warn bar (safety-thresholds.js —
 * raised warn, stop tier untouched). The witness records the interpretation.
 */
function collectAnalyzerSafetyReasons(voiceState, witness = null, options = {}) {
  const summary = voiceState?.lastSummary || voiceState?.lastAttemptArtifact?.summary || {};
  const metrics = summary?.metrics || {};
  const advanced = metrics?.advanced || {};
  const quality = advanced?.quality || {};
  const advancedBands = voiceState?.targetVoiceProfile?.advancedBands || {};
  const qualityBands = advancedBands?.quality || {};
  const phraseQuality = voiceState?.phraseComparison?.analysisQuality || {};
  const inputRuntime = voiceState?.voiceInputRuntime || {};
  const reasons = [];

  // Guardian second-strike state: the guardian's strainWatch (mirrored onto the
  // voiceState at take-finalize) includes the CURRENT take's flag, so a strike
  // count >= 2 means "this take plus at least one more within the window".
  const strainWatch = voiceState?.strainWatch || null;
  const secondStrike = hasRecentStrainStrike(strainWatch);
  const strikeCount = Number.isFinite(Number(strainWatch?.recentFlags))
    ? Math.max(0, Math.round(Number(strainWatch.recentFlags)))
    : 0;

  // Voice safety: strain risk — two-tier.
  //   >= stop threshold: immediate 'stop' (single take; safety first).
  //   >= warn threshold but < stop: 'reset' only on a second recent strike.
  // Vocalise take kinds get the lenient (raised) warn bar; stop is untouched.
  const takeKind = options && typeof options.takeKind === 'string' ? options.takeKind : null;
  const strainThresholds = resolveStrainThresholds(qualityBands, { takeKind });
  const strainRisk = normalizeVoiceSafetyMetric(quality.strainRisk);
  if (witness) {
    witness.strain = {
      risk: strainRisk,
      warn: strainThresholds.warn,
      stop: strainThresholds.stop,
      source: strainThresholds.source,
      takeKind,
      interpretation: strainThresholds.interpretation,
      strikes: strikeCount,
      strikesRequired: GUARDIAN_CONSTANTS.EASE_STRAIN_COUNT,
      tier: null,
    };
  }
  if (strainRisk != null && strainRisk >= strainThresholds.stop) {
    if (witness) witness.strain.tier = 'stop';
    reasons.push({
      label: `acoustic strain risk ${formatPercent(strainRisk)}`,
      severity: 'stop',
      kind: 'voice',
    });
  } else if (strainRisk != null && strainRisk >= strainThresholds.warn) {
    if (secondStrike) {
      if (witness) witness.strain.tier = 'warn-fired';
      reasons.push({
        label: `acoustic strain risk ${formatPercent(strainRisk)}`,
        severity: 'reset',
        kind: 'voice',
      });
    } else if (witness) {
      witness.strain.tier = 'warn-suppressed';
    }
  }

  // Voice safety: breathy risk — warn-only tier (the adapter defines no breathy
  // stop pair), gated by the same guardian second-strike window. The guardian's
  // own accumulator still watches sustained breathiness (its 0.62 bar counts
  // breathy takes as strain evidence), so a persistent pattern speaks there.
  const breathyThreshold = resolveBreathyThreshold(qualityBands);
  const breathyRisk = normalizeVoiceSafetyMetric(quality.breathyRisk);
  if (witness) {
    witness.breathy = {
      risk: breathyRisk,
      warn: breathyThreshold.warn,
      source: breathyThreshold.source,
      strikes: strikeCount,
      strikesRequired: GUARDIAN_CONSTANTS.EASE_STRAIN_COUNT,
      tier: null,
    };
  }
  if (breathyRisk != null && breathyRisk >= breathyThreshold.warn) {
    if (secondStrike) {
      if (witness) witness.breathy.tier = 'warn-fired';
      reasons.push({
        label: `breathy instability ${formatPercent(breathyRisk)}`,
        severity: 'reset',
        kind: 'voice',
      });
    } else if (witness) {
      witness.breathy.tier = 'warn-suppressed';
    }
  }

  // Capture reliability: score confidence
  const scoreConfidence = normalizeMetric(advanced.scoreConfidence);
  if (scoreConfidence != null && scoreConfidence < 0.48) {
    reasons.push({ label: `low analyzer confidence ${formatPercent(scoreConfidence)}`, severity: 'reset', kind: 'capture' });
  }

  // Capture reliability: voiced coverage
  const voicedFramePct = normalizeMetric(advanced.voicedFramePct);
  const pitchValidFrameCount = normalizeMetric(advanced.pitchValidFrameCount);
  if (
    voicedFramePct != null
    && voicedFramePct < 0.45
    && !(pitchValidFrameCount != null && pitchValidFrameCount >= 20)
  ) {
    reasons.push({ label: `low voiced coverage ${formatPercent(voicedFramePct)}`, severity: 'reset', kind: 'capture' });
  }

  // Capture reliability: confident frames
  const confidentFramePct = normalizeMetric(advanced.confidentFramePct);
  if (confidentFramePct != null && confidentFramePct < 0.5) {
    reasons.push({ label: `low confident frames ${formatPercent(confidentFramePct)}`, severity: 'reset', kind: 'capture' });
  }

  // Capture reliability: SNR
  const snrDb = normalizeMetric(advanced.snrDb ?? inputRuntime.lastSnrDb);
  if (snrDb != null && snrDb < 12) {
    reasons.push({ label: `poor signal-to-noise ratio ${snrDb.toFixed(1)} dB`, severity: 'reset', kind: 'capture' });
  }

  // Capture reliability: clipping — SUSTAINED clipping only (2026-07-19).
  // The metric is the fraction of samples at/over saturation across the take,
  // now actually produced by the analyzer (attempt advanced.clippingPct) and by
  // the first-run mic check (inputRuntime.lastClippingPct). The original 0.001
  // (0.1%) bar fired on a single hot plosive (~8 ms of an 8 s take) — a
  // hair-trigger on consumer USB/laptop mics, which capture with AGC/NS/EC
  // deliberately off. 0.02 (2%) is sustained-clipping territory while keeping
  // 2.5x headroom under the reference clone-gate's reject bar
  // (reference_analyzer._CLONE_MAX_CLIPPING_PCT = 0.05).
  const clippingPct = normalizeMetric(advanced.clippingPct ?? inputRuntime.lastClippingPct);
  if (clippingPct != null && clippingPct >= 0.02) {
    reasons.push({ label: `microphone clipping ${formatPercent(clippingPct)}`, severity: 'reset', kind: 'capture' });
  }

  // Capture reliability: overall
  const captureReliability = normalizeMetric(advanced.captureReliability ?? inputRuntime.lastCaptureReliability);
  if (captureReliability != null && captureReliability < 0.5) {
    reasons.push({ label: `low capture reliability ${formatPercent(captureReliability)}`, severity: 'reset', kind: 'capture' });
  }

  // Phrase comparison reliability
  const phraseScoreConfidence = normalizeMetric(phraseQuality.scoreConfidence);
  if (phraseQuality.reliable === false || (phraseScoreConfidence != null && phraseScoreConfidence < 0.45)) {
    reasons.push({
      label: phraseScoreConfidence != null
        ? `low phrase score confidence ${formatPercent(phraseScoreConfidence)}`
        : 'unreliable phrase comparison',
      severity: 'reset',
      kind: 'capture',
    });
  }

  // ASR confidence
  const transcriptConfidence = normalizeMetric(inputRuntime.lastTranscriptConfidence);
  if (transcriptConfidence != null && transcriptConfidence < 0.4) {
    reasons.push({ label: `low speech input confidence ${formatPercent(transcriptConfidence)}`, severity: 'reset', kind: 'capture' });
  }

  // Speech input failures
  if (inputRuntime.lastOutcome === 'no-speech' || Number(inputRuntime.consecutiveNoSpeechTurns || 0) >= 2) {
    reasons.push({ label: 'speech input did not capture a usable phrase', severity: 'reset', kind: 'capture' });
  }
  if (inputRuntime.lastOutcome === 'error' || Number(inputRuntime.consecutiveErrorTurns || 0) >= 1 || inputRuntime.lastError) {
    reasons.push({ label: 'speech input runtime error', severity: 'reset', kind: 'capture' });
  }

  // Deduplicate
  const seen = new Set();
  return reasons.filter((reason) => {
    if (!reason?.label || seen.has(reason.label)) return false;
    seen.add(reason.label);
    return true;
  });
}

/**
 * Normalize self-reported strain/fatigue score (0-5 scale).
 */
function normalizeSelfReportScore(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 && num <= 5 ? Math.round(num) : null;
}

/**
 * Assess combined safety state from analyzer + self-report.
 *
 * Returns: {
 *   state: 'normal'|'capture_only'|'fatigue_or_strain'|'stop',
 *   active: boolean,
 *   reasons: string[],
 *   instruction: string,
 *   shouldCorrect: boolean,
 *   avoidTopics: string[],
 * }
 */
function assessSafetyState(voiceState, options = {}) {
  // Witness record for the runtime's structured log line (threshold source,
  // strike counts, warn fired/suppressed). Additive — carried on the return.
  const witness = {};
  const analyzerReasons = collectAnalyzerSafetyReasons(voiceState, witness, options);
  const report = voiceState?.lastAttemptArtifact?.selfReport
    || voiceState?.lastAttemptArtifact?.self_report
    || null;

  let strain = null;
  let fatigue = null;
  if (report && typeof report === 'object' && !Array.isArray(report)) {
    strain = normalizeSelfReportScore(report.strain);
    fatigue = normalizeSelfReportScore(report.fatigue);
  }

  const selfReportActive = (strain != null && strain >= 4) || (fatigue != null && fatigue >= 4);
  const analyzerActive = analyzerReasons.length > 0;
  const combinedActive = selfReportActive || analyzerActive;

  const hasStop = strain === 5 || fatigue === 5 || analyzerReasons.some((r) => r.severity === 'stop');
  const hasVoiceReasons = analyzerReasons.some((r) => r.kind === 'voice') || selfReportActive;
  const hasCaptureReasons = analyzerReasons.some((r) => r.kind === 'capture');
  const captureOnly = combinedActive && !selfReportActive && hasCaptureReasons && !hasVoiceReasons;

  let state;
  if (!combinedActive) {
    state = 'normal';
  } else if (hasStop) {
    state = 'stop';
  } else if (selfReportActive || hasVoiceReasons) {
    state = 'fatigue_or_strain';
  } else {
    state = 'capture_only';
  }

  const allReasons = [
    strain != null ? `strain ${strain}/5` : null,
    fatigue != null ? `fatigue ${fatigue}/5` : null,
    ...analyzerReasons.map((r) => r.label),
  ].filter(Boolean);

  const instruction = state === 'stop'
    ? 'Switch to a very gentle hum or lip trill with no pushing or added intensity.'
    : state === 'fatigue_or_strain'
      ? 'Reduce the effort and use one easy, low-effort coordination.'
      : state === 'capture_only'
        ? 'Get one easy, clearly voiced capture before assessing the voice.'
        : '';

  const shouldCorrect = state === 'normal';
  const avoidTopics = [];
  if (state === 'stop' || state === 'fatigue_or_strain') {
    avoidTopics.push('intensity', 'difficulty', 'pushing');
  }
  if (captureOnly) {
    avoidTopics.push('voice_analysis');
  }

  return {
    state,
    active: combinedActive,
    captureOnly,
    reasons: allReasons,
    instruction,
    shouldCorrect,
    avoidTopics,
    witness,
  };
}

/**
 * Derive capture reliability level from metrics.
 */
function assessCaptureReliability(voiceState) {
  const summary = voiceState?.lastSummary || voiceState?.lastAttemptArtifact?.summary || {};
  const advanced = summary?.metrics?.advanced || {};
  const inputRuntime = voiceState?.voiceInputRuntime || {};

  const captureReliability = normalizeMetric(advanced.captureReliability ?? inputRuntime.lastCaptureReliability);
  const scoreConfidence = normalizeMetric(advanced.scoreConfidence);
  const voicedFramePct = normalizeMetric(advanced.voicedFramePct);
  const pitchValidFrameCount = normalizeMetric(advanced.pitchValidFrameCount);

  if (captureReliability != null && captureReliability < 0.3) return 'unusable';
  if (captureReliability != null && captureReliability < 0.5) return 'low';
  if (scoreConfidence != null && scoreConfidence < 0.48) return 'degraded';
  if (
    voicedFramePct != null
    && voicedFramePct < 0.45
    && !(pitchValidFrameCount != null && pitchValidFrameCount >= 20)
  ) return 'degraded';
  return 'good';
}

module.exports = {
  assessSafetyState,
  assessCaptureReliability,
  collectAnalyzerSafetyReasons,
};
