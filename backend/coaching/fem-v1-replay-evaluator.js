'use strict';

const { CURRICULUM_PHASES, METRIC_RULES, normalizeCurriculumPhase } = require('./feminization-v1-policy');

const FEM_V1_REPLAY_REPORT_SCHEMA = 'transvoice.fem_v1_replay_report.v1';

// Legacy focus names map to the research-engine dimensions the legacy
// pipeline coached (target-metric-bridge legacyFocusForDecision). Only the
// reverse mapping needed for policy replay is listed; unknown legacy names
// are reported as unmapped (unknown, never assumed eligible).
const LEGACY_FOCUS_TO_DIMENSION = Object.freeze({
  pitch_floor: 'pitch.register',
  pitch_lower: 'pitch.register',
  resonance_forward: 'resonance.global_scale',
  vocal_weight: 'phonation.source_weight',
  tone_clarity: 'phonation.breathiness',
  phrase_ending: 'prosody.phrase_ending',
});

// Legacy focus names whose v1 dimension is research-only or later-phase are
// policy-relevant; the mapping above lets the evaluator replay the v1 policy
// against what legacy actually coached.

function textOrNull(value, maxLength = 200) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

/**
 * STRICT numeric evidence: only an actual finite number counts. Strings,
 * booleans, arrays, NaN, Infinity — everything else is missing evidence
 * (null), never a coerced measurement. `[]` is not 0 effort; `true` is not
 * effort 1; `'  '` is not 0. Forged or malformed rows land in the missing
 * bucket, never in the mean.
 */
function strictFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function legacyFocusDimension(legacyFocus) {
  const key = textOrNull(legacyFocus, 120);
  return key && Object.prototype.hasOwnProperty.call(LEGACY_FOCUS_TO_DIMENSION, key)
    ? LEGACY_FOCUS_TO_DIMENSION[key]
    : null;
}

function dimensionEligibleForPhase(dimension, phase) {
  const key = textOrNull(dimension, 160);
  if (!key || !Object.prototype.hasOwnProperty.call(METRIC_RULES, key)) return false;
  return METRIC_RULES[key].phases.includes(phase);
}

function isRowShape(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * TV-FEM-P6-001 — the deterministic replay evaluator (master plan 17.4).
 *
 * Consumes RETAINED replay rows (one per retained turn, plus optional
 * settlement/retention records on the same row) and reports, per the
 * backlog acceptance criteria:
 *   legacy_vs_v1_focus, phase_policy_violations, rejection_reasons,
 *   confound_rate, retention_rate, effort_change
 * plus the 17.4 aggregates no_evidence_rate and focus_distribution.
 *
 * Laws:
 * - UNKNOWN IS NOT ZERO: rates over zero qualifying rows are null, never 0.
 * - Malformed rows are skipped and counted — never silently dropped, never
 *   crash the report.
 * - Pure function: no IO, no clock, deterministic aggregation.
 *
 * Row shape (adapter responsibility at wiring time):
 * { rowId, phase, legacyFocus, v1Focus, v1Action, v1Reason,
 *   eligibilityRejected: [{dimension, reason}], settlement:
 *   { result, effortBefore, effortAfter } | null, retention:
 *   { retained } | null }
 *
 * Adapter rules: legacyFocus is null for legacy 'none'/absent turns (an
 * unmapped legacy name is reported as a disagreement with unknown
 * dimension — never guessed). row.phase must be a KNOWN curriculum phase;
 * rows with unknown/garbled phases keep their phase-independent aggregates
 * (focus distribution, settlement, retention, effort) but are EXCLUDED
 * from phase-policy violation judging and counted in rowsPhaseUnknown —
 * judging a row against a defaulted phase would fabricate or mask
 * violations.
 */
function evaluateFemV1Replay(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const rowsTotal = list.length;
  const skippedReasons = [];

  const validRows = [];
  for (const candidate of list) {
    if (!isRowShape(candidate)) {
      skippedReasons.push('row_not_object');
      continue;
    }
    validRows.push(candidate);
  }

  let legacyAgreement = 0;
  let legacyDisagreement = 0;
  const disagreementRowIds = [];
  const violationRowIds = [];
  const violationDetails = [];
  const rejectionReasons = {};
  const focusDistribution = {};
  let noEvidenceRows = 0;

  let settled = 0;
  let confounded = 0;
  let retentionChecks = 0;
  let retained = 0;
  let settlementsMeasured = 0;
  let settlementsMissingEffort = 0;
  let effortDeltas = [];
  let effortIncreased = 0;
  let rowsPhaseUnknown = 0;

  for (const row of validRows) {
    const rawPhase = textOrNull(row.phase, 80);
    const phaseKnown = Boolean(rawPhase) && CURRICULUM_PHASES.includes(rawPhase);
    const phase = normalizeCurriculumPhase(rawPhase);
    const legacyFocus = textOrNull(row.legacyFocus, 120);
    const v1Focus = textOrNull(row.v1Focus, 160);
    const v1Action = textOrNull(row.v1Action, 80);
    const v1Reason = textOrNull(row.v1Reason, 160);

    // legacy vs v1 focus agreement (conceptual mapping; unmapped legacy
    // names are disagreements with dimension null — unknown, not guessed).
    const legacyDimension = legacyFocusDimension(legacyFocus);
    const comparable = Boolean(legacyFocus) && Boolean(v1Focus);
    if (comparable) {
      if (legacyDimension && legacyDimension === v1Focus) legacyAgreement += 1;
      else {
        legacyDisagreement += 1;
        disagreementRowIds.push(textOrNull(row.rowId, 200) || '(unidentified row)');
      }
    }

    // Phase-policy violations: retained coaching that v1 policy rejects.
    // Judged ONLY when the row's phase is known — an unknown phase must
    // never be defaulted into a verdict (fabricates/masks violations).
    if (!phaseKnown) rowsPhaseUnknown += 1;
    if (phaseKnown && legacyDimension && !dimensionEligibleForPhase(legacyDimension, phase)) {
      violationRowIds.push(textOrNull(row.rowId, 200) || '(unidentified row)');
      violationDetails.push({
        source: 'legacy',
        dimension: legacyDimension,
        phase,
      });
    }
    if (phaseKnown && v1Action === 'serve_exercise' && v1Focus
      && !dimensionEligibleForPhase(v1Focus, phase)) {
      violationRowIds.push(textOrNull(row.rowId, 200) || '(unidentified row)');
      violationDetails.push({
        source: 'v1',
        dimension: v1Focus,
        phase,
      });
    }

    // Rejection reasons from the eligibility summary.
    for (const rejected of Array.isArray(row.eligibilityRejected) ? row.eligibilityRejected : []) {
      const reason = textOrNull(rejected?.reason, 160);
      if (!reason) continue;
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
    }

    // Focus distribution + no-evidence rate.
    if (v1Focus) {
      focusDistribution[v1Focus] = (focusDistribution[v1Focus] || 0) + 1;
    }
    if (v1Action === 'end_block' && v1Reason === 'no_eligible_observation_for_phase') {
      noEvidenceRows += 1;
    }

    // Settlement aggregates.
    const settlement = isRowShape(row.settlement) ? row.settlement : null;
    if (settlement) {
      const result = textOrNull(settlement.result, 120);
      if (result) {
        settled += 1;
        if (result === 'confounded') confounded += 1;
      }
      const before = strictFiniteNumber(settlement.effortBefore);
      const after = strictFiniteNumber(settlement.effortAfter);
      if (before != null && after != null) {
        settlementsMeasured += 1;
        const delta = after - before;
        effortDeltas.push(delta);
        if (delta > 0) effortIncreased += 1;
      } else if (result) {
        settlementsMissingEffort += 1;
      }
    }

    // Retention aggregates.
    const retention = isRowShape(row.retention) ? row.retention : null;
    if (retention && typeof retention.retained === 'boolean') {
      retentionChecks += 1;
      if (retention.retained === true) retained += 1;
    }
  }

  const rowsEvaluated = validRows.length;
  return {
    schema: FEM_V1_REPLAY_REPORT_SCHEMA,
    rowsTotal,
    rowsEvaluated,
    rowsSkipped: rowsTotal - rowsEvaluated,
    rowsPhaseUnknown,
    skippedReasons,
    legacyVsV1Focus: {
      total: legacyAgreement + legacyDisagreement,
      agreement: legacyAgreement,
      disagreement: legacyDisagreement,
      disagreementRowIds,
    },
    phasePolicyViolations: {
      count: violationDetails.length,
      rowIds: violationRowIds,
      details: violationDetails,
    },
    rejectionReasons,
    noEvidenceRate: rowsEvaluated > 0 ? noEvidenceRows / rowsEvaluated : null,
    focusDistribution,
    confoundRate: settled > 0 ? confounded / settled : null,
    retentionRate: retentionChecks > 0 ? retained / retentionChecks : null,
    effortChange: {
      settlementsMeasured,
      settlementsMissingEffort,
      meanDelta: settlementsMeasured > 0
        ? effortDeltas.reduce((a, b) => a + b, 0) / settlementsMeasured
        : null,
      effortIncreasedRate: settlementsMeasured > 0 ? effortIncreased / settlementsMeasured : null,
    },
  };
}

module.exports = {
  FEM_V1_REPLAY_REPORT_SCHEMA,
  LEGACY_FOCUS_TO_DIMENSION,
  evaluateFemV1Replay,
};
