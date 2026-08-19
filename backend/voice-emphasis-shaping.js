'use strict';

// Word-emphasis channel — gateway clause shaping.
//
// VoxCPM (:8020) exposes NO prosody/emphasis API: its request body is
// { target_text, speakingRate [, reference_audio_path] } and `speakingRate` is a
// post-hoc ffmpeg atempo pass. Worse, the engine's vendored normalizer
// (voxcpm/utils/text_normalize.py) SILENTLY DELETES any `<tag>` and speaks
// asterisks as literal junk, so SSML and markdown are both dead ends.
//
// PUNCTUATION is therefore the only emphasis-bearing signal that survives to
// the acoustic model. This module shapes the target text so the emphasized word
// sits in its own short comma-delimited clause — the engine renders a clause
// boundary as a micro-pause plus a fresh pitch reset, which is what "stress this
// word" sounds like.
//
// HARD CONTRACT (relied on by the caller and asserted in the tests):
//   * ONLY commas are ever added. The word sequence, its order, and every
//     original character are preserved verbatim. Nothing is duplicated, dropped,
//     re-cased, or re-ordered.
//   * Never emits SSML or markdown.
//   * The result is <= maxLength; a shaping that would breach the cap is
//     abandoned in favour of the untouched original (which is already capped).
//
// Pure: no I/O, no logging, no config. The gateway owns the witness line.

const MAX_EMPHASIS_SHAPED_LENGTH = 700;
const MAX_EMPHASIS_WORD_LENGTH = 80;

// A clause already "ends" (or "opens") at any of these, so a word touching one
// needs no comma on that side. Dashes and the ellipsis count because VoxCPM also
// renders them as a pause; brackets and quotes count because a comma jammed
// against one produces junk like "(,steady" in the engine's input.
// Apostrophes are deliberately absent — they are word characters here.
const CLAUSE_BOUNDARY_CHARS = new Set([
  ',', '.', ';', ':', '!', '?', '—', '–', '…',
  '(', ')', '[', ']', '{', '}', '"', '“', '”',
]);

const WORD_CHAR = /[\p{L}\p{N}'’-]/u;

const REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

function escapeRegExp(value) {
  return value.replace(REGEXP_SPECIALS, (match) => `\\${match}`);
}

function isWordChar(char) {
  return typeof char === 'string' && char.length > 0 && WORD_CHAR.test(char);
}

function isSpace(char) {
  return typeof char === 'string' && char.length > 0 && /\s/.test(char);
}

/**
 * Trim an emphasis word down to its matchable core: surrounding punctuation is
 * dropped (card tokens routinely carry a trailing "." or ","), the rest is left
 * exactly as authored so the caller's casing is never a match criterion.
 */
function normalizeEmphasisWord(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  let start = 0;
  let end = raw.length;
  while (start < end && !isWordChar(raw[start])) start += 1;
  while (end > start && !isWordChar(raw[end - 1])) end -= 1;
  return raw.slice(start, end).slice(0, MAX_EMPHASIS_WORD_LENGTH);
}

/**
 * Whitespace-delimited token spans with their surrounding punctuation stripped,
 * so span N lines up with practice-card token N (the card is authored from the
 * same phrase text).
 */
function wordTokenSpans(text) {
  const spans = [];
  const pattern = /\S+/g;
  let match = pattern.exec(text);
  while (match !== null) {
    let start = match.index;
    let end = match.index + match[0].length;
    while (start < end && !isWordChar(text[start])) start += 1;
    while (end > start && !isWordChar(text[end - 1])) end -= 1;
    if (end > start) spans.push({ start, end });
    match = pattern.exec(text);
  }
  return spans;
}

/**
 * Every case-insensitive whole-word occurrence of `word`, in text order.
 *
 * Matching runs against the ORIGINAL string, never a lowercased copy: some
 * characters change LENGTH under toLowerCase (Turkish 'İ' becomes two code
 * units), which silently shifts every offset after them — that desync produced
 * stacked commas and phantom "not found" results.
 */
function findWordOccurrences(text, word) {
  const occurrences = [];
  if (!word) return occurrences;
  let pattern;
  try {
    pattern = new RegExp(escapeRegExp(word), 'gi');
  } catch {
    return occurrences;
  }
  let match = pattern.exec(text);
  while (match !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const before = start > 0 ? text[start - 1] : '';
    const after = end < text.length ? text[end] : '';
    if (!isWordChar(before) && !isWordChar(after)) {
      occurrences.push({ start, end });
      pattern.lastIndex = end;
    } else {
      pattern.lastIndex = start + 1;
    }
    match = pattern.exec(text);
  }
  return occurrences;
}

/**
 * Where a comma belongs on the word's LEFT edge, or null when the word already
 * sits against a clause edge there (start-of-text counts as an edge).
 */
function leftCommaOffset(text, start) {
  let index = start - 1;
  while (index >= 0 && isSpace(text[index])) index -= 1;
  if (index < 0) return null; // start of text -> already bounded
  if (CLAUSE_BOUNDARY_CHARS.has(text[index])) return null; // already bounded
  return index + 1; // tight against the preceding word: "you, today"
}

/** Mirror of leftCommaOffset for the right edge; end-of-text counts as an edge. */
function rightCommaOffset(text, end) {
  let index = end;
  while (index < text.length && isSpace(text[index])) index += 1;
  if (index >= text.length) return null; // end of text -> already bounded
  if (CLAUSE_BOUNDARY_CHARS.has(text[index])) return null; // already bounded
  return end; // tight against the emphasized word: "today, for you"
}

function asIndex(value) {
  // `Number(null)`/`Number('')`/`Number(false)`/`Number([])` are all 0, which
  // would silently become "token 0". Only a real number counts.
  if (typeof value !== 'number') return null;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Rewrite `text` so `emphasisWord` sits in its own comma-delimited clause.
 *
 * SELECTOR PRECEDENCE — which occurrence gets stressed:
 *   1. `occurrence` — an index into the whole-word occurrences of the word IN
 *      THIS TEXT. This is the only selector that is safe when the caller speaks
 *      something other than the bare practice phrase (the eyes-free demo says
 *      "New line: <phrase>. <focus>"), because it is counted against the exact
 *      string being sent. Out of range -> nothing is shaped; we do not guess.
 *   2. `tokenIndex` — a whitespace-token ordinal, valid only when the caller's
 *      text IS the card phrase. It is honoured only if that token actually
 *      holds the word AND that position is a real occurrence.
 *   3. first occurrence.
 *
 * @param {object} input
 * @param {string} input.text            The phrase to speak.
 * @param {string} input.emphasisWord    The word to stress.
 * @param {number|null} [input.occurrence] 0-based whole-word occurrence index.
 * @param {number|null} [input.tokenIndex] Whitespace-token ordinal (legacy).
 * @param {number} [input.maxLength]     Hard cap on the returned text.
 * @returns {{text: string, matched: boolean, shaped: boolean, reason: string,
 *            selector: string, occurrenceUsed: number|null,
 *            occurrenceCount: number}}
 *   `text` is always safe to synthesize: either the shaped phrase or the
 *   untouched original. `matched` is false only when the word is absent.
 */
function shapeEmphasisClause(input = {}) {
  const text = typeof input.text === 'string' ? input.text : '';
  const maxLength = Number.isInteger(input.maxLength) && input.maxLength > 0
    ? input.maxLength
    : MAX_EMPHASIS_SHAPED_LENGTH;
  const word = normalizeEmphasisWord(input.emphasisWord);
  const occurrence = asIndex(input.occurrence);
  const tokenIndex = asIndex(input.tokenIndex);

  const result = (fields) => ({
    text,
    matched: false,
    shaped: false,
    selector: 'none',
    occurrenceUsed: null,
    occurrenceCount: 0,
    ...fields,
  });

  if (!text) return result({ reason: 'empty_text' });
  if (!word) return result({ reason: 'empty_word' });

  const occurrences = findWordOccurrences(text, word);
  if (occurrences.length === 0) return result({ reason: 'not_found' });

  let chosen = null;
  let selector = 'first';
  if (occurrence !== null) {
    if (occurrence >= occurrences.length) {
      // The caller named an occurrence this text does not have — their string
      // and ours disagree. Stressing a different word would be worse than none.
      return result({
        matched: true,
        reason: 'occurrence_out_of_range',
        selector: 'occurrence',
        occurrenceCount: occurrences.length,
      });
    }
    chosen = occurrence;
    selector = 'occurrence';
  } else if (tokenIndex !== null) {
    const candidate = wordTokenSpans(text)[tokenIndex];
    const at = candidate
      ? occurrences.findIndex((span) => span.start === candidate.start && span.end === candidate.end)
      : -1;
    if (at >= 0) {
      chosen = at;
      selector = 'token_index';
    }
  }
  if (chosen === null) chosen = 0;

  const span = occurrences[chosen];
  const common = {
    matched: true,
    selector,
    occurrenceUsed: chosen,
    occurrenceCount: occurrences.length,
  };

  const leftOffset = leftCommaOffset(text, span.start);
  const rightOffset = rightCommaOffset(text, span.end);
  if (leftOffset === null && rightOffset === null) {
    // Already its own clause — adding anything here would only stack commas.
    return result({ ...common, reason: 'already_bounded' });
  }

  // Apply the higher offset first so the lower one stays valid.
  let shapedText = text;
  for (const at of [rightOffset, leftOffset].filter((value) => value !== null)) {
    shapedText = `${shapedText.slice(0, at)},${shapedText.slice(at)}`;
  }

  if (shapedText.length > maxLength) {
    // Truncating would drop words, which the caller's contract forbids. The
    // original is already within the cap, so fall back to it untouched.
    return result({ ...common, reason: 'length_cap' });
  }

  return result({ ...common, text: shapedText, shaped: true, reason: 'shaped' });
}

module.exports = {
  MAX_EMPHASIS_SHAPED_LENGTH,
  shapeEmphasisClause,
  normalizeEmphasisWord,
};
