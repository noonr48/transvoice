// Lesson surface — PracticeCard model (Wave B).
//
// The backend (P3) attaches `activeCard` / `replayDirective` / `cardOpsApplied`
// to session + coach payloads, but the shared VoiceUiState normalizer
// (state.ts) deliberately does NOT model them — they fall outside the
// VoiceBackendPayload slice contract. To keep the lesson surface self-contained
// (mirroring how api.ts types the P2 learner-memo fields locally), this module
// owns the PracticeCard shape + a defensive normalizer over the raw payload.
//
// Pure: no DOM, no state.ts coupling. Only the lesson layer consumes these.

export type VoiceCardFocusAxis = 'pitch' | 'resonance' | 'weight' | 'prosody';

export type VoiceCardFocus = {
  axis: VoiceCardFocusAxis | null;
  direction: string | null;
  statement: string | null;
};

// A card is either a normal practice drill or today's one-real-sentence
// (kind:'real_sentence', set active when the learner picks a sentence). The
// backend attaches `kind`; absent/unknown -> 'drill'. Behavior is otherwise
// identical (tokens, marks, replay) — `kind` only labels the slot's status copy.
export type VoiceCardKind = 'drill' | 'real_sentence';

// A token on the practice "paper strip". emphasis is a 0-3 LEVEL (number),
// distinct from the cue-sheet token's string `emphasis` tag in state.ts.
export type VoiceCardToken = {
  text: string;
  emphasis: number; // 0..3 clamped
  focusHint: string | null;
  startProgress: number | null; // 0..1
  endProgress: number | null; // 0..1
};

export type VoicePracticeCard = {
  id: string | null;
  phrase: string | null;
  focus: VoiceCardFocus;
  tokens: VoiceCardToken[];
  difficulty: 'easy' | 'medium' | 'hard' | null;
  source: 'tutor' | 'fallback' | null;
  kind: VoiceCardKind; // 'drill' (default) | 'real_sentence'
  revision: number;
  parentCardId: string | null;
};

export type VoiceReplayDirective = {
  attemptId: string;
  momentProgress: number | null; // 0..1
  reason: string | null;
};

const FOCUS_AXES: VoiceCardFocusAxis[] = ['pitch', 'resonance', 'weight', 'prosody'];

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function clamp01(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

function clampEmphasisLevel(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const rounded = Math.round(numeric);
  if (rounded < 0) return 0;
  if (rounded > 3) return 3;
  return rounded;
}

export function normalizeVoiceCardFocus(value: unknown): VoiceCardFocus {
  const record = (value && typeof value === 'object') ? value as Record<string, unknown> : {};
  const axisRaw = asTrimmedString(record.axis);
  const axis = axisRaw && (FOCUS_AXES as string[]).includes(axisRaw)
    ? axisRaw as VoiceCardFocusAxis
    : null;
  return {
    axis,
    direction: asTrimmedString(record.direction),
    statement: asTrimmedString(record.statement),
  };
}

function normalizeVoiceCardToken(value: unknown): VoiceCardToken | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const text = asTrimmedString(record.text);
  if (!text) return null;
  return {
    text,
    emphasis: clampEmphasisLevel(record.emphasis),
    focusHint: asTrimmedString(record.focusHint),
    startProgress: clamp01(record.startProgress),
    endProgress: clamp01(record.endProgress),
  };
}

/**
 * Normalize a raw `activeCard` payload object into a VoicePracticeCard.
 * Returns null when the value is not a usable card (no id and no tokens/phrase),
 * so callers can treat "no card" uniformly.
 */
export function normalizeVoicePracticeCard(value: unknown): VoicePracticeCard | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  const tokens = Array.isArray(record.tokens)
    ? (record.tokens.map(normalizeVoiceCardToken).filter(Boolean) as VoiceCardToken[])
    : [];
  const id = asTrimmedString(record.id);
  const phrase = asTrimmedString(record.phrase);

  // Nothing renderable -> not a card.
  if (!id && !phrase && tokens.length === 0) return null;

  const difficultyRaw = asTrimmedString(record.difficulty);
  const difficulty = difficultyRaw === 'easy' || difficultyRaw === 'medium' || difficultyRaw === 'hard'
    ? difficultyRaw
    : null;
  const sourceRaw = asTrimmedString(record.source);
  const source = sourceRaw === 'tutor' || sourceRaw === 'fallback' ? sourceRaw : null;

  const kindRaw = asTrimmedString(record.kind);
  const kind: VoiceCardKind = kindRaw === 'real_sentence' ? 'real_sentence' : 'drill';

  const revisionNumeric = Number(record.revision);
  const revision = Number.isFinite(revisionNumeric) && revisionNumeric > 0
    ? Math.round(revisionNumeric)
    : 1;

  return {
    id,
    phrase,
    focus: normalizeVoiceCardFocus(record.focus),
    tokens,
    difficulty,
    source,
    kind,
    revision,
    parentCardId: asTrimmedString(record.parentCardId),
  };
}

/**
 * Normalize a raw `replayDirective` ({ attemptId, momentProgress, reason } | null).
 * Returns null unless a non-empty attemptId is present.
 */
export function normalizeVoiceReplayDirective(value: unknown): VoiceReplayDirective | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const attemptId = asTrimmedString(record.attemptId);
  if (!attemptId) return null;
  return {
    attemptId,
    momentProgress: clamp01(record.momentProgress),
    reason: asTrimmedString(record.reason),
  };
}

/**
 * The one word the tutor should lean on when it demonstrates this line.
 *
 * Cards carry a 0-3 emphasis LEVEL per token (cue-sheet enum + LLM card-ops
 * overrides). Levels 0-1 are "normal speech" — only 2+ is an authored stress.
 * The demo speaks ONE word, so the rule is: the highest level at or above 2,
 * ties broken by the FIRST such token (earlier stress reads as the head of the
 * phrase). No qualifying token -> null, and the line is spoken unshaped.
 */
export type VoiceCardEmphasis = {
  word: string;
  /** Index into card.tokens — disambiguates a word that repeats in the line. */
  tokenIndex: number;
  level: number;
};

export const VOICE_CARD_EMPHASIS_MIN_LEVEL = 2;

const CARD_WORD_CHAR = /[\p{L}\p{N}'’-]/u;
const CARD_REGEXP_SPECIALS = /[.*+?^${}()|[\]\\]/g;

// Must match MAX_EMPHASIS_WORD_LENGTH in backend/voice-emphasis-shaping.js: the
// gateway truncates a longer word, and a truncated word resolves to a different
// occurrence set than the one counted here.
const MAX_EMPHASIS_WORD_LENGTH = 80;

/** Strip a card token down to its matchable core ("today." -> "today"). */
function emphasisCore(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && !CARD_WORD_CHAR.test(value[start])) start += 1;
  while (end > start && !CARD_WORD_CHAR.test(value[end - 1])) end -= 1;
  return value.slice(start, end).slice(0, MAX_EMPHASIS_WORD_LENGTH);
}

/**
 * Whole-word occurrence offsets of `word` in `text`, case-insensitive. Mirrors
 * findWordOccurrences in backend/voice-emphasis-shaping.js — the two must agree
 * on what "occurrence N" means, which is why both match against the ORIGINAL
 * string rather than a lowercased copy (some characters change length when
 * lowercased and silently shift every offset after them).
 */
function wholeWordOffsets(text: string, word: string): number[] {
  if (!text || !word) return [];
  let pattern: RegExp;
  try {
    pattern = new RegExp(word.replace(CARD_REGEXP_SPECIALS, (match) => `\\${match}`), 'gi');
  } catch {
    return [];
  }
  const offsets: number[] = [];
  let match = pattern.exec(text);
  while (match !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const before = start > 0 ? text[start - 1] : '';
    const after = end < text.length ? text[end] : '';
    if (!(before && CARD_WORD_CHAR.test(before)) && !(after && CARD_WORD_CHAR.test(after))) {
      offsets.push(start);
      pattern.lastIndex = end;
    } else {
      pattern.lastIndex = start + 1;
    }
    match = pattern.exec(text);
  }
  return offsets;
}

export function resolveVoiceCardEmphasis(card: VoicePracticeCard | null): VoiceCardEmphasis | null {
  const tokens = card?.tokens ?? [];
  let best: VoiceCardEmphasis | null = null;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const level = token?.emphasis ?? 0;
    if (level < VOICE_CARD_EMPHASIS_MIN_LEVEL) continue;
    const word = typeof token.text === 'string' ? emphasisCore(token.text.trim()) : '';
    if (!word) continue;
    // Strictly greater keeps the FIRST token on a tie.
    if (!best || level > best.level) {
      best = { word, tokenIndex: index, level };
    }
  }
  return best;
}

/**
 * The emphasis to send for ONE spoken utterance, counted against the EXACT text
 * being spoken.
 *
 * This exists because the demo does not always speak the bare phrase — the
 * eyes-free announcement says "New line: <phrase>. <focus>". A card TOKEN index
 * is meaningless against that string: it can land on a word in the prefix, or on
 * the wrong copy of a word the phrase repeats. So we translate the card token
 * into an OCCURRENCE ordinal within the spoken string, which is the only thing
 * the gateway can resolve unambiguously.
 *
 * Returns null rather than guessing whenever the phrase cannot be located in the
 * spoken text — a wrong stress is worse than none.
 */
export function resolveSpokenLineEmphasis(
  spokenText: string,
  card: VoicePracticeCard | null,
  options: { phraseOffset?: number } = {},
): { word: string; tokenIndex: number; occurrence: number } | null {
  const emphasis = resolveVoiceCardEmphasis(card);
  if (!emphasis || typeof spokenText !== 'string' || !spokenText) return null;

  const spokenOffsets = wholeWordOffsets(spokenText, emphasis.word);
  if (spokenOffsets.length === 0) return null;

  // How many copies of the word do EARLIER card tokens hold? Usually 0 or 1, but
  // a token is not guaranteed to be a single word (the LLM card-op `create` path
  // passes token text through verbatim), so count words, not whole tokens.
  const tokens = card?.tokens ?? [];
  let withinPhrase = 0;
  for (let index = 0; index < emphasis.tokenIndex; index += 1) {
    const text = typeof tokens[index]?.text === 'string' ? tokens[index].text : '';
    withinPhrase += wholeWordOffsets(text, emphasis.word).length;
  }

  const phrase = typeof card?.phrase === 'string' ? card.phrase : '';
  const phraseAt = resolvePhraseOffset(spokenText, phrase, options.phraseOffset);
  let occurrence: number;
  if (phraseAt >= 0) {
    // Occurrences sitting in whatever the utterance says BEFORE the phrase
    // (the "New line: " prefix) shift the ordinal.
    const beforePhrase = spokenOffsets.filter((offset) => offset < phraseAt).length;
    occurrence = beforePhrase + withinPhrase;
  } else if (spokenOffsets.length === 1) {
    // Phrase not locatable unambiguously, but the word is unambiguous anyway.
    occurrence = 0;
  } else {
    return null;
  }

  if (occurrence >= spokenOffsets.length) return null;
  return { word: emphasis.word, tokenIndex: emphasis.tokenIndex, occurrence };
}

/**
 * Where the practice phrase starts inside the spoken utterance, or -1 when that
 * cannot be established without guessing.
 *
 * A caller that BUILT the utterance knows the answer exactly and should pass
 * `phraseOffset`. Searching is the fallback, and it refuses when the phrase text
 * appears more than once: a short phrase can also occur inside the announcement
 * prefix (phrase "line" inside "New line: line."), and picking the first hit
 * there would stress a prefix word — the very failure this module exists to
 * prevent.
 */
function resolvePhraseOffset(
  spokenText: string,
  phrase: string,
  phraseOffset: number | undefined,
): number {
  if (!phrase) return -1;
  if (
    typeof phraseOffset === 'number'
    && Number.isInteger(phraseOffset)
    && phraseOffset >= 0
    && spokenText.startsWith(phrase, phraseOffset)
  ) {
    return phraseOffset;
  }
  const first = spokenText.indexOf(phrase);
  if (first < 0) return -1;
  return first === spokenText.lastIndexOf(phrase) ? first : -1;
}

/**
 * Identity for change detection: a card is "the same rendered card" when both
 * its id and revision match. A revision bump (same id) means the tutor adjusted
 * the card in place -> the surface pulses it.
 */
export function voiceCardIdentity(card: VoicePracticeCard | null): string {
  if (!card) return '';
  return `${card.id ?? 'anon'}@${card.revision}`;
}

export function voiceCardRevisionIncreased(
  previous: VoicePracticeCard | null,
  next: VoicePracticeCard | null,
): boolean {
  if (!previous || !next) return false;
  // Same card id, higher revision => an in-place tutor adjustment.
  const samePhraseCard = (previous.id ?? null) === (next.id ?? null)
    || (previous.id != null && next.parentCardId === previous.id);
  return samePhraseCard && next.revision > previous.revision;
}

/**
 * The accent color CSS custom-property value for a focus axis. Calm,
 * design-token-aligned hues; resonance reuses the amber reference accent,
 * pitch the cyan accent, weight the green, prosody a soft violet.
 */
export function voiceCardFocusAccentVar(axis: VoiceCardFocusAxis | null): string {
  switch (axis) {
    case 'pitch':
      return 'var(--vt-accent)';
    case 'resonance':
      return 'var(--vt-yellow)';
    case 'weight':
      return 'var(--vt-green)';
    case 'prosody':
      return 'var(--vt-lesson-prosody, #b9a7d0)';
    default:
      return 'var(--vt-accent)';
  }
}
