'use strict';

const { assessSoundLanded, soundLandedBlocksAdvance } = require('./sound-landed');

const MAX_ELIGIBLE_ATTEMPTS = 4;
const MAX_CONSECUTIVE_NONLEXICAL = 2;
const MAX_TEXT_LENGTH = 240;

const PHASES = new Set(['acquire', 'stabilise', 'transfer']);
const NONLEXICAL_TAKE_KINDS = new Set([
  'hum_sovt',
  'resonance_play',
  'siren',
  'sustained',
  'trill',
]);
const USABLE_RESOLUTIONS = new Set(['measured_only', 'semantic_measured']);
const BRIDGE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'be',
  'is',
  'it',
  'of',
  'should',
  'the',
  'to',
  'was',
  'were',
]);

function normalizeText(value, maxLength = MAX_TEXT_LENGTH) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeCounter(value, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(maximum, Math.floor(numeric)));
}

function normalizeSentenceProgression(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const returnLineId = normalizeText(value.returnLineId, 120);
  const returnText = normalizeText(value.returnText);
  const cueFamilyId = normalizeText(value.cueFamilyId, 80);
  const cueText = normalizeText(value.cueText);
  if (!returnLineId || !returnText || !cueFamilyId || !cueText) return null;

  const phase = PHASES.has(value.phase) ? value.phase : 'acquire';
  // Phase is the state-machine authority. Canonicalizing its dependent fields
  // prevents a contradictory persisted object (for example acquire+sentence)
  // from skipping or extending the bounded scaffold.
  const expectedUnit = phase === 'acquire'
    ? 'nonlexical'
    : phase === 'stabilise'
      ? 'phrase'
      : 'sentence';
  const bridgeText = normalizeText(value.bridgeText) || buildBridgeText(returnText);

  return {
    phase,
    expectedUnit,
    returnLineId,
    returnText,
    bridgeText,
    cueFamilyId,
    cueText,
    eligibleAttemptCount: normalizeCounter(value.eligibleAttemptCount, MAX_ELIGIBLE_ATTEMPTS),
    consecutiveNonlexical: normalizeCounter(
      value.consecutiveNonlexical,
      MAX_CONSECUTIVE_NONLEXICAL,
    ),
    requiredTakeKind: phase === 'acquire' ? null : 'phrase',
    startedAt: Number.isFinite(Number(value.startedAt))
      ? Math.max(0, Math.round(Number(value.startedAt)))
      : Date.now(),
  };
}

function buildBridgeText(returnText) {
  const words = normalizeText(returnText)
    .replace(/[^\p{L}\p{N}'-]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const contentWords = words.filter((word) => !BRIDGE_STOP_WORDS.has(word.toLowerCase()));
  const selected = (contentWords.length >= 2 ? contentWords : words).slice(0, 3);
  return selected.join(' ');
}

function beginSentenceProgression({
  returnLineId,
  returnText,
  cueFamilyId,
  cueText,
  startedAt = Date.now(),
} = {}) {
  return normalizeSentenceProgression({
    phase: 'acquire',
    expectedUnit: 'nonlexical',
    returnLineId,
    returnText,
    bridgeText: buildBridgeText(returnText),
    cueFamilyId,
    cueText,
    eligibleAttemptCount: 0,
    consecutiveNonlexical: 0,
    requiredTakeKind: null,
    startedAt,
  });
}

function sentenceInstruction(progression) {
  return `${progression.cueText} through the whole sentence. Say: "${progression.returnText}"`;
}

function bridgeInstruction(progression) {
  return `${progression.cueText}. Say: "${progression.bridgeText}."`;
}

function hold(progression, {
  coachLine = null,
  lexicalAccuracy = 'unknown',
  transition = 'hold',
  // Present only on a 'sound_retry'; null everywhere else so the returned shape
  // stays fixed rather than gaining and losing a key. The field is a witness for
  // the caller's log line, not a control signal.
  soundLanded = null,
} = {}) {
  return {
    transition,
    progression,
    coachLine,
    completed: false,
    lexicalAccuracy,
    soundLanded,
  };
}

function words(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'-]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = left[row - 1] === right[column - 1]
        ? previous[column - 1]
        : 1 + Math.min(previous[column], current[column - 1], previous[column - 1]);
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function assessLexicalAccuracy(transcript, expectedText) {
  const actual = words(transcript);
  const expected = words(expectedText);
  if (!actual.length || !expected.length) return 'mismatch';
  const distance = editDistance(expected, actual);
  const allowedEdits = expected.length >= 5
    ? Math.max(1, Math.floor(expected.length * 0.2))
    : 0;
  return distance === 0 ? 'exact' : (distance <= allowedEdits ? 'close' : 'mismatch');
}

function resolveSentenceProgressionTurn({
  progression: rawProgression,
  takeKind,
  evidence = {},
} = {}) {
  const progression = normalizeSentenceProgression(rawProgression);
  if (!progression) return hold(null);

  const usable = evidence.safety === 'safe'
    && evidence.measurementUsable === true
    && USABLE_RESOLUTIONS.has(evidence.resolution);
  if (!usable) return hold(progression);

  // SOUND-RUNG VERIFICATION (2026-07-29). The word rungs are checked by
  // assessLexicalAccuracy below; the sound rung had no equivalent, so
  // `measurementUsable === true` — "a measurable take happened" — was the whole
  // gate. A learner asked to hum who spoke a sentence instead advanced exactly
  // as if the hum had landed. assessSoundLanded closes that, and only ever
  // BLOCKS on a positive contradiction: an absent metric returns 'unknown' and
  // passes, so a measurement gap is never scored as a performance failure.
  const onSoundRung = progression.expectedUnit === 'nonlexical';

  // (a) ACOUSTIC contradiction — the kind's own defining property is absent.
  // GATED ON THE RUNG. Without the gate a `trill` take arriving on a WORD rung
  // could be blocked by the acoustic check even when the learner spoke the
  // bridge correctly — and that state is reachable, which is why the fall-
  // through below already handles `nonlexical && expectedUnit !== 'nonlexical'`.
  const soundAssessment = onSoundRung
    ? assessSoundLanded({
      takeKind,
      kindMetrics: evidence.kindMetrics,
      bands: evidence.bands,
      target: evidence.target,
    })
    : { state: 'unknown', reason: 'not_on_sound_rung', evidence: null };

  // (b) THE LEARNER SPOKE THE LINE INSTEAD. Deliberately a MATCH test, not a
  // word count: ASR hallucinates confident text on non-speech audio, so a hum
  // can transcribe as a stock phrase. A hallucination will not match the
  // practice line; reading the line when asked to hum will. Same edit-distance
  // tolerance the word rungs use, so both halves of the ladder agree.
  const readTheLineInstead = onSoundRung
    && assessLexicalAccuracy(evidence.transcript, progression.returnText) !== 'mismatch';

  const eligibleAttemptCount = Math.min(
    MAX_ELIGIBLE_ATTEMPTS,
    progression.eligibleAttemptCount + 1,
  );

  // A blocked sound rung RETRIES — but it must never strand the learner. The
  // retry carries the INCREMENTED attempt count and stops holding once the
  // existing MAX_ELIGIBLE_ATTEMPTS bound is reached, so the scaffold falls
  // through to the sentence exactly as it does for every other stall. Without
  // that, a learner who genuinely cannot produce a lip trill — or any take the
  // detector misreads — would be locked on this rung with no exit but changing
  // the drill by hand. No new state is introduced; this reuses the bound the
  // ladder already enforces.
  if (soundLandedBlocksAdvance(soundAssessment) || readTheLineInstead) {
    if (eligibleAttemptCount < MAX_ELIGIBLE_ATTEMPTS) {
      return hold({ ...progression, eligibleAttemptCount }, {
        transition: 'sound_retry',
        lexicalAccuracy: 'unknown',
        soundLanded: readTheLineInstead
          ? { state: 'not_the_sound', reason: 'read_the_line_instead', evidence: null }
          : soundAssessment,
        coachLine: progression.cueText,
      });
    }
    // At the bound: fall through. The sentence is due regardless.
  }
  const nonlexical = NONLEXICAL_TAKE_KINDS.has(normalizeText(takeKind, 40));
  const expectedText = progression.expectedUnit === 'phrase'
    ? progression.bridgeText
    : progression.returnText;
  const lexicalAccuracy = nonlexical || progression.expectedUnit === 'nonlexical'
    ? 'unknown'
    : assessLexicalAccuracy(evidence.transcript, expectedText);
  if (lexicalAccuracy === 'mismatch') {
    return hold(progression, {
      transition: 'lexical_retry',
      lexicalAccuracy,
      coachLine: progression.expectedUnit === 'phrase'
        ? bridgeInstruction(progression)
        : sentenceInstruction(progression),
    });
  }

  if (progression.expectedUnit === 'sentence' && !nonlexical) {
    return {
      transition: 'sentence_attempt',
      progression: null,
      coachLine: null,
      completed: true,
      lexicalAccuracy,
    };
  }

  const atNonlexicalLimit = progression.consecutiveNonlexical >= MAX_CONSECUTIVE_NONLEXICAL;
  const sentenceDue = eligibleAttemptCount >= MAX_ELIGIBLE_ATTEMPTS;
  if (atNonlexicalLimit || sentenceDue || (nonlexical && progression.expectedUnit !== 'nonlexical')) {
    const next = {
      ...progression,
      phase: 'transfer',
      expectedUnit: 'sentence',
      eligibleAttemptCount,
      consecutiveNonlexical: nonlexical
        ? Math.min(
          MAX_CONSECUTIVE_NONLEXICAL,
          progression.consecutiveNonlexical + 1,
        )
        : progression.consecutiveNonlexical,
      requiredTakeKind: 'phrase',
    };
    return {
      transition: 'return_sentence',
      progression: next,
      coachLine: sentenceInstruction(next),
      completed: false,
      lexicalAccuracy: 'unknown',
    };
  }

  if (progression.expectedUnit === 'nonlexical' && nonlexical) {
    const next = {
      ...progression,
      phase: 'stabilise',
      expectedUnit: 'phrase',
      eligibleAttemptCount,
      consecutiveNonlexical: Math.min(
        MAX_CONSECUTIVE_NONLEXICAL,
        progression.consecutiveNonlexical + 1,
      ),
      requiredTakeKind: 'phrase',
    };
    return {
      transition: 'bridge',
      progression: next,
      coachLine: bridgeInstruction(next),
      completed: false,
      lexicalAccuracy: 'unknown',
    };
  }

  const next = {
    ...progression,
    phase: 'transfer',
    expectedUnit: 'sentence',
    eligibleAttemptCount,
    consecutiveNonlexical: 0,
    requiredTakeKind: 'phrase',
  };
  return {
    transition: 'return_sentence',
    progression: next,
    coachLine: sentenceInstruction(next),
    completed: false,
    lexicalAccuracy: 'unknown',
  };
}

module.exports = {
  MAX_CONSECUTIVE_NONLEXICAL,
  MAX_ELIGIBLE_ATTEMPTS,
  beginSentenceProgression,
  normalizeSentenceProgression,
  resolveSentenceProgressionTurn,
};
