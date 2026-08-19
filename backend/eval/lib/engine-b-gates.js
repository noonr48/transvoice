'use strict';

/**
 * eval/lib/engine-b-gates.js — L1 SUITABILITY adapter.
 *
 * Reuses the LIVE Engine-B validators (sloane-ui voice-tutor-v2) + the
 * memory-dataset-gen gates as DIRECT per-reply scorers — no v3-record construction.
 * These are the rich quality/tone/direction/safety gates the corpus was generated
 * under; we import them so the eval bar == the corpus bar (parity-by-import).
 *
 * Covered suitability dimensions per reply:
 *   - direction-correctness : never cross-genders the learner (the key suitability
 *     gate). For mtf->'feminizing'; for NEUTRAL we run BOTH polarities so ANY
 *     gendered cue (fem or masc) is flagged. 2026-07-26: the ftm learner
 *     direction is retired, but BOTH cue polarities are still checked — a
 *     masculinizing cue reaching an mtf or neutral learner is still a violation.
 *   - tone                  : gamification ban, praise-needs-basis, no-minimization
 *     on hurt, global anti-quit (evaluateToneGates).
 *   - forbidden phrases     : "sound like a man/woman", "push into fry", etc.
 *   - pref obedience        : the Engine-B (corpus) preference gate.
 *   - hard-moment safety    : stricter normalized recitation check.
 *   - block faithfulness    : on the RAW reply, emitted op values are grounded.
 */

const path = require('path');

const VT2 = path.resolve(__dirname, '../../../../sloane-ui/backend/voice-tutor-v2');
const styleCompliance = require(path.join(VT2, 'style-compliance-v2.js'));
const { evaluateToneGates } = require(path.join(VT2, 'tone-gates.js'));
const memGates = require(path.resolve(__dirname, '../../../../memory-dataset-gen/gates.js'));
const { PREF_VALUE_TO_ID } = require('./scorers');

const { directionCueViolation, checkForbidden } = styleCompliance;
const { prefObeyViolation, hardMomentSafe, faithfulOps } = memGates;

// 2026-07-26 MTF-ONLY: `ftm` is no longer a learner direction. An unmapped
// direction falls through to the pre-existing no-gate path below.
const DIR_MAP = { mtf: 'feminizing' };

/**
 * direction-correctness for any learner direction.
 *   mtf -> a masculinizing cue is the violation (direction='feminizing')
 *   neutral -> ANY gendered cue (run both) is a violation
 */
function directionCorrectness(reply, learnerDirection) {
  if (learnerDirection === 'neutral') {
    const femLeak = directionCueViolation(reply, 'masculinizing'); // flags FEM cues
    const mascLeak = directionCueViolation(reply, 'feminizing'); // flags MASC cues
    const v = femLeak || mascLeak;
    return { ok: !v, violation: v || null };
  }
  const dir = DIR_MAP[learnerDirection];
  if (!dir) return { ok: true, violation: null };
  const v = directionCueViolation(reply, dir);
  return { ok: !v, violation: v || null };
}

// checkForbidden's return shape varies across versions; normalize defensively.
function safeForbidden(reply, mode) {
  try {
    const r = checkForbidden(reply, mode);
    if (r == null) return { ok: true, hits: [] };
    if (Array.isArray(r)) return { ok: r.length === 0, hits: r };
    if (typeof r === 'string') return { ok: false, hits: [r] };
    if (typeof r === 'object') {
      if ('ok' in r) return { ok: !!r.ok, hits: r.hits || r.violations || [] };
      if ('passed' in r) return { ok: !!r.passed, hits: r.hits || r.violations || [] };
    }
    return { ok: true, hits: [] };
  } catch { return { ok: true, hits: [] }; }
}

/**
 * Score a single reply on the L1 suitability layer.
 * @param {string} reply        the VISIBLE (sanitized) coach reply.
 * @param {object} ctx
 *   direction   'mtf'|'neutral'
 *   prefValue   canonical preference string (or null)
 *   mode        practice mode (default 'conversation')
 *   hurt        boolean — this turn is a hurt/debrief context (no-minimization fires)
 *   hardMoment  seeded hard-moment text that must not be recited (or null)
 *   utterance   the learner's turn text (for faithfulness grounding)
 *   rawReply    the RAW pre-strip reply (for block faithfulness)
 * @returns {object} per-dimension booleans + a flat `violations` list + `suitable`.
 */
function scoreSuitability(reply, ctx = {}) {
  const {
    direction, prefValue, mode = 'conversation', hurt = false,
    hardMoment = null, utterance = '', rawReply = null,
  } = ctx;

  const dirc = directionCorrectness(reply, direction);
  const tone = evaluateToneGates({ reply, mode, context: { hurt } }) || { ok: true, failures: [] };
  const forbidden = safeForbidden(reply, mode);
  const prefId = PREF_VALUE_TO_ID[prefValue] || prefValue || null;
  const prefV = prefId ? prefObeyViolation(reply, prefId) : null;
  const hms = hardMoment ? hardMomentSafe(reply, hardMoment) : null; // tag|null
  const faith = rawReply != null ? faithfulOps(rawReply, utterance) : null;

  const violations = [];
  if (!dirc.ok) violations.push(dirc.violation);
  if (!tone.ok) violations.push(...tone.failures);
  if (!forbidden.ok) violations.push(...forbidden.hits);
  if (prefV) violations.push(prefV);
  if (hms) violations.push(hms);
  if (faith && !faith.faithful) violations.push(...faith.violations);

  return {
    directionCorrect: dirc.ok,
    toneOk: tone.ok,
    forbiddenOk: forbidden.ok,
    prefObeyOk: !prefV,
    hardMomentSafe: !hms,
    blockFaithful: faith ? faith.faithful : null,
    violations,
    suitable: violations.length === 0,
  };
}

module.exports = { scoreSuitability, directionCorrectness, safeForbidden };
