'use strict';

/**
 * card-ops — the tutor's card-authoring channel.
 *
 * The coach reply MAY end with a single fenced ```card-ops``` block carrying a
 * structured authoring directive. This module:
 *   (a) buildCardOpsPromptAddendum() — the strict instruction we teach the model.
 *   (b) extractCardOps(rawReply) -> { say, ops|null } — strips ONLY a trailing
 *       fenced block from the visible reply and parses the JSON safely.
 *   (c) validateCardOps(parsed) -> { valid, ops, errors } — schema-checks every
 *       op, dropping invalid ops individually. NEVER throws.
 *
 * Design (see docs/LESSON-EXPERIENCE-DESIGN.md "Tutor authoring channel"):
 *   - The block is OPTIONAL. No block => behave exactly as before (plain coaching).
 *   - Validation mirrors the signal-schema gate philosophy: malformed input is
 *     dropped, never crashes the turn.
 *   - INJECTION SAFETY: only a fenced block at the very END of the reply is treated
 *     as ops. A ```card-ops``` block embedded mid-reply (e.g. inside a quoted user
 *     message) is left in the visible text and ignored as a directive.
 */

// Mirror the PracticeCard focus axes (design-doc enum) so the model and the card
// store agree on the focus vocabulary.
const FOCUS_AXES = ['pitch', 'resonance', 'weight', 'prosody'];
const CARD_OPS = ['create', 'emphasize', 'swap_phrase', 'simplify'];

const MAX_EMPHASIS = 3;
const MIN_EMPHASIS = 0;
const MAX_PHRASE_LEN = 120;
const MAX_OPS = 8;

/**
 * The strict instruction appended to the coach prompt. Documents the allowed
 * block, ops, and bounds. Kept compact (the renderer prompt is short by design).
 */
function buildCardOpsPromptAddendum() {
  return [
    'CARD AUTHORING (optional). You may shape the on-screen practice card.',
    'If — and only if — you want to change the card, END your reply with ONE fenced block:',
    '```card-ops',
    '{"card_ops": [ ... ], "focus_update": {...}, "replay": {...}}',
    '```',
    'Rules for the block:',
    '- It MUST be the LAST thing in your reply. Put your spoken line BEFORE it. Never put it mid-sentence or inside a quote.',
    '- It MUST be valid JSON. Emit at most one block. Omit it entirely when no card change is needed.',
    '- card_ops is an array (max 8) of:',
    '    {"op":"create","phrase":"<= 120 chars","focus":{"axis":"pitch|resonance|weight|prosody","direction":"..."},"difficulty":"easy|medium|hard"}',
    '    {"op":"emphasize","token":"<one word already in the phrase>","level":0-3}',
    '    {"op":"swap_phrase","phrase":"<= 120 chars"}',
    '    {"op":"simplify"}',
    '- focus_update (optional): {"axis":"pitch|resonance|weight|prosody","direction":"...","statement":"Today: ..."}',
    '- replay (optional): {"attemptId":"<id>","momentProgress":0..1,"reason":"why this moment"} — to listen back together.',
    'The spoken line you write is what the learner hears; the block is silent and only the app reads it.',
  ].join('\n');
}

/**
 * Locate a TRAILING fenced ```card-ops``` (or ```json after a card-ops marker)
 * block. Returns { jsonText, blockStart } or null.
 *
 * Only matches when the block is the last non-whitespace content of the reply,
 * so a block embedded in quoted user text is NOT treated as a directive.
 */
function findTrailingCardOpsBlock(reply) {
  const text = String(reply || '');

  // Collect every fence line (``` optionally followed by a language tag) with its
  // offsets. We then pair the LAST closing fence (which must sit at EOF, only
  // whitespace after) with the LAST opener before it. Scanning fence tokens —
  // rather than one greedy regex — keeps an EARLIER injected ```card-ops``` block
  // (e.g. inside quoted user text) from being swallowed into the captured body.
  const fenceLineRe = /^[ \t]*```[ \t]*([A-Za-z0-9_-]*)[ \t]*$/gm;
  const fences = [];
  let m;
  while ((m = fenceLineRe.exec(text)) !== null) {
    fences.push({
      tag: (m[1] || '').toLowerCase(),
      start: m.index,
      // End of this fence line's content (start of the next line's text).
      lineEnd: m.index + m[0].length,
    });
  }
  if (fences.length < 2) return null;

  const closer = fences[fences.length - 1];
  // The closing fence must be the last non-whitespace content of the reply.
  if (text.slice(closer.lineEnd).trim() !== '') return null;

  const opener = fences[fences.length - 2];
  // A closing fence carries no tag; if the would-be opener itself has only trailing
  // whitespace before EOF it isn't a real opener.
  const tag = opener.tag;
  const body = text.slice(opener.lineEnd, closer.start).trim();
  if (!body) return null;

  // Recognised authoring tags. We accept `card-ops`/`cardops`, or a bare/`json`
  // fence that actually carries a card-ops payload (some models drop the tag).
  const isCardOpsTag = tag === 'card-ops' || tag === 'cardops';
  if (!isCardOpsTag) {
    if (tag !== '' && tag !== 'json') return null;
    if (!/\b(card_ops|cardOps|focus_update|focusUpdate|replay)\b/.test(body)) {
      return null;
    }
  }

  return { jsonText: body, blockStart: opener.start };
}

/**
 * Safe JSON parse with light repair (strip trailing commas). Returns null on failure.
 */
function safeParseJson(jsonText) {
  if (typeof jsonText !== 'string' || !jsonText.trim()) return null;
  const attempts = [
    jsonText,
    // Repair a common model slip: trailing commas before } or ].
    jsonText.replace(/,(\s*[}\]])/g, '$1'),
  ];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // try next repair
    }
  }
  return null;
}

/**
 * Strip a trailing card-ops block from the visible reply and parse it.
 * Returns { say, ops } where `say` is the visible text (block removed, trimmed)
 * and `ops` is the parsed object ({card_ops, focus_update, replay}) or null.
 *
 * Never throws.
 */
function extractCardOps(rawReply) {
  const text = String(rawReply || '');
  const found = findTrailingCardOpsBlock(text);
  if (!found) {
    return { say: text.trim(), ops: null };
  }

  const say = text.slice(0, found.blockStart).trim();
  const parsed = safeParseJson(found.jsonText);
  if (!parsed) {
    // The block was unparseable — keep the visible text clean (block removed) but
    // surface no ops. We still strip it so the learner never sees raw JSON.
    return { say, ops: null };
  }

  return { say, ops: parsed };
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clampLevel(value) {
  return Math.max(MIN_EMPHASIS, Math.min(MAX_EMPHASIS, Math.round(value)));
}

/**
 * Validate a single op. Returns { ok, op?, error? }.
 */
function validateOp(rawOp, index) {
  if (!rawOp || typeof rawOp !== 'object') {
    return { ok: false, error: `op[${index}]: not an object` };
  }
  const op = typeof rawOp.op === 'string' ? rawOp.op.trim() : '';
  if (!CARD_OPS.includes(op)) {
    return { ok: false, error: `op[${index}]: unknown op "${op}"` };
  }

  if (op === 'create') {
    const phrase = typeof rawOp.phrase === 'string' ? rawOp.phrase.trim() : '';
    if (!phrase) return { ok: false, error: `op[${index}] create: missing phrase` };
    if (phrase.length > MAX_PHRASE_LEN) {
      return { ok: false, error: `op[${index}] create: phrase exceeds ${MAX_PHRASE_LEN} chars` };
    }
    const clean = { op: 'create', phrase: phrase.slice(0, MAX_PHRASE_LEN) };
    if (rawOp.focus && typeof rawOp.focus === 'object') {
      const focus = {};
      if (typeof rawOp.focus.axis === 'string' && FOCUS_AXES.includes(rawOp.focus.axis.trim().toLowerCase())) {
        focus.axis = rawOp.focus.axis.trim().toLowerCase();
      }
      if (typeof rawOp.focus.direction === 'string' && rawOp.focus.direction.trim()) {
        focus.direction = rawOp.focus.direction.trim().slice(0, 120);
      }
      if (typeof rawOp.focus.statement === 'string' && rawOp.focus.statement.trim()) {
        focus.statement = rawOp.focus.statement.trim().slice(0, 120);
      }
      if (Object.keys(focus).length > 0) clean.focus = focus;
    }
    if (typeof rawOp.difficulty === 'string' && ['easy', 'medium', 'hard'].includes(rawOp.difficulty.trim().toLowerCase())) {
      clean.difficulty = rawOp.difficulty.trim().toLowerCase();
    }
    return { ok: true, op: clean };
  }

  if (op === 'emphasize') {
    const token = typeof rawOp.token === 'string' ? rawOp.token.trim() : '';
    if (!token) return { ok: false, error: `op[${index}] emphasize: missing token` };
    if (token.length > 40) return { ok: false, error: `op[${index}] emphasize: token too long` };
    if (!isFiniteNumber(rawOp.level) || !Number.isInteger(rawOp.level)) {
      return { ok: false, error: `op[${index}] emphasize: level must be an integer 0-3` };
    }
    if (rawOp.level < MIN_EMPHASIS || rawOp.level > MAX_EMPHASIS) {
      return { ok: false, error: `op[${index}] emphasize: level ${rawOp.level} out of range 0-3` };
    }
    return { ok: true, op: { op: 'emphasize', token: token.slice(0, 40), level: clampLevel(rawOp.level) } };
  }

  if (op === 'swap_phrase') {
    const phrase = typeof rawOp.phrase === 'string' ? rawOp.phrase.trim() : '';
    if (!phrase) return { ok: false, error: `op[${index}] swap_phrase: missing phrase` };
    if (phrase.length > MAX_PHRASE_LEN) {
      return { ok: false, error: `op[${index}] swap_phrase: phrase exceeds ${MAX_PHRASE_LEN} chars` };
    }
    return { ok: true, op: { op: 'swap_phrase', phrase: phrase.slice(0, MAX_PHRASE_LEN) } };
  }

  // simplify takes no params
  return { ok: true, op: { op: 'simplify' } };
}

/**
 * Validate a focus_update block. Returns the cleaned focus or null.
 */
function validateFocusUpdate(rawFocus) {
  if (!rawFocus || typeof rawFocus !== 'object') return null;
  const focus = {};
  if (typeof rawFocus.axis === 'string' && FOCUS_AXES.includes(rawFocus.axis.trim().toLowerCase())) {
    focus.axis = rawFocus.axis.trim().toLowerCase();
  }
  if (typeof rawFocus.direction === 'string' && rawFocus.direction.trim()) {
    focus.direction = rawFocus.direction.trim().slice(0, 120);
  }
  if (typeof rawFocus.statement === 'string' && rawFocus.statement.trim()) {
    const s = rawFocus.statement.trim().replace(/^today:\s*/i, '');
    focus.statement = `Today: ${s}`.slice(0, 120);
  }
  return Object.keys(focus).length > 0 ? focus : null;
}

/**
 * Validate a replay directive. Returns the cleaned object or null.
 */
function validateReplay(rawReplay) {
  if (!rawReplay || typeof rawReplay !== 'object') return null;
  const replay = {};
  if (typeof rawReplay.attemptId === 'string' && rawReplay.attemptId.trim()) {
    replay.attemptId = rawReplay.attemptId.trim().slice(0, 200);
  }
  if (isFiniteNumber(rawReplay.momentProgress)) {
    if (rawReplay.momentProgress < 0 || rawReplay.momentProgress > 1) {
      // Out of range: drop the field rather than the whole directive.
    } else {
      replay.momentProgress = rawReplay.momentProgress;
    }
  }
  if (typeof rawReplay.reason === 'string' && rawReplay.reason.trim()) {
    replay.reason = rawReplay.reason.trim().slice(0, 200);
  }
  // A replay with neither an attemptId nor a momentProgress is meaningless.
  if (replay.attemptId == null && replay.momentProgress == null) return null;
  return replay;
}

/**
 * Schema-check a parsed authoring object. Drops invalid ops individually and
 * never throws. Returns:
 *   { valid: boolean, ops: CleanOp[], focusUpdate, replay, errors: string[] }
 * `valid` is true when the object parsed and at least one actionable directive
 * (op, focusUpdate, or replay) survived validation.
 */
function validateCardOps(parsed) {
  const errors = [];
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, ops: [], focusUpdate: null, replay: null, errors: ['not an object'] };
  }

  const rawOps = Array.isArray(parsed.card_ops)
    ? parsed.card_ops
    : (Array.isArray(parsed.cardOps) ? parsed.cardOps : []);

  const ops = [];
  if (rawOps.length > MAX_OPS) {
    errors.push(`card_ops truncated: ${rawOps.length} > max ${MAX_OPS}`);
  }
  for (let i = 0; i < Math.min(rawOps.length, MAX_OPS); i += 1) {
    const result = validateOp(rawOps[i], i);
    if (result.ok) ops.push(result.op);
    else errors.push(result.error);
  }

  const focusUpdate = validateFocusUpdate(parsed.focus_update || parsed.focusUpdate);
  const replay = validateReplay(parsed.replay);

  const valid = ops.length > 0 || focusUpdate != null || replay != null;
  return { valid, ops, focusUpdate, replay, errors };
}

module.exports = {
  buildCardOpsPromptAddendum,
  extractCardOps,
  validateCardOps,
  findTrailingCardOpsBlock,
  FOCUS_AXES,
  CARD_OPS,
  MAX_EMPHASIS,
  MAX_PHRASE_LEN,
  MAX_OPS,
};
