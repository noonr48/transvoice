'use strict';

/**
 * PracticeCardStore — per-session "strip of words on paper" card state.
 *
 * A PracticeCard is the lesson unit (see docs/LESSON-EXPERIENCE-DESIGN.md):
 * token-rendered phrase whose typography carries the focus. The tutor (or the
 * deterministic fallback) authors cards; the cue-sheet tokenizer builds the
 * per-word tokens (text + emphasis 0-3 + focusHint). Every modification bumps
 * `revision` and links `parentCardId` so the UI can show a "coach adjusted this
 * card" pulse and the lineage is auditable.
 *
 * Persistence mirrors lesson-planner.js: purely in-memory, keyed by sessionId.
 * The runtime owns one store per process; cards are ephemeral session state and
 * (like LessonState) are not flushed to disk here.
 *
 * Contract (PracticeCard):
 *   {
 *     id, phrase,
 *     focus: { axis: 'pitch|resonance|weight|prosody', direction, statement },
 *     tokens: [ { text, emphasis: 0-3, focusHint } ],
 *     difficulty: 'easy|medium|hard',
 *     kind: 'drill|real_sentence',       // default 'drill' (V1.5 one-real-sentence)
 *     source: 'tutor|fallback', revision: 1, parentCardId: null
 *   }
 *
 * `kind` distinguishes an ordinary practice drill from a "one real sentence a day"
 * card (the sentence the person will actually say in the world). Behavior is
 * otherwise identical (tokens, marks, replay); the kind only lets the lesson layer
 * route the card to the real-sentence flow.
 */

const { buildVoiceCueSheet, PRESET_PROFILES } = require('../voice-cue-sheet');
const { getVoiceDrillPack } = require('../voice-drills');

// Focus axes the card layer speaks in. Distinct from the signal-schema FOCUS_AXES
// (which are fine-grained coaching foci); here it is the card's emphasis axis, and
// matches the design-doc PracticeCard.focus.axis enum exactly.
const CARD_FOCUS_AXES = ['pitch', 'resonance', 'weight', 'prosody'];

const DIFFICULTIES = ['easy', 'medium', 'hard'];

// Card kind: an ordinary drill, or a "one real sentence a day" card (V1.5 §1).
const CARD_KINDS = ['drill', 'real_sentence'];

// Who authored the card. 'section-loop' (2026-07-26 phase C) is the sentence-teardown
// isolation loop: the card is the 1-3 word fragment the coach is drilling right now,
// not a phrase either the tutor or the fallback pack chose.
//
// It is a BACKEND provenance tag, and it deliberately does not cross to the UI: the
// frontend card normalizer keeps only 'tutor'/'fallback' and maps anything else to
// null (frontend/src/voice/lesson/card.ts). Two consequences, both wanted — the strip
// renders the fragment exactly as it renders any card, and the auto-speak path that
// fires on source==='fallback' (voice/lesson/controller.ts) stays quiet, because the
// coach's own entry line already says the fragment out loud.
const CARD_SOURCES = ['tutor', 'fallback', 'section-loop'];

const MAX_EMPHASIS = 3;
const MIN_EMPHASIS = 0;
const MAX_PHRASE_LEN = 120;

// The cue-sheet emits a small enum of per-token emphasis labels. Map those to the
// card's numeric 0-3 emphasis so the UI can size/weight/underline each word.
const CUE_EMPHASIS_TO_LEVEL = {
  'lift-ending': 3,
  'light-start': 2,
  'keep-bright': 2,
  steady: 1,
};

function clampEmphasis(value, fallback = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(MIN_EMPHASIS, Math.min(MAX_EMPHASIS, Math.round(num)));
}

function normalizeAxis(axis, fallback = 'resonance') {
  const value = typeof axis === 'string' ? axis.trim().toLowerCase() : '';
  return CARD_FOCUS_AXES.includes(value) ? value : fallback;
}

function normalizeDifficulty(value, fallback = 'easy') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return DIFFICULTIES.includes(normalized) ? normalized : fallback;
}

function normalizeKind(value, fallback = 'drill') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CARD_KINDS.includes(normalized) ? normalized : fallback;
}

/**
 * Normalize the card's authoring source. Unknown values fall back to 'tutor', which
 * preserves the pre-2026-07-26 behaviour exactly: the old code was
 * `source === 'fallback' ? 'fallback' : 'tutor'`.
 */
function normalizeSource(value, fallback = 'tutor') {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return CARD_SOURCES.includes(normalized) ? normalized : fallback;
}

function clipPhrase(phrase) {
  return String(phrase || '').replace(/\s+/g, ' ').trim().slice(0, MAX_PHRASE_LEN);
}

/**
 * Infer a card focus axis from a free-text drill `focus`/`tags` hint.
 * Deterministic, total — always returns a valid axis.
 */
function inferAxisFromFocus(focusText = '', tags = []) {
  const text = `${focusText || ''} ${(Array.isArray(tags) ? tags.join(' ') : '')}`.toLowerCase();
  if (/\b(pitch|higher|lower|range|semitone|anchor|floor)\b/.test(text)) return 'pitch';
  if (/\b(weight|heavy|light|chest|mass|onset|pressed)\b/.test(text)) return 'weight';
  if (/\b(intonation|question|lift|rise|melod|contour|prosod|ending|arc)\b/.test(text)) return 'prosody';
  // resonance is the most common voice-feminization focus; use it as the default.
  return 'resonance';
}

// Direction is the preset's target direction (voice-cue-sheet PRESET_PROFILES),
// NOT the card's free-text focus.direction. Since 2026-07-30 every live preset is
// 'feminine' — the two neutral presets were retired with the MTF-only narrowing,
// so the neutral statement block went with them. The function is KEPT rather than
// inlined: it is the single place this question is answered, and an unrecognised
// preset must still get a defined answer.
function resolveTargetDirection(targetPreset) {
  const profile = PRESET_PROFILES[String(targetPreset || '').trim()];
  return profile && ['feminine', 'neutral'].includes(profile.direction)
    ? profile.direction
    : 'feminine';
}

const FOCUS_STATEMENTS_BY_DIRECTION = {
  feminine: {
    pitch: 'Today: keep the pitch settled and steady',
    resonance: 'Today: tongue sides on the upper back teeth',
    weight: 'Today: make the buzz under your palm weaker, not quieter',
    prosody: 'Today: let the phrase lift and stay alive',
    fallback: 'Today: keep the jaw loose and the tongue forward',
  },
};

function buildFocusStatement(axis, focusText = '', targetPreset = 'cute-feminine') {
  const trimmed = String(focusText || '').trim();
  if (trimmed) return `Today: ${trimmed}`;
  const direction = resolveTargetDirection(targetPreset);
  const byAxis = FOCUS_STATEMENTS_BY_DIRECTION[direction] || FOCUS_STATEMENTS_BY_DIRECTION.feminine;
  return byAxis[axis] || byAxis.fallback;
}

/**
 * Build a focus block { axis, direction, statement } from loose inputs.
 * `targetPreset` selects the direction lane for the default statement; the
 * block's `direction` field stays the free-text coaching direction as before.
 */
function buildFocus({ axis, direction, statement, focusText, tags, targetPreset = 'cute-feminine' } = {}) {
  const resolvedAxis = axis ? normalizeAxis(axis) : inferAxisFromFocus(focusText, tags);
  return {
    axis: resolvedAxis,
    direction: typeof direction === 'string' && direction.trim()
      ? direction.trim().slice(0, 80)
      : (focusText ? String(focusText).trim().slice(0, 80) : ''),
    statement: typeof statement === 'string' && statement.trim()
      ? `Today: ${statement.trim().replace(/^today:\s*/i, '')}`.slice(0, 120)
      : buildFocusStatement(resolvedAxis, focusText, targetPreset),
  };
}

/**
 * Build the token array for a phrase via the existing cue-sheet tokenizer,
 * carrying emphasis 0-3 (mapped from cue-sheet emphasis labels, default 1) and a
 * focusHint (the cue-sheet per-token expression/teaching note).
 *
 * `emphasisOverrides` is an optional Map/object of lowercased-word -> level.
 * Never throws — returns a one-token-per-word fallback if the cue-sheet declines.
 */
function buildCardTokens(phrase, { targetPreset = 'cute-feminine', focusText = '', emphasisOverrides = null } = {}) {
  const cleanPhrase = clipPhrase(phrase);
  if (!cleanPhrase) return [];

  const overrides = emphasisOverrides instanceof Map
    ? emphasisOverrides
    : new Map(Object.entries(emphasisOverrides || {}).map(([k, v]) => [String(k).toLowerCase(), v]));

  let sheet = null;
  try {
    sheet = buildVoiceCueSheet({ phrase: cleanPhrase, targetPreset, focus: focusText });
  } catch {
    sheet = null;
  }

  if (sheet && Array.isArray(sheet.tokens) && sheet.tokens.length > 0) {
    return sheet.tokens.map((token) => {
      const word = String(token.text || '');
      const overrideKey = word.toLowerCase();
      const baseLevel = CUE_EMPHASIS_TO_LEVEL[token.emphasis] ?? 1;
      const level = overrides.has(overrideKey)
        ? clampEmphasis(overrides.get(overrideKey), baseLevel)
        : baseLevel;
      return {
        text: word,
        emphasis: level,
        focusHint: typeof token.expressionCue === 'string' && token.expressionCue
          ? token.expressionCue
          : (typeof token.note === 'string' ? token.note : ''),
      };
    });
  }

  // Cue-sheet declined (e.g. punctuation-only) — degrade to bare word tokens so
  // the card is never empty.
  return cleanPhrase.split(/\s+/).filter(Boolean).map((word) => {
    const overrideKey = word.toLowerCase();
    return {
      text: word,
      emphasis: overrides.has(overrideKey) ? clampEmphasis(overrides.get(overrideKey), 1) : 1,
      focusHint: '',
    };
  });
}

let cardCounter = 0;
function nextCardId() {
  cardCounter += 1;
  const rand = Math.random().toString(16).slice(2, 8);
  return `card_${Date.now().toString(36)}_${cardCounter.toString(36)}_${rand}`;
}

/**
 * Create a PracticeCard object (pure — does not store).
 * tokens default-built via the cue-sheet; emphasis carried 0-3.
 */
function createCard({
  phrase,
  focus = null,
  difficulty = 'easy',
  source = 'tutor',
  tokens = null,
  targetPreset = 'cute-feminine',
  parentCardId = null,
  revision = 1,
  id = null,
  kind = 'drill',
} = {}) {
  const cleanPhrase = clipPhrase(phrase);
  const focusText = (focus && typeof focus === 'object' && (focus.direction || focus.statement))
    || (typeof focus === 'string' ? focus : '');

  const focusBlock = focus && typeof focus === 'object'
    ? buildFocus({ axis: focus.axis, direction: focus.direction, statement: focus.statement, focusText: focus.direction, targetPreset })
    : buildFocus({ focusText: typeof focus === 'string' ? focus : '', targetPreset });

  const resolvedTokens = Array.isArray(tokens) && tokens.length > 0
    ? tokens.map((token) => ({
        text: String(token.text || ''),
        emphasis: clampEmphasis(token.emphasis, 1),
        focusHint: typeof token.focusHint === 'string' ? token.focusHint : '',
      }))
    : buildCardTokens(cleanPhrase, { targetPreset, focusText: focusBlock.direction });

  return {
    id: id || nextCardId(),
    phrase: cleanPhrase,
    focus: focusBlock,
    tokens: resolvedTokens,
    difficulty: normalizeDifficulty(difficulty),
    kind: normalizeKind(kind),
    source: normalizeSource(source),
    revision: Number.isInteger(revision) && revision > 0 ? revision : 1,
    parentCardId: parentCardId || null,
  };
}

/**
 * Find a shorter fallback phrase for the same focus, for the `simplify` op and the
 * difficulty floor. Deterministic — prefers the easiest, shortest drill phrase in
 * the pack whose focus axis matches; falls back to truncating the current phrase.
 */
function findSimplerPhrase(currentPhrase, axis, targetPreset) {
  const pack = getVoiceDrillPack(targetPreset);
  const currentWords = String(currentPhrase || '').split(/\s+/).filter(Boolean).length;

  const candidates = pack
    .map((drill) => ({
      phrase: clipPhrase(drill.phrase),
      words: clipPhrase(drill.phrase).split(/\s+/).filter(Boolean).length,
      axis: inferAxisFromFocus(drill.focus, drill.tags),
      difficulty: drill.difficulty || 'medium',
    }))
    .filter((c) => c.phrase && c.phrase !== currentPhrase && c.words >= 2)
    // Shorter than the current phrase, same axis preferred, easy preferred.
    .sort((a, b) => {
      const aAxisMatch = a.axis === axis ? 0 : 1;
      const bAxisMatch = b.axis === axis ? 0 : 1;
      if (aAxisMatch !== bAxisMatch) return aAxisMatch - bAxisMatch;
      const aEasy = a.difficulty === 'easy' ? 0 : 1;
      const bEasy = b.difficulty === 'easy' ? 0 : 1;
      if (aEasy !== bEasy) return aEasy - bEasy;
      return a.words - b.words;
    });

  const shorter = candidates.find((c) => c.words < currentWords) || candidates[0];
  if (shorter) return shorter.phrase;

  // No pack candidate: truncate to the first few words of the current phrase.
  const words = String(currentPhrase || '').split(/\s+/).filter(Boolean);
  if (words.length > 3) return words.slice(0, 3).join(' ');
  return currentPhrase;
}

class PracticeCardStore {
  constructor() {
    // sessionId -> { active: PracticeCard|null, fallbackCursor: int }
    this._bySession = new Map();
  }

  _ensure(sessionId) {
    const key = String(sessionId || '');
    let entry = this._bySession.get(key);
    if (!entry) {
      // `stashed` (2026-07-26 phase C) holds the whole-sentence card while the
      // sentence-teardown loop has the fragment on screen. It lives HERE rather than
      // on voiceState on purpose: a whole card object inside the persisted voice
      // state would need its own normalizer and would bloat every session payload,
      // whereas cards are already ephemeral per-session runtime state.
      entry = { active: null, fallbackCursor: 0, stashed: null };
      this._bySession.set(key, entry);
    }
    if (!Object.prototype.hasOwnProperty.call(entry, 'stashed')) entry.stashed = null;
    if (!Object.prototype.hasOwnProperty.call(entry, 'loopCardTakenOver')) entry.loopCardTakenOver = false;
    return entry;
  }

  /**
   * THE ONE PLACE THE ACTIVE CARD CHANGES — and therefore the one place a
   * sentence-teardown TAKEOVER can be detected.
   *
   * A takeover is: a card that is NOT the isolation loop's replacing one that IS.
   * When the model emits a `create` or `advance` op mid-isolation, or a route
   * authors a new card (the "one real sentence" pick), the fragment the coach is
   * drilling leaves the screen while the loop is still running — so the coach spends
   * up to three attempts on words the learner cannot see. That is the half-performed
   * isolation the entry guard refuses to CREATE, reached from the other side.
   *
   * WHY A MARKER RATHER THAN INFERRING FROM `activeCard.source`. Reading ownership as
   * `active.source === 'section-loop'` conflates two different states: "something
   * replaced our card" (a takeover) and "our card is not there at all" (state drift
   * — a loop restored without its card, a fixture that set loop state without
   * authoring one). Only the first is a takeover, and the naive read false-positives
   * on the second, which would close every loop whose card store is merely out of
   * step. Measured: it closed the loop on the routine post-take turn. The store knows
   * exactly when a replacement happens, so it says so explicitly.
   *
   * Every ops branch routes through here, so a future op cannot silently bypass the
   * detection. Ops that EDIT the fragment (emphasize / swap_phrase / simplify) carry
   * `source` forward and correctly do not trigger it.
   */
  _replaceActive(entry, card) {
    if (entry.active?.source === 'section-loop' && card?.source !== 'section-loop') {
      entry.loopCardTakenOver = true;
    }
    entry.active = card;
    return card;
  }

  /**
   * Create + store a card for a session, returning the stored card.
   * Accepts the same shape as createCard().
   */
  createCard(sessionId, spec = {}) {
    const entry = this._ensure(sessionId);
    const card = createCard(spec);
    this._replaceActive(entry, card);
    return card;
  }

  getActiveCard(sessionId) {
    const entry = this._bySession.get(String(sessionId || ''));
    return entry ? entry.active : null;
  }

  /**
   * Replace the active card directly (used by fallback advance). Returns it.
   */
  setActiveCard(sessionId, card) {
    const entry = this._ensure(sessionId);
    this._replaceActive(entry, card);
    return card;
  }

  /**
   * Apply an ordered list of card ops to the active card.
   *
   * Supported ops (validated upstream by coaching/card-ops.js, but re-guarded here):
   *   { op: 'create', card: {...} | phrase, ... }
   *   { op: 'emphasize', token: 'word', level: 0-3 }
   *   { op: 'swap_phrase', phrase: '...' }
   *   { op: 'simplify' }                       -> shorter fallback phrase, same focus
   *   { op: 'advance' }                        -> next fallback card
   *
   * Every mutation that changes the card produces a NEW card object with
   * revision bumped and parentCardId linked to the prior card. Never throws.
   * Returns { card, applied, ops } — `applied` = count of ops that changed state.
   */
  applyCardOps(sessionId, ops = [], context = {}) {
    const entry = this._ensure(sessionId);
    const list = Array.isArray(ops) ? ops : [];
    let applied = 0;
    const targetPreset = context.targetPreset || 'cute-feminine';

    for (const rawOp of list) {
      if (!rawOp || typeof rawOp !== 'object') continue;
      const op = String(rawOp.op || '');

      try {
        if (op === 'create') {
          const spec = (rawOp.card && typeof rawOp.card === 'object') ? rawOp.card : rawOp;
          const phrase = clipPhrase(spec.phrase);
          if (!phrase) continue;
          const prev = entry.active;
          this._replaceActive(entry, createCard({
            phrase,
            focus: spec.focus || (context.focus ? { direction: context.focus } : null),
            difficulty: spec.difficulty || 'easy',
            source: 'tutor',
            tokens: Array.isArray(spec.tokens) ? spec.tokens : null,
            targetPreset,
            parentCardId: prev ? prev.id : null,
            revision: prev ? prev.revision + 1 : 1,
          }));
          applied += 1;
          continue;
        }

        // The remaining ops mutate an existing card; if none exists, bootstrap one
        // from the fallback so the lesson never stalls.
        if (!entry.active) {
          this._replaceActive(entry, this._buildFallbackCard(sessionId, {
            targetPreset,
            focus: context.focus,
            topics: context.topics,
          }));
        }
        const current = entry.active;

        if (op === 'emphasize') {
          const tokenWord = String(rawOp.token || '').trim().toLowerCase();
          const level = clampEmphasis(rawOp.level, null);
          if (!tokenWord || !Number.isFinite(Number(rawOp.level))) continue;
          let changed = false;
          const nextTokens = current.tokens.map((token) => {
            if (String(token.text || '').toLowerCase() === tokenWord) {
              changed = true;
              return { ...token, emphasis: level };
            }
            return token;
          });
          if (!changed) continue;
          this._replaceActive(entry, {
            ...current,
            tokens: nextTokens,
            revision: current.revision + 1,
            parentCardId: current.id,
            id: nextCardId(),
          });
          applied += 1;
          continue;
        }

        if (op === 'swap_phrase') {
          const phrase = clipPhrase(rawOp.phrase);
          if (!phrase || phrase === current.phrase) continue;
          entry.active = createCard({
            phrase,
            focus: current.focus,
            difficulty: current.difficulty,
            source: current.source,
            targetPreset,
            parentCardId: current.id,
            revision: current.revision + 1,
            kind: current.kind,
          });
          applied += 1;
          continue;
        }

        if (op === 'simplify') {
          const simpler = findSimplerPhrase(current.phrase, current.focus.axis, targetPreset);
          if (!simpler || simpler === current.phrase) continue;
          entry.active = createCard({
            phrase: simpler,
            focus: current.focus,
            difficulty: 'easy',
            source: current.source,
            targetPreset,
            parentCardId: current.id,
            revision: current.revision + 1,
            kind: current.kind,
          });
          applied += 1;
          continue;
        }

        if (op === 'advance') {
          const next = this._buildFallbackCard(sessionId, {
            targetPreset,
            focus: context.focus,
            topics: context.topics,
          });
          next.parentCardId = current.id;
          next.revision = current.revision + 1;
          this._replaceActive(entry, next);
          applied += 1;
          continue;
        }
      } catch {
        // A single malformed op must never crash the batch — skip it.
        continue;
      }
    }

    return { card: entry.active, applied, ops: list };
  }

  /**
   * Build (but do not necessarily store) a deterministic fallback card from the
   * drill packs, honoring `focus` and — when `topics` are provided — preferring a
   * phrase that mentions a topic word. Advances the per-session cursor so repeated
   * calls cycle through the pack. Never throws; always returns a card.
   */
  _buildFallbackCard(sessionId, { targetPreset = 'cute-feminine', focus = null, topics = null } = {}) {
    const entry = this._ensure(sessionId);
    const pack = getVoiceDrillPack(targetPreset);
    const safePack = pack.length > 0 ? pack : getVoiceDrillPack('cute-feminine');

    const focusAxis = focus ? inferAxisFromFocus(typeof focus === 'string' ? focus : focus.direction || focus.axis || '') : null;
    const topicWords = Array.isArray(topics)
      ? topics.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean)
      : [];

    // Score the pack: focus-axis match + topic mention, then fall back to cursor order.
    const scored = safePack.map((drill, index) => {
      let score = 0;
      const drillAxis = inferAxisFromFocus(drill.focus, drill.tags);
      if (focusAxis && drillAxis === focusAxis) score += 2;
      if (topicWords.length > 0) {
        const phraseLower = String(drill.phrase || '').toLowerCase();
        if (topicWords.some((word) => word && phraseLower.includes(word))) score += 3;
      }
      return { drill, index, score };
    });

    let chosen;
    const topicOrFocusHit = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score)[0];
    if (topicOrFocusHit) {
      chosen = topicOrFocusHit.drill;
    } else {
      // Deterministic round-robin via the cursor so `advance` keeps moving.
      const cursor = entry.fallbackCursor % safePack.length;
      chosen = safePack[cursor];
      entry.fallbackCursor = cursor + 1;
    }

    return createCard({
      phrase: chosen.phrase,
      focus: {
        axis: inferAxisFromFocus(chosen.focus, chosen.tags),
        direction: chosen.focus || '',
        statement: '',
      },
      difficulty: chosen.difficulty || 'easy',
      source: 'fallback',
      targetPreset,
    });
  }

  /**
   * Public deterministic fallback generator. Stores + returns the next fallback
   * card for the session (advancing the cursor). Never throws.
   */
  nextFallbackCard(sessionId, { targetPreset = 'cute-feminine', focus = null, topics = null } = {}) {
    const entry = this._ensure(sessionId);
    const prev = entry.active;
    const card = this._buildFallbackCard(sessionId, { targetPreset, focus, topics });
    if (prev) {
      card.parentCardId = prev.id;
      card.revision = prev.revision + 1;
    }
    this._replaceActive(entry, card);
    return card;
  }

  /**
   * 2026-07-26 phase C — the sentence-teardown card swap.
   *
   * `stashActiveCard` puts the whole-sentence card aside and makes `card` (the 1-3
   * word fragment) active; `restoreStashedCard` puts the sentence back, exactly as
   * it was — same id, same revision, same emphasis the tutor had authored on it.
   *
   * Restoring the ORIGINAL rather than re-authoring from the phrase matters: the
   * learner has been looking at that card, the tutor may have emphasized a word on
   * it through card-ops, and a re-authored twin would silently discard both and
   * pulse the UI as though the coach had changed the card. When there is nothing
   * stashed (a restore without a stash, or a process that lost the entry),
   * `fallbackSpec` is used to re-author instead, so the strip is never left showing
   * a fragment with no way back to the sentence.
   *
   * THE STASH IS ONLY VALID WHILE THE LOOP STILL OWNS THE STRIP.
   *
   * `restoreStashedCard` therefore checks that the CURRENT active card is still a
   * `source: 'section-loop'` card before putting the sentence back. Anything else
   * means something outside the loop replaced the strip in the meantime, and the
   * stashed sentence is stale — reinstating it would silently undo the learner's or
   * the tutor's newer card.
   *
   * This one predicate covers every replacement path, which is why it is used
   * instead of clearing the stash inside createCard/setActiveCard: `applyCardOps`
   * mutates `entry.active` directly and would slip past those. It also does the
   * right thing on the ops that legitimately edit the FRAGMENT (emphasize,
   * swap_phrase, simplify all carry `source` forward, so the card stays a
   * section-loop card and the sentence is still restored), while `create` and
   * `advance` mint a tutor/fallback card and correctly drop the stash.
   *
   * Reproduced during review, and the reason this rule exists: pick a "one real
   * sentence" card mid-isolation, then let the loop close — before this, the strip
   * silently reverted to the pre-isolation drill line.
   *
   * KNOWN AND ACCEPTED: a card-op the model issues during a HOLD turn (the learner
   * asked something mid-isolation) edits the FRAGMENT card, so it carries `source`
   * forward, the loop still owns the strip, and the sentence is restored over it on
   * exit — while the turn's payload has already reported `cardOpsApplied`. The op is
   * therefore counted but discarded. That is the right trade: the alternative is
   * letting a mid-isolation emphasis strand the learner on a fragment with no route
   * back to the line. If it ever needs fixing, suppress card-ops on HOLD turns
   * upstream rather than weakening this rule.
   *
   * All three are total and never throw.
   */
  stashActiveCard(sessionId, card) {
    const entry = this._ensure(sessionId);
    if (!card || typeof card !== 'object') return entry.active;
    // A second stash must not overwrite the first with a fragment: only ever hold
    // the sentence we came from.
    if (!entry.stashed) entry.stashed = entry.active;
    // The loop is installing its own card — that is the opposite of a takeover, and
    // a fresh isolation starts from a clean slate.
    entry.active = card;
    entry.loopCardTakenOver = false;
    return entry.active;
  }

  restoreStashedCard(sessionId, fallbackSpec = null) {
    const entry = this._ensure(sessionId);
    const stashed = entry.stashed;
    entry.loopCardTakenOver = false;
    // "No card at all" counts as the loop still owning the strip: there is nothing to
    // protect, and refusing here would strand a session that lost its card store
    // (a fresh process, a cleared store) with no route back to its sentence — the
    // exact recovery the fallbackSpec exists for.
    const loopStillOwnsStrip = !entry.active || entry.active.source === 'section-loop';
    entry.stashed = null;
    if (!loopStillOwnsStrip) {
      // Something replaced the fragment already. Leave that newer card alone — the
      // learner is looking at what they last chose, not at a fragment.
      return entry.active;
    }
    if (stashed) {
      entry.active = stashed;
      return entry.active;
    }
    if (fallbackSpec && typeof fallbackSpec === 'object' && clipPhrase(fallbackSpec.phrase)) {
      entry.active = createCard(fallbackSpec);
      return entry.active;
    }
    return entry.active;
  }

  /**
   * True when a card that is NOT the isolation loop's has replaced one that was —
   * i.e. the loop no longer owns the strip. The runtime reads this as `stripOwned`
   * on the NEXT coach turn, which is when the loop closes as `exited_card_takeover`.
   *
   * Deliberately a fact ABOUT A REPLACEMENT, not about the current card's source:
   * "our card is not on the strip" is also true when a loop's card was never
   * authored, and closing the loop for that reason would fire on ordinary turns.
   */
  hasCardTakeover(sessionId) {
    const entry = this._bySession.get(String(sessionId || ''));
    return Boolean(entry && entry.loopCardTakenOver);
  }

  /** Rearm the detector — called when an isolation ends, however it ended. */
  clearCardTakeover(sessionId) {
    const entry = this._bySession.get(String(sessionId || ''));
    if (entry) entry.loopCardTakenOver = false;
  }

  hasStashedCard(sessionId) {
    const entry = this._bySession.get(String(sessionId || ''));
    return Boolean(entry && entry.stashed);
  }

  /**
   * Drop a session's card state (e.g. on session delete). Best-effort.
   */
  clear(sessionId) {
    this._bySession.delete(String(sessionId || ''));
  }
}

module.exports = {
  PracticeCardStore,
  createCard,
  buildCardTokens,
  buildFocus,
  inferAxisFromFocus,
  findSimplerPhrase,
  normalizeKind,
  normalizeSource,
  CARD_FOCUS_AXES,
  CARD_KINDS,
  CARD_SOURCES,
  DIFFICULTIES,
  MAX_EMPHASIS,
  MAX_PHRASE_LEN,
};
