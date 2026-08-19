'use strict';

/**
 * TV-FEM-R1-003 — monotonic session attempt sequence.
 *
 * GPT-Pro finding 2.2: "exact next attempt" was a caller convention
 * (consumeNextFinalizedAttempt: true is a declaration, not enforcement). This
 * module is the enforcement basis: finalized attempts receive monotonically
 * increasing ordinals; eligibility is recorded with a deterministic reason
 * (ineligible WITHOUT a reason is a contract violation, not silently
 * eligible). The motor trial binds the expected next ELIGIBLE ordinal at
 * creation — ineligible attempts between are lawfully skipped; an eligible
 * attempt between baseline and the settling attempt is a cherry-pick and
 * terminally invalidates the trial.
 */

const ATTEMPT_SEQUENCE_SCHEMA = 'transvoice.session_attempt_sequence.v1';
const MAX_TRACKED_ATTEMPTS = 500;

function createAttemptSequence() {
  return {
    schema: ATTEMPT_SEQUENCE_SCHEMA,
    nextOrdinal: 1,
    attempts: [],
  };
}

/**
 * Record one finalized attempt. Eligible attempts are candidates for trial
 * settlement; ineligible attempts MUST carry a deterministic reason (the
 * runtime classifies capture failures etc. — it never silently skips).
 * Returns the assigned record.
 */
function recordFinalizedAttempt(sequence, {
  attemptArtifactId = null,
  eligible = false,
  ineligibleReason = null,
} = {}) {
  const seq = sequence && typeof sequence === 'object' && !Array.isArray(sequence)
    && sequence.schema === ATTEMPT_SEQUENCE_SCHEMA
    ? sequence
    : null;
  if (!seq) throw new Error('attempt_sequence_required');
  if (eligible !== true && (typeof ineligibleReason !== 'string' || !ineligibleReason.trim())) {
    throw new Error('ineligibleReason_required_for_ineligible_attempt');
  }
  const ordinal = seq.nextOrdinal;
  const record = {
    ordinal,
    attemptArtifactId: typeof attemptArtifactId === 'string' && attemptArtifactId.trim()
      ? attemptArtifactId.trim().slice(0, 160)
      : null,
    eligible: eligible === true,
    ineligibleReason: eligible === true ? null : ineligibleReason.trim().slice(0, 120),
  };
  seq.attempts.push(record);
  if (seq.attempts.length > MAX_TRACKED_ATTEMPTS) {
    seq.attempts.splice(0, seq.attempts.length - MAX_TRACKED_ATTEMPTS);
  }
  seq.nextOrdinal = ordinal + 1;
  return record;
}

/**
 * The first ELIGIBLE finalized attempt ordinal strictly after `afterOrdinal`,
 * or null. Ineligible attempts are lawfully skipped (they were never
 * settlement candidates — e.g. unusable capture).
 */
function nextEligibleOrdinalAfter(sequence, afterOrdinal) {
  const seq = sequence && typeof sequence === 'object' && !Array.isArray(sequence)
    && Array.isArray(sequence.attempts)
    ? sequence
    : null;
  if (!seq || !Number.isFinite(afterOrdinal)) return null;
  for (const attempt of seq.attempts) {
    if (attempt.ordinal > afterOrdinal && attempt.eligible === true) {
      return attempt.ordinal;
    }
  }
  return null;
}

module.exports = {
  ATTEMPT_SEQUENCE_SCHEMA,
  createAttemptSequence,
  nextEligibleOrdinalAfter,
  recordFinalizedAttempt,
};
