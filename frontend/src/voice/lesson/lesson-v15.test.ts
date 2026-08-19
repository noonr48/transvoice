// Pure-logic tests for the v1.5 lesson surfaces (one-real-sentence slot, the
// time-lapse mirror, and the take-finalize extras normalizers). No DOM — the
// modules under test import only types at runtime, so they run under
// `node --test` after an esbuild transpile (mirrors lesson-pure.test.ts).
//
// Run (from frontend/):
//   node_modules/.bin/esbuild src/voice/lesson/{sentence-slot-pure,mirror-pure,take-extras}.ts \
//     --bundle --format=esm --platform=node --outdir=/tmp/lp15 && \
//   node_modules/.bin/esbuild src/voice/lesson/lesson-v15.test.ts \
//     --bundle --format=esm --platform=node --external:node:* --outfile=/tmp/lp15/t.mjs && \
//   node --test /tmp/lp15/t.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveSentenceSlotView,
  realSentenceStatusLabel,
  sanitizeRealSentenceText,
  SENTENCE_SLOT_EMPTY_LINE,
  REAL_SENTENCE_MAX_LEN,
} from './sentence-slot-pure';
import {
  resolveMirrorPair,
  sanitizeMilestones,
  mirrorPairHeader,
  milestoneRowLabel,
  MIRROR_HONEST_LINE,
  MIRROR_EMPTY_LINE,
} from './mirror-pure';
import {
  normalizeVoiceGuardianHint,
  normalizeVoicePinSuggestion,
  normalizeVoiceRealSentenceReadiness,
  GUARDIAN_EASE_HINT,
} from './take-extras';
import type { VoiceMilestone } from '../api';

// --- one-real-sentence slot: state -> plain-words mapping -------------------
test('sentence status label: exact plain-words mapping (no score/streak words)', () => {
  assert.equal(realSentenceStatusLabel('picked'), 'rehearsing');
  assert.equal(realSentenceStatusLabel('ready'), 'feels ready to go outside');
  assert.equal(realSentenceStatusLabel('carried'), 'carried today');
  // debriefed + unknown collapse to no label (the slot returns to quiet).
  assert.equal(realSentenceStatusLabel('debriefed'), '');
  assert.equal(realSentenceStatusLabel(null), '');
  assert.equal(realSentenceStatusLabel(undefined), '');
  // Banned-vocabulary guard: none of the labels leak a forbidden word.
  const banned = ['score', 'points', 'level', 'streak', 'combo', 'xp', 'badge', 'unlock'];
  for (const status of ['picked', 'ready', 'carried'] as const) {
    const label = realSentenceStatusLabel(status).toLowerCase();
    for (const word of banned) assert.ok(!label.includes(word), `${status} label leaks "${word}"`);
  }
});

test('sentence slot view: empty when no entry / blank text / already debriefed', () => {
  const empties = [
    resolveSentenceSlotView(null),
    resolveSentenceSlotView(undefined),
    resolveSentenceSlotView({ id: 'rs_1', text: '   ', status: 'picked' }),
    resolveSentenceSlotView({ id: 'rs_1', text: 'A flat white, please.', status: 'debriefed' }),
  ];
  for (const v of empties) {
    assert.equal(v.mode, 'empty');
    assert.equal(v.text, '');
    assert.equal(v.statusLabel, '');
    assert.equal(v.canMarkSaidToday, false);
  }
  // The empty invite line is the exact contract copy.
  assert.match(SENTENCE_SLOT_EMPTY_LINE, /one real sentence for today/i);
});

test('sentence slot view: picked -> text + status; canMarkSaidToday only picked/ready', () => {
  const picked = resolveSentenceSlotView({ id: 'rs_1', text: 'A flat white, please.', status: 'picked' });
  assert.equal(picked.mode, 'picked');
  assert.equal(picked.text, 'A flat white, please.');
  assert.equal(picked.statusLabel, 'rehearsing');
  assert.equal(picked.canMarkSaidToday, true);

  const ready = resolveSentenceSlotView({ id: 'rs_1', text: 'Hi, I am Sam.', status: 'ready' });
  assert.equal(ready.statusLabel, 'feels ready to go outside');
  assert.equal(ready.canMarkSaidToday, true);

  // carried is shown but NOT re-markable (it's already carried).
  const carried = resolveSentenceSlotView({ id: 'rs_1', text: 'Table for two.', status: 'carried' });
  assert.equal(carried.mode, 'picked');
  assert.equal(carried.statusLabel, 'carried today');
  assert.equal(carried.canMarkSaidToday, false);
});

test('sentence text sanitize: trims + clamps to 120 chars', () => {
  assert.equal(REAL_SENTENCE_MAX_LEN, 120);
  assert.equal(sanitizeRealSentenceText('  hi  '), 'hi');
  assert.equal(sanitizeRealSentenceText('x'.repeat(200)).length, 120);
  assert.equal(sanitizeRealSentenceText(123 as unknown as string), '');
});

// --- time-lapse mirror: selection logic ------------------------------------
function ms(id: string, date: string, label = '', durationMs = 0): VoiceMilestone {
  return { id, date, label, attemptId: `att_${id}`, durationMs, metricsSummary: null };
}

test('mirror sanitize: keeps only well-formed entries, preserves order', () => {
  const raw = [ms('a', '2026-01-01'), null, { date: 'x' }, ms('b', '2026-02-01')];
  const clean = sanitizeMilestones(raw as unknown);
  assert.equal(clean.length, 2);
  assert.equal(clean[0].id, 'a');
  assert.equal(clean[1].id, 'b');
  assert.deepEqual(sanitizeMilestones('nope' as unknown), []);
});

test('mirror pair: <2 milestones -> null', () => {
  assert.equal(resolveMirrorPair([]), null);
  assert.equal(resolveMirrorPair([ms('a', '2026-01-01')]), null);
});

test('mirror pair: default = earliest vs latest (oldest-first list)', () => {
  const list = [ms('a', '2026-01-01'), ms('b', '2026-02-01'), ms('c', '2026-03-01')];
  const pair = resolveMirrorPair(list);
  assert.ok(pair);
  assert.equal(pair!.then.id, 'a');
  assert.equal(pair!.now.id, 'c');
  assert.equal(pair!.thenIndex, 0);
  assert.equal(pair!.nowIndex, 2);
});

test('mirror pair: two selections orient then(earlier)->now(later) regardless of pick order', () => {
  const list = [ms('a', '2026-01-01'), ms('b', '2026-02-01'), ms('c', '2026-03-01')];
  // User picks c as "then" and a as "now" -> resolver re-orients by list index.
  const pair = resolveMirrorPair(list, { thenId: 'c', nowId: 'a' });
  assert.ok(pair);
  assert.equal(pair!.then.id, 'a');
  assert.equal(pair!.now.id, 'c');
});

test('mirror pair: single selection pairs against the opposite extreme', () => {
  const list = [ms('a', '2026-01-01'), ms('b', '2026-02-01'), ms('c', '2026-03-01')];
  // Only "now" = b -> pair with earliest (a).
  let pair = resolveMirrorPair(list, { nowId: 'b' });
  assert.equal(pair!.then.id, 'a');
  assert.equal(pair!.now.id, 'b');
  // Only "then" = b -> pair with latest (c).
  pair = resolveMirrorPair(list, { thenId: 'b' });
  assert.equal(pair!.then.id, 'b');
  assert.equal(pair!.now.id, 'c');
  // Only "now" = a (the earliest) -> pair with latest, oriented a->c.
  pair = resolveMirrorPair(list, { nowId: 'a' });
  assert.equal(pair!.then.id, 'a');
  assert.equal(pair!.now.id, 'c');
});

test('mirror pair: identical/colliding selection nudges to a real pair', () => {
  const list = [ms('a', '2026-01-01'), ms('b', '2026-02-01'), ms('c', '2026-03-01')];
  // Same id for both -> never returns a self-pair.
  const pair = resolveMirrorPair(list, { thenId: 'b', nowId: 'b' });
  assert.ok(pair);
  assert.notEqual(pair!.then.id, pair!.now.id);
  // Unknown ids fall back to the default extremes.
  const fallback = resolveMirrorPair(list, { thenId: 'zzz', nowId: 'yyy' });
  assert.equal(fallback!.then.id, 'a');
  assert.equal(fallback!.now.id, 'c');
});

test('mirror header + row label: plain date arrow / date·label·dur, omit absent', () => {
  const list = [ms('a', '2026-01-01', 'first words'), ms('b', '2026-03-01', '', 4200)];
  assert.equal(mirrorPairHeader(resolveMirrorPair(list)), '2026-01-01 → 2026-03-01');
  assert.equal(mirrorPairHeader(null), '');
  assert.equal(milestoneRowLabel(list[0]), '2026-01-01 · first words');
  assert.equal(milestoneRowLabel(list[1]), '2026-03-01 · 4.2s');
  assert.equal(milestoneRowLabel(ms('c', '', '', 0)), '');
  // Honest/empty copy is the exact contract text.
  assert.match(MIRROR_HONEST_LINE, /center of the voice/i);
  assert.match(MIRROR_EMPTY_LINE, /one a week is plenty/i);
});

// --- take-finalize extras: defensive normalizers ----------------------------
test('guardian hint: only ease|close survive; absent/null/junk -> null (clears)', () => {
  assert.deepEqual(normalizeVoiceGuardianHint({ level: 'ease' }), { level: 'ease' });
  assert.deepEqual(normalizeVoiceGuardianHint({ level: 'close' }), { level: 'close' });
  assert.equal(normalizeVoiceGuardianHint(null), null);
  assert.equal(normalizeVoiceGuardianHint(undefined), null);
  assert.equal(normalizeVoiceGuardianHint({ level: 'panic' }), null);
  assert.equal(normalizeVoiceGuardianHint({}), null);
  // The ease hint is calm and leaks no alarm/banned word.
  assert.ok(!/score|points|level|streak/i.test(GUARDIAN_EASE_HINT));
});

test('pin suggestion: requires a non-empty attemptId', () => {
  assert.deepEqual(normalizeVoicePinSuggestion({ attemptId: 'att_9' }), { attemptId: 'att_9' });
  assert.equal(normalizeVoicePinSuggestion({ attemptId: '   ' }), null);
  assert.equal(normalizeVoicePinSuggestion(null), null);
  assert.equal(normalizeVoicePinSuggestion({}), null);
});

test('real-sentence readiness: coerces fields; absent -> null', () => {
  assert.equal(normalizeVoiceRealSentenceReadiness(null), null);
  const r = normalizeVoiceRealSentenceReadiness({ ready: true, takesToday: 2, heldRatio: 0.8, phrase: 'Hi.' });
  assert.deepEqual(r, { ready: true, takesToday: 2, heldRatio: 0.8, phrase: 'Hi.' });
  const r2 = normalizeVoiceRealSentenceReadiness({ ready: 'yes', takesToday: 'x', heldRatio: 'NaN', phrase: '' });
  // ready must be a strict boolean true (the string 'yes' is NOT true);
  // unparseable numbers ('x', 'NaN') -> null; blank phrase -> null.
  assert.deepEqual(r2, { ready: false, takesToday: null, heldRatio: null, phrase: null });
  // A literal JSON null coerces through Number(null)===0 -> 0 (the field is
  // present, just empty); only genuinely non-finite values become null.
  const r3 = normalizeVoiceRealSentenceReadiness({ ready: false, takesToday: 0, heldRatio: null, phrase: 'x' });
  assert.deepEqual(r3, { ready: false, takesToday: 0, heldRatio: 0, phrase: 'x' });
});
