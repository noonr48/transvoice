'use strict';

const {
  extractDeterministicMemoryOps,
  PREFERENCE_RULES,
} = require('./memory-extract');

/**
 * memory-ops — the tutor's own memory-writing channel.
 *
 * The coach reply MAY end with a single fenced ```remember-ops``` block carrying
 * a small set of things the tutor wants to REMEMBER about the learner (a topic
 * they mentioned, a hobby, a cue that worked, an identity moment, a coaching
 * preference). This is the mechanism that makes an honest "I'll remember that"
 * mechanically true (see docs/TUTOR-MEMORY-AUDIT.md gap 1). This module:
 *   (a) buildMemoryOpsPromptAddendum() — the strict instruction we teach the model.
 *   (b) extractMemoryOps(rawReply) -> { say, ops|null } — strips ONLY a trailing
 *       fenced block from the visible reply and parses the JSON safely.
 *   (c) validateMemoryOps(parsed) -> { valid, ops, errors } — clamps/drops every
 *       invalid op individually. NEVER throws.
 *
 * Design — mirrors coaching/card-ops.js EXACTLY (same trailing-anchor extraction,
 * same fail-soft validation philosophy):
 *   - The block is OPTIONAL. No block => behave exactly as before (the model is
 *     trained with restraint; most turns write nothing).
 *   - INJECTION SAFETY: only a fenced block at the very END of the reply is treated
 *     as ops. A ```remember-ops``` block embedded mid-reply (e.g. inside a quoted
 *     user message) is left in the visible text and ignored as a directive.
 *   - COOPERATIVE WITH card-ops: a single reply may carry BOTH a card-ops and a
 *     remember-ops block at its tail, in EITHER order. extractMemoryOps therefore
 *     treats its block as "trailing" when everything after it is whitespace OR a
 *     single other fenced block (the card-ops block). The runtime strips
 *     remember-ops FIRST, then card-ops strips its (now-trailing) block from the
 *     remainder, so the two strips compose regardless of order.
 */

// The kinds the tutor may remember. Each routes to a different learner-context
// destination in applyMemoryOps (memory-ops-apply.js / the service).
const MEMORY_KINDS = ['topic', 'hobby', 'whatWorked', 'moment', 'preference'];
// v6: lowercase -> canonical kind (case-insensitive validation, single source of truth
// vs the dataset validator which lowercases + accepts e.g. "whatworked"/"Moment").
const MEMORY_KIND_CANON = MEMORY_KINDS.reduce((m, k) => { m[k.toLowerCase()] = k; return m; }, {});
const PREFERENCE_BY_ID = new Map(PREFERENCE_RULES.map((rule) => [rule.id, rule]));
const PREFERENCE_BY_VALUE = new Map(PREFERENCE_RULES.map((rule) => [
  rule.value.toLowerCase().replace(/\s+/g, ' ').trim(),
  rule,
]));

// v6 FAITHFULNESS: a free-text remember (moment/whatWorked/topic/hobby) must be
// GROUNDED in what the learner actually said — at least half of the value's content
// words must appear in the recent learner utterance. Stops the LLM remember channel
// from persisting an invented fact ("came out to their entire family today"), which is
// among the most harmful failures for an identity memory. Preferences are EXEMPT:
// they're coaching-style paraphrases, captured faithfully by the deterministic channel.
const REVEAL_MATCH_KINDS = new Set(['moment', 'whatWorked', 'topic', 'hobby']);
const REVEAL_STOPWORDS = new Set('the a an and or but to of in on at for with about my your their our its me you it that this these those is was were be been being are am has have had do did does will would can could just really very so today now then them they she he her him his we us i'.split(' '));
function valueGroundedIn(value, utterance) {
  const u = String(utterance || '').toLowerCase();
  if (!u.trim()) return false; // nothing to verify against -> conservative reject
  const content = (String(value || '').toLowerCase().match(/[a-z][a-z']{2,}/g) || [])
    .filter((w) => !REVEAL_STOPWORDS.has(w));
  if (!content.length) return true; // no falsifiable content (numbers / very short) -> allow
  const hits = content.filter((w) => u.includes(w)).length;
  return hits / content.length >= 0.5;
}
// Focus axes a whatWorked/moment op may tag (mirrors the card-ops / signal axes).
const FOCUS_AXES = ['pitch', 'resonance', 'weight', 'prosody'];
// The identity-moment kinds (voice.moments[].kind).
const MOMENT_KINDS = ['gendered-right', 'hard-moment', 'milestone'];

const MAX_VALUE_LEN = 200; // every remembered value is clamped to <= 200 chars
const MAX_REMEMBER = 3; // at most 3 things remembered per reply

/**
 * The strict instruction appended to the coach prompt. Documents the allowed
 * block, kinds, and bounds. Kept compact (the renderer prompt is short by design)
 * and explicitly teaches RESTRAINT — most turns should emit nothing.
 */
function buildMemoryOpsPromptAddendum() {
  return [
    'MEMORY (optional). You may quietly remember something true about the learner.',
    'Only when the learner reveals something worth carrying across sessions — a topic',
    'or hobby they mentioned, a cue that genuinely worked, a real identity moment',
    '("got ma\'am\'d on the phone"), or a coaching preference ("imagery cues confuse',
    'me") — END your reply with ONE fenced block:',
    '```remember-ops',
    '{"remember": [ ... ]}',
    '```',
    'Rules for the block:',
    '- It MUST be the LAST thing in your reply (a card-ops block, if any, may follow it). Put your spoken line BEFORE it. Never mid-sentence or inside a quote.',
    '- It MUST be valid JSON. Emit at most one block. OMIT it entirely on most turns — remembering is rare and deliberate, not every turn.',
    '- remember is an array (max 3) of:',
    '    {"kind":"topic|hobby|whatWorked|moment|preference","value":"<= 200 chars"}',
    '  optional fields:',
    '    "axis":"pitch|resonance|weight|prosody"   (for whatWorked — which axis the win was about)',
    '    "momentKind":"gendered-right|hard-moment|milestone"   (for moment — what kind of moment)',
    '- Never invent facts. Remember only what the learner actually said or did.',
    'The spoken line you write is what the learner hears; the block is silent and only the app reads it.',
  ].join('\n');
}

/**
 * Collect every fence line (``` optionally followed by a language tag) with its
 * offsets, in document order. Shared by the trailing-block locator.
 */
function collectFences(text) {
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
  return fences;
}

/** Does this body look like a remember-ops payload (for bare/json-tagged fences)? */
function looksLikeMemoryOps(body) {
  return /\b(remember)\b/.test(body) && /\bkind\b/.test(body);
}

/**
 * Locate a TRAILING ```remember-ops``` block. Returns
 *   { jsonText, blockStart, blockEnd } or null.
 *
 * "Trailing" is COOPERATIVE with card-ops: the block counts as trailing when the
 * only content after its closing fence is whitespace and/or a SINGLE other fenced
 * block (the card-ops block). This lets a reply carry both blocks at the tail in
 * either order. An embedded block inside quoted user text (with real prose after
 * it) is NOT treated as a directive.
 *
 * Scanning fence tokens — rather than one greedy regex — keeps an EARLIER injected
 * ```remember-ops``` block from being swallowed.
 */
function findTrailingMemoryOpsBlock(reply) {
  const text = String(reply || '');
  const fences = collectFences(text);
  if (fences.length < 2) return null;

  // Walk candidate (opener, closer) pairs from the END inward. For each closing
  // fence, its opener is the fence immediately before it. We try the last fence
  // as a closer, then the third-from-last (i.e. allow ONE trailing fenced block
  // — the card-ops block — to sit after our pair).
  // closerIdx must be odd-distance from an opener; we just pair consecutive
  // fences: (fences[i-1] = opener, fences[i] = closer).
  const tryPair = (openerIdx, closerIdx, requireTrailingClean) => {
    if (openerIdx < 0) return null;
    const opener = fences[openerIdx];
    const closer = fences[closerIdx];
    if (requireTrailingClean) {
      // Everything after this closer must be whitespace OR exactly one more
      // fenced block (open+close) then whitespace.
      const after = text.slice(closer.lineEnd);
      if (after.trim() !== '') {
        // Allow a single trailing fenced block: the next two fences must be the
        // last two, and nothing but whitespace may sit around/after them.
        const trailing = fences.slice(closerIdx + 1);
        if (trailing.length !== 2) return null;
        const [tOpen, tClose] = trailing;
        if (text.slice(closer.lineEnd, tOpen.start).trim() !== '') return null;
        if (text.slice(tClose.lineEnd).trim() !== '') return null;
        // The trailing block must NOT itself be a remember-ops block (we only
        // ever honor one remember-ops block; a card-ops block is fine).
        const tBody = text.slice(tOpen.lineEnd, tClose.start).trim();
        if (tOpen.tag === 'remember-ops' || tOpen.tag === 'rememberops' || looksLikeMemoryOps(tBody)) {
          return null;
        }
      }
    }
    const tag = opener.tag;
    const body = text.slice(opener.lineEnd, closer.start).trim();
    if (!body) return null;
    const isMemoryTag = tag === 'remember-ops' || tag === 'rememberops';
    if (!isMemoryTag) {
      if (tag !== '' && tag !== 'json') return null;
      if (!looksLikeMemoryOps(body)) return null;
    }
    return { jsonText: body, blockStart: opener.start, blockEnd: closer.lineEnd };
  };

  // Case A: our block IS the last pair (nothing after it but whitespace).
  const lastCloser = fences.length - 1;
  let found = tryPair(lastCloser - 1, lastCloser, true);
  if (found) return found;

  // Case B: our block is the SECOND-to-last pair, a card-ops block trails it.
  if (fences.length >= 4) {
    const penultCloser = fences.length - 3;
    found = tryPair(penultCloser - 1, penultCloser, true);
    if (found) return found;
  }

  return null;
}

/**
 * Safe JSON parse with light repair (strip trailing commas). Returns null on
 * failure. Mirrors card-ops.safeParseJson.
 */
function safeParseJson(jsonText) {
  if (typeof jsonText !== 'string' || !jsonText.trim()) return null;
  const attempts = [
    jsonText,
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
 * Strip a trailing remember-ops block from the visible reply and parse it.
 * Returns { say, ops } where `say` is the visible text with ONLY the remember-ops
 * block removed (a trailing card-ops block, if any, is left intact for the
 * card-ops extractor downstream) and `ops` is the parsed object ({remember}) or
 * null.
 *
 * Never throws.
 */
function extractMemoryOps(rawReply) {
  const text = String(rawReply || '');
  const found = findTrailingMemoryOpsBlock(text);
  if (!found) {
    return { say: text.trim(), ops: null };
  }

  // Excise ONLY our block, preserving any prose/other-block before AND after it,
  // so a card-ops block sitting after us survives for the card-ops extractor.
  const before = text.slice(0, found.blockStart);
  const after = text.slice(found.blockEnd);
  const say = `${before}${after}`.replace(/\n{3,}/g, '\n\n').trim();

  const parsed = safeParseJson(found.jsonText);
  if (!parsed) {
    // Unparseable block — keep the visible text clean (block removed) but surface
    // no ops. The learner never sees raw JSON.
    return { say, ops: null };
  }
  return { say, ops: parsed };
}

/**
 * Validate a single remember op. Returns { ok, op?, error? }.
 * Clamps value length; coerces/validates kind, axis, momentKind. Never throws.
 */
function validateMemoryOp(rawOp, index) {
  if (!rawOp || typeof rawOp !== 'object') {
    return { ok: false, error: `remember[${index}]: not an object` };
  }
  // v6: case-insensitive + canonicalized kind ("Moment"/"whatworked"/"PREFERENCE" all
  // map to the canonical form) — matches the dataset validator so trained casings are
  // not silently dropped at runtime (which would lose identity-moment writes).
  const rawKind = typeof rawOp.kind === 'string' ? rawOp.kind.trim().toLowerCase() : '';
  const kind = MEMORY_KIND_CANON[rawKind] || '';
  if (!kind) {
    return { ok: false, error: `remember[${index}]: unknown kind "${typeof rawOp.kind === 'string' ? rawOp.kind : ''}"` };
  }
  const value = typeof rawOp.value === 'string' ? rawOp.value.trim() : '';
  if (!value) {
    return { ok: false, error: `remember[${index}] ${kind}: missing value` };
  }

  const op = { kind, value: value.slice(0, MAX_VALUE_LEN) };
  if (kind === 'preference') {
    const requestedId = typeof rawOp.preferenceId === 'string'
      ? rawOp.preferenceId.trim().toLowerCase()
      : '';
    const rule = PREFERENCE_BY_ID.get(requestedId)
      || PREFERENCE_BY_VALUE.get(value.toLowerCase().replace(/\s+/g, ' ').trim())
      || null;
    if (rule) {
      op.preferenceId = rule.id;
      op.value = rule.value;
    }
  }

  // axis is meaningful for whatWorked (and harmless context for moment). Keep it
  // only when valid; drop silently otherwise (never fail the whole op for it).
  if (typeof rawOp.axis === 'string' && FOCUS_AXES.includes(rawOp.axis.trim().toLowerCase())) {
    op.axis = rawOp.axis.trim().toLowerCase();
  }

  // momentKind is meaningful for moment. Default to 'milestone' for a moment op
  // with no/invalid momentKind so the moment is always well-formed.
  if (kind === 'moment') {
    const mk = typeof rawOp.momentKind === 'string' ? rawOp.momentKind.trim() : '';
    op.momentKind = MOMENT_KINDS.includes(mk) ? mk : 'milestone';
  } else if (typeof rawOp.momentKind === 'string' && MOMENT_KINDS.includes(rawOp.momentKind.trim())) {
    // Preserve a valid momentKind on non-moment ops too (harmless, ignored on apply).
    op.momentKind = rawOp.momentKind.trim();
  }

  return { ok: true, op };
}

/**
 * Schema-check a parsed memory object. Drops invalid ops individually and never
 * throws. Returns:
 *   { valid: boolean, ops: CleanOp[], errors: string[] }
 * `valid` is true when the object parsed and at least one op survived validation.
 */
function validateMemoryOps(parsed) {
  const errors = [];
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, ops: [], errors: ['not an object'] };
  }

  const rawOps = Array.isArray(parsed.remember)
    ? parsed.remember
    : (Array.isArray(parsed.memory_ops) ? parsed.memory_ops : []);

  const ops = [];
  if (rawOps.length > MAX_REMEMBER) {
    errors.push(`remember truncated: ${rawOps.length} > max ${MAX_REMEMBER}`);
  }
  for (let i = 0; i < Math.min(rawOps.length, MAX_REMEMBER); i += 1) {
    const result = validateMemoryOp(rawOps[i], i);
    if (result.ok) ops.push(result.op);
    else errors.push(result.error);
  }

  return { valid: ops.length > 0, ops, errors };
}

// Local YYYY-MM-DD (host tz), matching the learner-context date semantics.
function localDateString(now = Date.now()) {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Apply VALIDATED memory ops to the learner-context profile via the service.
 * Routes each op to its destination (dedupe/caps are enforced inside the service):
 *   - topic       -> appendLearnerTopics([value])      (append, dedupe, cap 12)
 *   - hobby       -> appendLearnerHobbies([value])      (append, dedupe, cap 12)
 *   - whatWorked  -> updateLearnerProfile({whatWorked:[{text,axis?,date}]})  (cap 10)
 *   - moment      -> addMoment({kind:momentKind, text})  (cap 40)
 *   - preference  -> addCoachPreference({text})          (cap 10)
 *
 * Topic/hobby ops are batched into a single append call each (fewer profile
 * writes). Returns the number of ops successfully dispatched. CRASH-PROOF: any
 * error from a single destination is swallowed (that op simply doesn't count);
 * the function never throws so the coaching turn is never affected.
 *
 * `ops` should be the `ops` array from validateMemoryOps (already clamped). If a
 * raw object is passed it is validated defensively first.
 */
function applyMemoryOps(learnerContextService, studentId, ops, options = {}) {
  const svc = learnerContextService;
  const sid = typeof studentId === 'string' ? studentId : '';
  if (!svc || !sid) return 0;

  // Accept either a clean ops array or a raw/parsed object (defensive).
  let cleanOps = Array.isArray(ops) ? ops : null;
  if (!cleanOps) {
    const validated = validateMemoryOps(ops);
    cleanOps = validated.ops;
  }
  if (!Array.isArray(cleanOps) || cleanOps.length === 0) return 0;

  const date = typeof options.date === 'string' && options.date
    ? options.date
    : localDateString(Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now());

  const topics = [];
  const hobbies = [];
  let applied = 0;
  // v6 FAITHFULNESS: the reveal-match gate is active only when the learner's recent
  // words are provided (the LLM remember channel always passes options.utterance);
  // direct/deterministic callers pass none and skip it.
  const hasUtterance = typeof options.utterance === 'string' && options.utterance.trim() !== '';
  const groundedPreferenceIds = hasUtterance
    ? new Set(extractDeterministicMemoryOps(options.utterance).map((op) => op.preferenceId))
    : null;

  for (const op of cleanOps) {
    if (!op || typeof op !== 'object') continue;
    const value = typeof op.value === 'string' ? op.value : '';
    if (!value) continue;
    // A free-text remember must be GROUNDED in the learner's words (invented facts
    // dropped). Preferences are exempt (REVEAL_MATCH_KINDS excludes them).
    if (hasUtterance && REVEAL_MATCH_KINDS.has(op.kind) && !valueGroundedIn(value, options.utterance)) {
      continue;
    }
    // topic/hobby are deferred to a single batched append below (one profile
    // write each); they're counted only AFTER that append succeeds so a failed
    // batch never over-counts memoryOpsApplied.
    try {
      switch (op.kind) {
        case 'topic':
          topics.push(value);
          break;
        case 'hobby':
          hobbies.push(value);
          break;
        case 'whatWorked':
          if (typeof svc.updateLearnerProfile === 'function') {
            svc.updateLearnerProfile(sid, {
              whatWorked: [{ text: value, axis: op.axis || null, date }],
            });
            applied += 1;
          }
          break;
        case 'moment':
          if (typeof svc.addMoment === 'function') {
            svc.addMoment(sid, { kind: op.momentKind || 'milestone', text: value, date });
            applied += 1;
          }
          break;
        case 'preference':
          {
            const rule = PREFERENCE_BY_ID.get(op.preferenceId)
              || PREFERENCE_BY_VALUE.get(value.toLowerCase().replace(/\s+/g, ' ').trim())
              || null;
            if (
              rule
              && (!hasUtterance || groundedPreferenceIds.has(rule.id))
              && typeof svc.addCoachPreference === 'function'
            ) {
              svc.addCoachPreference(sid, {
                id: rule.id,
                text: rule.value,
                date,
                source: hasUtterance ? 'model-grounded' : 'deterministic',
              });
              applied += 1;
            }
          }
          break;
        default:
          break;
      }
    } catch {
      // fail-soft: a single failed destination must never break the turn or the
      // rest of the ops. It simply doesn't count toward `applied`.
    }
  }

  // Batched topic/hobby appends (one profile write each). Count toward `applied`
  // only on a successful write so the count reflects what actually persisted.
  if (topics.length && typeof svc.appendLearnerTopics === 'function') {
    try {
      svc.appendLearnerTopics(sid, topics);
      applied += topics.length;
    } catch { /* fail-soft: failed append doesn't count */ }
  }
  if (hobbies.length && typeof svc.appendLearnerHobbies === 'function') {
    try {
      svc.appendLearnerHobbies(sid, hobbies);
      applied += hobbies.length;
    } catch { /* fail-soft: failed append doesn't count */ }
  }

  return applied;
}

module.exports = {
  buildMemoryOpsPromptAddendum,
  extractMemoryOps,
  validateMemoryOps,
  applyMemoryOps,
  findTrailingMemoryOpsBlock,
  MEMORY_KINDS,
  FOCUS_AXES,
  MOMENT_KINDS,
  MAX_VALUE_LEN,
  MAX_REMEMBER,
};
