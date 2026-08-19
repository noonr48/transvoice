'use strict';

// v3 adaptive coaching action — the app decides coach/adapt/breather/converse and the
// model renders it. Precedence: breather > converse > adapt > coach. See
// docs/ADAPTIVE-COACH-PLAN.md and policy-gates.js / signal-schema.js / renderer-client.js.

const { test } = require('node:test');
const assert = require('node:assert');

const { resolvePolicy, isMethodStalling } = require('./policy-gates');
const { buildCoachingSignal, isValidCoachingSignal, COACHING_ACTIONS } = require('./signal-schema');
const { buildRendererUserMessage } = require('./renderer-client');

test('policy: safety / fatigue / capture / reset -> breather', () => {
  assert.equal(resolvePolicy({ safetyState: 'stop' }).coachingAction, 'breather');
  assert.equal(resolvePolicy({ safetyState: 'fatigue_or_strain' }).coachingAction, 'breather');
  assert.equal(resolvePolicy({ safetyState: 'capture_only' }).coachingAction, 'breather');
  assert.equal(resolvePolicy({ practiceMode: 'safety_reset' }).coachingAction, 'breather');
});

// 2026-07-28 capture-latch usability gate: capture_only holds ONLY when the take
// was genuinely unusable (takeUsable omitted/false -> fail closed, the legacy
// behavior asserted above). A usable take falls through to the normal policy —
// including the misses>=2 adapt path — even in capture_only state.
test('policy: capture_only with a usable take falls through to coach/adapt', () => {
  const usable = resolvePolicy({ safetyState: 'capture_only', takeUsable: true });
  assert.equal(usable.coachingAction, 'coach');
  assert.equal(usable.shouldCorrect, true);
  // The adapt path is reachable again under the latch.
  const stalling = resolvePolicy({ safetyState: 'capture_only', takeUsable: true, consecutiveMisses: 2 });
  assert.equal(stalling.coachingAction, 'adapt');
  // A genuinely unusable capture still holds.
  const unusable = resolvePolicy({ safetyState: 'capture_only', takeUsable: false });
  assert.equal(unusable.coachingAction, 'breather');
  assert.equal(unusable.shouldCorrect, false);
  // Low/unusable capture reliability still holds regardless of the flag.
  assert.equal(resolvePolicy({ captureReliability: 'low', takeUsable: true }).coachingAction, 'breather');
  assert.equal(resolvePolicy({ captureReliability: 'unusable', takeUsable: true }).coachingAction, 'breather');
});

test('policy: chatting / planning -> converse', () => {
  assert.equal(resolvePolicy({ practiceMode: 'conversation_practice', userMessage: 'just chatting about my day' }).coachingAction, 'converse');
  assert.equal(resolvePolicy({ practiceMode: 'conversation_practice', userMessage: 'my cat is cute' }).coachingAction, 'converse');
  assert.equal(resolvePolicy({ practiceMode: 'lesson_plan' }).coachingAction, 'converse');
});

test('policy: method stalling (lexical or count) -> adapt', () => {
  assert.equal(resolvePolicy({ userMessage: "I tried that but it's still not working" }).coachingAction, 'adapt');
  assert.equal(resolvePolicy({ consecutiveMisses: 2 }).coachingAction, 'adapt');
  assert.equal(resolvePolicy({ practiceMode: 'conversation_practice', userMessage: 'help my pitch, I keep losing it' }).coachingAction, 'adapt');
});

test('policy: ordinary coaching turn -> coach', () => {
  assert.equal(resolvePolicy({ userMessage: 'how do I make my pitch higher?' }).coachingAction, 'coach');
  assert.equal(resolvePolicy({}).coachingAction, 'coach');
});

// The runtime derives practiceMode from keywords + safetyState from audio, so a TYPED
// venting/chatting turn arrives as active_drill + normal. These must still hold the cue.
test('policy: TYPED venting/chatting drives breather/converse in active_drill', () => {
  assert.equal(resolvePolicy({ userMessage: "I cannot do drills right now, I'm completely hollowed out" }).coachingAction, 'breather');
  assert.equal(resolvePolicy({ userMessage: 'Honestly I am spent, I just need a minute' }).coachingAction, 'breather');
  // coarse-correction trap: "don't want a fix ... my voice" trips isRequestingCorrection
  // on bare words, but the unconditional decline check must still yield breather.
  assert.equal(resolvePolicy({ userMessage: 'I do not want a fix tonight, I just need a minute before I think about my voice again' }).coachingAction, 'breather');
  assert.equal(resolvePolicy({ userMessage: 'Not a practice thing today — I just wanted to share some good news' }).coachingAction, 'converse');
  assert.equal(resolvePolicy({ userMessage: 'How has your day been?' }).coachingAction, 'converse');
});

test('policy: a genuine correction request stays a coaching action (never breather/converse)', () => {
  // The point: an explicit ask for help is never hijacked into a hold. coach vs adapt is
  // fine (a struggle-voiced request like "I can't do this" legitimately resolves to adapt).
  for (const m of ["help me fix my pitch, I can't do this", 'can you correct my resonance?', 'how do I make my voice brighter?']) {
    const a = resolvePolicy({ userMessage: m }).coachingAction;
    assert.ok(a === 'coach' || a === 'adapt', `${m} -> ${a} (expected coach or adapt)`);
  }
});

// Re-review false-positive guards: emotion words / "just finished a take" must NOT
// hijack a coaching turn into breather/converse.
test('policy: detectors do not hijack a genuine coaching turn', () => {
  const stillCoaches = [
    'I am exhausted but I want to fix my pitch.',
    'Feeling overwhelmed by all the cues, but help me focus on pitch.',
    'I am a bit burnt out — can you coach my onset anyway?',
    'I just finished my take, how was the pitch?',
    'Okay I just finished running it twice, what should I fix on my onset?',
  ];
  for (const m of stillCoaches) {
    const a = resolvePolicy({ userMessage: m }).coachingAction;
    assert.ok(a === 'coach' || a === 'adapt', `${m} -> ${a} (must stay coach/adapt)`);
  }
  // ...but a clear DECLINE still overrides the coarse fix+voice match.
  assert.equal(resolvePolicy({ userMessage: 'I do not want a fix tonight, I just need a minute before I think about my voice.' }).coachingAction, 'breather');
});

// v3.2 soft cues: DISTRESS (emotionally hit, often a misgendering moment) -> breather (a
// full hold, no cue). An explicit EASE-OFF ("go easy on me / be gentle with me / ease into
// it slowly") -> gentle (the learner wants to engage, just gently — a gentle coach, NOT a
// hold). Both yield to safety/decline, and must NOT fire on a voice note ("be gentle with
// my pitch", "my voice felt thrown off") or on "go easy on the brightness".
test('policy: distress idioms -> breather (full hold)', () => {
  const holds = [
    'Today knocked the wind out of me — a docent called me our facilities guy.',
    'I am thrown today; an attendee complained to the committee about me.',
  ];
  for (const m of holds) {
    assert.equal(resolvePolicy({ userMessage: m }).coachingAction, 'breather', `${m} -> expected breather`);
  }
});

test('policy: explicit ease-off -> gentle (engage gently, not a full hold)', () => {
  const gentle = [
    'Go easy on me — the phone is the part that scares me most.',
    'Be soft with me tonight, I am nervous about the long stretches.',
    'Can we ease into it slowly today? I am a little raw this morning.',
    'Take it slow with me today.',
    'How am I doing today? Be nice about it, I have had a rough week.',
    // 2026-07-28: bare slow-down asks — the learner wants to engage, gently.
    'Slow down.',
    'Say it slower.',
    'Say it slowly, please.',
    'Speak slower.',
    'Can you speak more slowly?',
  ];
  for (const m of gentle) {
    assert.equal(resolvePolicy({ userMessage: m }).coachingAction, 'gentle', `${m} -> expected gentle`);
  }
  // ease-off fires even WITH a correction request — gentle pitch help, not a normal push.
  assert.equal(resolvePolicy({ userMessage: 'Go easy on me, but help me with my pitch slide.' }).coachingAction, 'gentle');
  // a question-form ease-off must engage gently, NOT be read as casual chat (ease-off > converse).
  assert.equal(resolvePolicy({ userMessage: 'Can you go slow with the cues today?' }).coachingAction, 'gentle');
});

test('policy: spoken take-feedback follow-ups are coaching requests without repeating "voice"', () => {
  const requests = [
    'How am I doing?',
    'How did I do?',
    'How was that?',
    'How did that sound?',
    'What did you notice?',
    'Give me your read.',
    'Where do we start today? Keep it quick.',
    'What should we work on?',
    "What's next?",
    'Ready to practice.',
  ];
  for (const message of requests) {
    assert.equal(resolvePolicy({ userMessage: message }).coachingAction, 'coach', message);
  }
});

test('policy: ordinary chatting still -> converse (the reorder did not break it)', () => {
  assert.equal(resolvePolicy({ userMessage: 'Not a practice thing — I just wanted to share some good news!' }).coachingAction, 'converse');
  assert.equal(resolvePolicy({ userMessage: 'How has your day been?' }).coachingAction, 'converse');
});

// 2026-07-28: on take-bearing turns (the spoken path, where userMessage is the
// ASR transcript of the take itself) the casual/chat classifiers must not veto
// correction — question-form drill lines are drill content, not chit-chat.
test('policy: take-bearing turns bypass the casual/chat classifiers', () => {
  for (const m of ['How has your day been?', 'what time works for you?', 'do you want to try that again?']) {
    // Without a take: unchanged — question-form chat is converse.
    assert.equal(resolvePolicy({ userMessage: m }).coachingAction, 'converse', `${m} (no take)`);
    // With a fresh scored take: the same words are a drill line — coach.
    const onTake = resolvePolicy({ userMessage: m, takeUsable: true, hasUsableTake: true });
    assert.equal(onTake.coachingAction, 'coach', `${m} (take-bearing)`);
    assert.equal(onTake.shouldCorrect, true, `${m} (take-bearing)`);
  }
});

test('policy: soft-hold detectors do not hijack a coaching request', () => {
  const stillCoaches = [
    'Be gentle with my pitch feedback, but help me fix the onset.',
    'My voice felt thrown off at the end — how do I fix that pitch slide?',
    'Go easy on the brightness cue — what should I focus on for resonance?',
  ];
  for (const m of stillCoaches) {
    const a = resolvePolicy({ userMessage: m }).coachingAction;
    assert.ok(a === 'coach' || a === 'adapt', `${m} -> ${a} (must stay coach/adapt)`);
  }
});

test('isMethodStalling: catches "different way / no difference / still nothing"', () => {
  assert.equal(resolvePolicy({ userMessage: 'Still nothing — can we come at this a totally different way?' }).coachingAction, 'adapt');
  assert.equal(resolvePolicy({ userMessage: 'that makes no difference no matter how I try it' }).coachingAction, 'adapt');
});

test('policy: precedence — safety beats stalling', () => {
  assert.equal(resolvePolicy({ safetyState: 'stop', userMessage: 'still not working' }).coachingAction, 'breather');
});

test('isMethodStalling: lexical struggle vs clean vs count', () => {
  assert.equal(isMethodStalling("that didn't help"), true);
  assert.equal(isMethodStalling('great, what next?'), false);
  assert.equal(isMethodStalling('', 2), true);
  assert.equal(isMethodStalling('', 1), false);
});

test('schema: defaults to coach, carries + validates coachingAction', () => {
  assert.equal(buildCoachingSignal().policy.coachingAction, 'coach');
  const sig = buildCoachingSignal({ policy: { coachingAction: 'adapt' } });
  assert.equal(sig.policy.coachingAction, 'adapt');
  assert.equal(isValidCoachingSignal(sig), true);
  const bad = buildCoachingSignal();
  bad.policy.coachingAction = 'nonsense';
  assert.equal(isValidCoachingSignal(bad), false);
  assert.deepEqual(COACHING_ACTIONS, ['coach', 'gentle', 'adapt', 'breather', 'converse']);
});

test('renderer: emits the matching Action directive per action', () => {
  const map = { coach: 'COACH', adapt: 'ADAPT', breather: 'BREATHER', converse: 'CONVERSE' };
  for (const [action, kw] of Object.entries(map)) {
    const msg = buildRendererUserMessage(buildCoachingSignal({ policy: { coachingAction: action } }));
    assert.ok(msg.includes('Action: ' + kw), `expected "Action: ${kw}" for ${action}`);
  }
  const breatherMsg = buildRendererUserMessage(buildCoachingSignal({ policy: { coachingAction: 'breather' } }));
  assert.match(breatherMsg, /easy, low-effort coordination/i);
  assert.match(breatherMsg, /Do not recommend a pause, rest, or end/i);
  // 2026-07-28: ADAPT says WHY the approach is changing and never suggests
  // imagery (the old "DIFFERENT angle or metaphor" contradicted the imagery ban).
  const adaptMsg = buildRendererUserMessage(buildCoachingSignal({ policy: { coachingAction: 'adapt' } }));
  assert.match(adaptMsg, /name what isn't landing/i);
  assert.doesNotMatch(adaptMsg, /metaphor/i);
});
