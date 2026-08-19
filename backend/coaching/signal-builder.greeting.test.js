'use strict';

// Voice-only Coach entry contract: continuity is structured state, not an
// automatic greeting, warm-up, scope question, or message thread.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSignal,
  buildContinuityGreeting,
  resolveSessionScope,
  resolveRingTierForDaypart,
  daypartOf,
  COACH_ENTRY_POLICY,
} = require('./signal-builder');

// Local-time anchors (daypart uses local hours).
const MORNING = new Date(2026, 6, 19, 9, 0, 0).getTime();   // morning
const EVENING = new Date(2026, 6, 18, 20, 0, 0).getTime();  // evening (previous day)
const MORNING_PRIOR = new Date(2026, 6, 12, 8, 30, 0).getTime(); // morning, a week earlier

// Owner-law regexes. TIME-BLIND bans duration/timer vocabulary ("last time" as
// a session reference is allowed; clock/duration words are not). Zero props
// bans object suggestions.
const TIME_WORDS = /\b(minutes?|mins?|seconds?|secs?|hours?|timers?|countdown|clock|stopwatch|duration|time left|time's up|out of time|how long)\b/i;
const PROP_WORDS = /\b(straws?|pencils?|spoons?|candles?|tissues?|mirrors?|balloons?|kazoos?|cup of)\b/i;

function ringEntry(overrides = {}) {
  return { date: '2026-07-18', startedAt: EVENING, takes: 4, focusAxis: 'resonance', ...overrides };
}

test('Coach entry is silent and resumes core practice without greeting or warm-up padding', () => {
  const ctx = {
    profile: { displayName: 'Mara' },
    sessions: [ringEntry({ endReason: 'completed' }), ringEntry({ endReason: 'cut-short', at: EVENING })],
    lastSessionAt: Date.now() - 30 * 86400000,
    whatWorked: ['Forward resonance landed'],
  };
  const greeting = buildContinuityGreeting(ctx, { now: MORNING });
  assert.equal(greeting.entryPolicy, COACH_ENTRY_POLICY);
  assert.equal(greeting.autoSpeak, false);
  assert.equal(greeting.line1, '');
  assert.equal(greeting.line2, '');
  assert.equal(greeting.scopeAsk, null);
  assert.deepEqual(greeting.lines, []);
  assert.equal(greeting.text, '');
  assert.equal(greeting.witness.line2Branch, 'disabled-voice-only-entry');
});

test('legacy daypart memory may seed technique scope without producing entry speech', () => {
  const ctx = { sessions: [ringEntry({ tier: 'quiet', at: MORNING_PRIOR, endReason: 'completed' })] };
  const greeting = buildContinuityGreeting(ctx, { now: MORNING });
  assert.equal(greeting.scopeAsk, null);
  assert.equal(greeting.tierDefault, 'quiet');
  assert.deepEqual(greeting.lines, []);
});

test('ring tier daypart recall: newest matching entry wins; junk entries skipped', () => {
  assert.equal(daypartOf(MORNING), 'morning');
  assert.equal(daypartOf(EVENING), 'evening');
  const sessions = [
    ringEntry({ tier: 'silent', at: MORNING_PRIOR }),
    { bogus: true },
    ringEntry({ tier: 'quiet', at: MORNING_PRIOR + 3600000 }),
    ringEntry({ tier: 'full', at: EVENING }), // different daypart — ignored
  ];
  assert.equal(resolveRingTierForDaypart(sessions, MORNING), 'quiet');
  assert.equal(resolveRingTierForDaypart([], MORNING), null);
  assert.equal(resolveRingTierForDaypart([ringEntry({ tier: 'loud', at: MORNING_PRIOR })], MORNING), null);
});

test('resolveSessionScope priority: explicit > voiceState > ring-default > default', () => {
  const learnerContext = { sessions: [ringEntry({ tier: 'quiet', at: MORNING_PRIOR })] };
  const explicit = resolveSessionScope({
    sessionScope: { tier: 'silent', eyesFree: true },
    voiceState: { sessionScope: { tier: 'full' } },
    learnerContext,
    now: MORNING,
  });
  assert.deepEqual(explicit, { tier: 'silent', eyesFree: true, source: 'explicit' });

  const fromState = resolveSessionScope({
    voiceState: { sessionScope: { tier: 'quiet', eyesFree: false } },
    learnerContext,
    now: MORNING,
  });
  assert.deepEqual(fromState, { tier: 'quiet', eyesFree: false, source: 'voice-state' });

  const ringDefault = resolveSessionScope({ learnerContext, now: MORNING });
  assert.deepEqual(ringDefault, { tier: 'quiet', eyesFree: false, source: 'ring-default' });

  const bare = resolveSessionScope({ now: MORNING });
  assert.deepEqual(bare, { tier: 'full', eyesFree: false, source: 'default' });
});

test('buildSignal exposes the chosen/default tier to the renderer', () => {
  const learnerContext = { sessions: [ringEntry({ tier: 'quiet', at: MORNING_PRIOR })] };
  const ringSignal = buildSignal({ voiceState: {}, learnerContext, now: MORNING });
  assert.deepEqual(ringSignal.sessionScope, { tier: 'quiet', eyesFree: false, source: 'ring-default' });
  const explicitSignal = buildSignal({
    voiceState: {},
    learnerContext,
    sessionScope: { tier: 'silent', eyesFree: true },
    now: MORNING,
  });
  assert.equal(explicitSignal.sessionScope.tier, 'silent');
  assert.equal(explicitSignal.sessionScope.eyesFree, true);
  assert.equal(explicitSignal.decisionWitness.sessionScope.source, 'explicit');
});

test('silent entry cannot contain time, prop, greeting, warm-up, or scope-question copy', () => {
  const greeting = buildContinuityGreeting({}, { now: MORNING });
  assert.doesNotMatch(greeting.text, TIME_WORDS);
  assert.doesNotMatch(greeting.text, PROP_WORDS);
  assert.doesNotMatch(greeting.text, /welcome|warm[- ]?up|speak freely|quiet\?/i);
});
