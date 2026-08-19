'use strict';

/**
 * Repository-owned wrong-direction safety filter.
 *
 * This used to live behind an absolute machine-local require in sanitizer.js.
 * On any machine without that sibling checkout the sanitizer silently degraded
 * to a no-op, which meant a known masculinizing instruction could reach a
 * feminizing learner. This module intentionally owns the small runtime safety
 * surface inside the deployable repository.
 *
 * Scope is deliberately narrow: the current product has one live practice
 * direction (`feminizing`). Retired/unknown directions are no-ops rather than
 * being guessed. The filter removes only imperative/coaching statements that
 * clearly ask for a masculinizing change; descriptions, cautions and negated
 * examples are preserved.
 */

const FEMINIZING_DIRECTIONS = new Set(['feminizing', 'mtf']);

const CROSS_DIRECTION_PATTERNS = Object.freeze([
  // Explicit larynx / voice-box lowering. Cover both verb→body and body→verb
  // word orders because both occur in generated coaching prose.
  /\b(?:lower|drop)\b[^.!?]{0,36}\b(?:the\s+|your\s+)?(?:larynx|voice\s+box)\b/i,
  /\b(?:larynx|voice\s+box)\b[^.!?]{0,36}\b(?:lower|lowered|down|drop|settle\s+lower)\b/i,
  /\blet\b[^.!?]{0,24}\b(?:larynx|voice\s+box)\b[^.!?]{0,24}\b(?:settle|drop|ride)\b[^.!?]{0,12}\blower\b/i,

  // Explicitly adding/increasing vocal weight or asking for a heavier source.
  /\b(?:add|increase|bring\s+in|use|make)\b[^.!?]{0,28}\b(?:more\s+)?(?:vocal\s+)?weight\b/i,
  /\b(?:heavier|heavier-sounding|thicker)\b[^.!?]{0,20}\b(?:voice|tone|sound|vowels?)\b/i,

  // Explicit lower/deeper register instructions. Keep the acoustic object
  // syntactically close to the action: a broad wildcard here once made
  // "shoulders settle lower while the voice stays where it is" look like an
  // instruction to lower the voice.
  /\b(?:lower|drop|deepen)\s+(?:the\s+|your\s+)?(?:pitch|voice|tone|sound|register)\b/i,
  /\b(?:take|move|bring)\s+(?:the\s+|your\s+)?(?:pitch|voice|tone|sound|register)\s+(?:down|lower|deeper)\b/i,

  // Chest-placement instructions are retained here only for the historical
  // wrong-direction safety contract. Other sanitizer laws may independently
  // reject the wording for different reasons.
  /\b(?:add|use|bring|move|place|focus)\b[^.!?]{0,32}\bchest\s+resonance\b/i,
  /\b(?:move|place|send|bring)\b[^.!?]{0,24}\b(?:the\s+)?(?:voice|sound|resonance)\b[^.!?]{0,20}\b(?:into|to|in)\b[^.!?]{0,12}\b(?:the\s+|your\s+)?chest\b/i,
]);

const NEGATION_OR_CAUTION = /\b(?:do\s+not|don't|dont|never|avoid|without|not\s+to|rather\s+than|instead\s+of|shouldn't|should\s+not|wouldn't|would\s+not)\b/i;

function normalizeDirection(direction) {
  const value = String(direction || '').trim().toLowerCase();
  return FEMINIZING_DIRECTIONS.has(value) ? 'feminizing' : null;
}

function sentenceParts(text) {
  const value = String(text || '');
  if (!value.trim()) return [];
  // Preserve punctuation as part of each segment. This is intentionally not a
  // linguistic sentence tokenizer; coach replies are short (<=2 sentences) and
  // this avoids pulling a large dependency into a hard safety path.
  return value.match(/[^.!?]+[.!?]*/g) || [value];
}

function matchIsNegated(sentence, match) {
  if (!match || match.index == null) return false;
  // A negation/caution has to occur locally before the matched instruction.
  // Looking only at the local prefix prevents a previous sentence's "don't"
  // from suppressing a genuine later unsafe instruction.
  const prefixStart = Math.max(0, match.index - 48);
  const prefix = sentence.slice(prefixStart, match.index + Math.min(match[0].length, 12));
  return NEGATION_OR_CAUTION.test(prefix);
}

function crossDirectionReason(sentence, direction) {
  if (normalizeDirection(direction) !== 'feminizing') return null;
  const value = String(sentence || '');
  for (let index = 0; index < CROSS_DIRECTION_PATTERNS.length; index += 1) {
    const pattern = CROSS_DIRECTION_PATTERNS[index];
    const match = pattern.exec(value);
    if (!match) continue;
    if (matchIsNegated(value, match)) continue;
    return `feminizing_guard_${index + 1}`;
  }
  return null;
}

function stripCrossDirectionSentences(text, direction) {
  const original = String(text || '');
  if (!normalizeDirection(direction) || !original.trim()) {
    return { text: original, stripped: false, strippedCount: 0, reasons: [] };
  }

  const kept = [];
  const reasons = [];
  for (const part of sentenceParts(original)) {
    const sentence = part.trim();
    if (!sentence) continue;
    const reason = crossDirectionReason(sentence, direction);
    if (reason) {
      reasons.push(reason);
      continue;
    }
    kept.push(sentence);
  }

  return {
    text: kept.join(' ').trim(),
    stripped: reasons.length > 0,
    strippedCount: reasons.length,
    reasons,
  };
}

module.exports = {
  CROSS_DIRECTION_PATTERNS,
  crossDirectionReason,
  normalizeDirection,
  stripCrossDirectionSentences,
};
