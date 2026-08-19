'use strict';

// ---------------------------------------------------------------------------
// CUE CARRY-FORWARD (2026-07-30) — "name what worked", end to end.
//
// The tutor already chose a cue with a stable identity every turn
// (coaching/signal-builder.recommendDrillForFocus -> { id, instruction, ... })
// and then threw it away, so when a take finally landed the win line reached
// for one of four fixed sentences picked by FRESHNESS. She was told THAT it
// worked and never WHAT worked.
//
// This file proves the one link that fixes it, at every joint it crosses:
//   1. the voice-state field normalizes and fails closed;
//   2. the runtime STAMPS it at the end of a coach turn, and CLEARS it on a
//      turn that gave no cue;
//   3. buildSignal READS it back one turn later as signal.previousCue;
//   4. composeAcknowledgeWin NAMES the action, falls back cleanly when it
//      cannot, and never claims the cue CAUSED the improvement;
//   5. the whole chain runs through the real coach path, both routes.
//
// Everything here drives the production functions. The one hand-built object is
// the analyzer take summary, which is the runtime's own input, and even that is
// immediately fed through the real coach turn rather than asserted against.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createVoiceStandaloneRuntime } = require('./voice-standalone-runtime');
const { PracticeCardStore } = require('./lessons/practice-cards');
const { buildSignal, recommendDrillForFocus } = require('./coaching/signal-builder');
const { buildDirectReply, WIN_CUE_ACTIONS } = require('./coaching/direct-reply');
const {
  sanitizeCoachReply,
  sanitizeUnsupportedWinCausation,
} = require('./coaching/sanitizer');
const {
  buildRendererMessages,
  buildRendererUserMessage,
} = require('./coaching/renderer-client');
const { buildCoachingSignal, isValidCoachingSignal, FOCUS_AXES } = require('./coaching/signal-schema');

const SESSION_STARTED_AT = 1_700_000_000_000;
const PHRASE = 'The quick brown fox ran';

const TARGET = Object.freeze({
  source: 'preset',
  targetPreset: 'cute-feminine',
  direction: 'feminine',
  pitchFloorHz: 188,
  pitchCeilingHz: 255,
  resonanceFloor: 0.32,
  resonanceCeiling: 1,
  weightFloor: 0,
  weightCeiling: 0.4,
  minTargetHitPct: 0.28,
});

/**
 * A usable take sitting flat under the pitch band — the shape that resolves
 * primaryFocus 'pitch_floor' and therefore the 'starter-light-lift' cue. Same
 * canonical metric names the metric contract reads (meanPitchHz /
 * resonanceMean / weightMean); the legacy spellings are silently ignored there
 * and would leave every axis 'uncertain' with no drill at all.
 */
function takeState({
  finalizedAt = SESSION_STARTED_AT + 5_000,
  meanPitchHz = 130,
  targetHitPct = 0.05,
} = {}) {
  const timeline = [];
  for (let i = 0; i < 100; i += 1) {
    timeline.push({
      t: Math.round((i / 99) * 2000),
      voiced: true,
      pitchHz: meanPitchHz,
      resonanceScore: 0.6,
      weightScore: 0.2,
      confidence: 0.9,
    });
  }
  const advanced = {
    measurementAvailable: true,
    sampleCount: 100,
    voicedFramePct: 1,
    confidentFramePct: 0.95,
    scoreConfidence: 0.9,
    captureReliability: 0.9,
    snrDb: 24,
    clippingPct: 0,
    pitchValidFrameCount: 100,
    medianPitchHz: meanPitchHz,
    pitchP10Hz: meanPitchHz - 8,
    pitchP90Hz: meanPitchHz + 8,
  };
  const metrics = {
    meanPitchHz, resonanceMean: 0.6, weightMean: 0.2, targetHitPct, advanced,
  };
  return {
    sessionStartedAt: SESSION_STARTED_AT,
    targetPreset: 'cute-feminine',
    targetSource: 'built-in',
    lastTakeFinalizedAt: finalizedAt,
    lastSummary: {
      voiceSessionId: 'vs-cue',
      durationMs: 2000,
      targetPreset: 'cute-feminine',
      target: { ...TARGET },
      metrics,
      issues: [],
    },
    lastAttemptArtifact: {
      attemptId: `aa-${finalizedAt}`,
      voiceSessionId: 'vs-cue',
      finalizedAt,
      target: { ...TARGET },
      metrics,
      durationMs: 2000,
      timeline,
    },
    voiceInputRuntime: { previousInputTurnAt: SESSION_STARTED_AT + 1_000 },
  };
}

function modelReply(text) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Map([['content-type', 'application/json']]),
    async text() { return JSON.stringify({ choices: [{ message: { content: text } }] }); },
    async json() { return { choices: [{ message: { content: text } }] }; },
  };
}

function harness({ modelText = 'Keep the jaw loose and start the first word softly.' } = {}) {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'transvoice-cue-carry-'));
  const logLines = [];
  const practiceCards = new PracticeCardStore();
  const runtime = createVoiceStandaloneRuntime({
    stateRoot,
    disableSessionPersistence: true,
    learnerContextRoot: path.join(stateRoot, 'learner-context'),
    practiceCards,
    logger: { log: (line) => logLines.push(line), warn() {}, error() {} },
    fetchImpl: async (url) => {
      if (String(url).includes('/chat/completions')) return modelReply(modelText);
      throw new Error(`unexpected fetch: ${url}`);
    },
  });
  return {
    runtime,
    practiceCards,
    lines: (event) => logLines.filter((line) => line?.event === event),
    cleanup: () => { try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

async function armed(h, voiceState) {
  const started = await h.runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: `cue-${Math.random().toString(16).slice(2)}`,
    studentId: 'cue-carry-user',
  });
  const sessionId = started.sessionId;
  const session = h.runtime.sessions.get(sessionId);
  session.agentId = 'voice';
  session.voiceState = { ...session.voiceState, ...voiceState };
  h.practiceCards.createCard(sessionId, {
    phrase: PHRASE, source: 'tutor', targetPreset: 'cute-feminine',
  });
  return sessionId;
}

/** A win-turn signal built through the real schema builder, not a hand-rolled object. */
function winSignal({ previousCue = null, trend = 'improving', last3TakeSummary = '' } = {}) {
  return buildCoachingSignal({
    coachingDecision: { intent: 'acknowledge_win', primaryFocus: 'pitch_floor' },
    coachMove: { intent: 'acknowledge_win' },
    policy: { coachingAction: 'coach', shouldCorrect: true, avoidTopics: [] },
    history: { last3TakeSummary, trend },
    practiceLine: 'how was your day',
    takeKind: 'phrase',
    previousCue,
  });
}

// ---------------------------------------------------------------------------
// 1. The voice-state field
// ---------------------------------------------------------------------------

test('voice state: lastCueGiven normalizes to the documented shape and fails closed', () => {
  const h = harness();
  const { normalizeVoiceState } = h.runtime.voiceStateRuntime;
  try {
    assert.equal(normalizeVoiceState({}).lastCueGiven, null, 'absent by default');

    const kept = normalizeVoiceState({
      lastCueGiven: {
        id: '  starter-light-lift  ',
        axis: 'pitch_floor',
        instruction: `  ${'x'.repeat(400)}  `,
        bogusExtraKey: 'dropped',
      },
    }).lastCueGiven;
    assert.deepEqual(Object.keys(kept).sort(), ['axis', 'id', 'instruction']);
    assert.equal(kept.id, 'starter-light-lift', 'trimmed');
    assert.equal(kept.axis, 'pitch_floor');
    assert.equal(kept.instruction.length, 240, 'capped like its normalizeVoiceText neighbours');

    // Fail-closed: no id means nothing can be NAMED later, so it is not a cue.
    for (const bad of [null, 'starter-light-lift', ['starter-light-lift'], { axis: 'pitch_floor' }, { id: '   ' }]) {
      assert.equal(normalizeVoiceState({ lastCueGiven: bad }).lastCueGiven, null, JSON.stringify(bad));
    }
    // An id with no instruction is still a usable identity.
    assert.deepEqual(
      normalizeVoiceState({ lastCueGiven: { id: 'starter-easy-hum' } }).lastCueGiven,
      { id: 'starter-easy-hum', axis: null, instruction: '' },
    );
  } finally {
    h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 2. The runtime stamp
// ---------------------------------------------------------------------------

test('runtime: stampLastCueGiven records this turn\'s cue and clears on a turn that gave none', async (t) => {
  const h = harness();
  t.after(h.cleanup);
  const sessionId = await armed(h, takeState());
  const session = h.runtime.sessions.get(sessionId);

  const drill = recommendDrillForFocus('resonance_forward', '', null, null);
  const stamped = h.runtime.stampLastCueGiven(session, {
    coachingDecision: { primaryFocus: 'resonance_forward', recommendedDrill: drill },
  });
  assert.deepEqual(stamped, {
    id: drill.id, axis: 'resonance_forward', instruction: drill.instruction,
  });
  assert.deepEqual(session.voiceState.lastCueGiven, stamped, 'it went through the normalizer onto the state');

  // The engine's LATEST word wins: a turn recommending nothing must not leave a
  // stale cue standing, or the win line would name something several turns old.
  assert.equal(
    h.runtime.stampLastCueGiven(session, { coachingDecision: { primaryFocus: 'none', recommendedDrill: recommendDrillForFocus('none', '', null, null) } }),
    null,
  );
  assert.equal(session.voiceState.lastCueGiven, null, 'cleared');
  assert.equal(h.lines('coach_cue_carry_cleared').length, 1);

  // An empty/errored signal clears too — the safe direction (we lose one named
  // win line; we never invent one).
  h.runtime.stampLastCueGiven(session, { coachingDecision: { primaryFocus: 'vocal_weight', recommendedDrill: recommendDrillForFocus('vocal_weight', '', null, null) } });
  assert.ok(session.voiceState.lastCueGiven);
  h.runtime.stampLastCueGiven(session, null);
  assert.equal(session.voiceState.lastCueGiven, null);
});

test('runtime: a REAL buffered coach turn stamps the cue, and the NEXT turn reads it back', async (t) => {
  const h = harness();
  t.after(h.cleanup);
  const sessionId = await armed(h, takeState());

  const first = await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId, message: 'how did that sound',
  });
  const firstSignal = first?.payload?.coachingSignal || first?.coachingSignal;
  assert.ok(firstSignal, 'the turn produced a signal');
  assert.equal(firstSignal.previousCue, null, 'nothing was carried into the FIRST turn');

  const carried = h.runtime.sessions.get(sessionId).voiceState.lastCueGiven;
  assert.ok(carried, 'the coach turn persisted the cue it gave');
  assert.equal(carried.id, firstSignal.coachingDecision.recommendedDrill.id);
  assert.equal(carried.instruction, firstSignal.coachingDecision.recommendedDrill.instruction);
  assert.equal(carried.axis, firstSignal.coachingDecision.primaryFocus);
  assert.deepEqual(h.lines('coach_cue_carried').at(-1), {
    event: 'coach_cue_carried', cue_id: carried.id, axis: carried.axis,
  });

  const second = await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId, message: 'how did that sound',
  });
  const secondSignal = second?.payload?.coachingSignal || second?.coachingSignal;
  assert.deepEqual(secondSignal.previousCue, carried, 'turn 2 sees turn 1\'s cue');
  // ...and it is NOT the same object as this turn's own drill decision.
  assert.notEqual(secondSignal.previousCue, secondSignal.coachingDecision.recommendedDrill);
});

test('runtime: a real model-authored win turn names the carried cue on the learner-facing path', async (t) => {
  const modelText = 'That landed. You were starting the words on a small "mm" hum — keep that going.';
  const h = harness({ modelText });
  t.after(h.cleanup);
  const sessionId = await armed(h, takeState());

  await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId, message: 'how did that sound',
  });
  const session = h.runtime.sessions.get(sessionId);
  const carried = session.voiceState.lastCueGiven;
  assert.equal(carried?.id, 'starter-light-lift');

  session.voiceState = {
    ...session.voiceState,
    ...takeState({
      // Praise evidence is wall-clock bounded; the file-wide historical fixture
      // is intentionally stale, so this genuine win turn needs a fresh artifact.
      finalizedAt: Date.now(),
      meanPitchHz: 210,
      targetHitPct: 0.8,
    }),
    lastCueGiven: carried,
  };
  const second = await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    message: 'Give me one concise post-take coaching note for the latest voice attempt.',
  });
  const signal = second?.payload?.coachingSignal || second?.coachingSignal;
  const learnerReply = second?.payload?.coachMessage || second?.coachMessage;

  assert.equal(signal?.coachingDecision?.intent, 'acknowledge_win');
  assert.deepEqual(signal?.previousCue, carried);
  assert.equal(learnerReply, modelText, 'the actual model text crosses the live sanitizer unchanged');
});

test('runtime: the STREAMING coach path stamps the cue too', async () => {
  const sessions = new Map();
  const sessionId = 'cue-carry-stream';
  sessions.set(sessionId, {
    id: sessionId,
    agentId: 'voice',
    studentId: 'cue-carry-stream-learner',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    mode: 'voice',
    voiceState: takeState(),
  });
  const modelStream = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: 'Keep the jaw loose and start the first word softly.' } }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  const runtime = createVoiceStandaloneRuntime({
    sessions,
    learnerContextService: { getVoiceStudentModelSnapshot: async () => ({ learnerContext: {} }) },
    logger: false,
    fetchImpl: async () => new Response(modelStream, {
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
    }),
  });
  const res = { writeHead() {}, write() {}, end() {} };

  await runtime.generateRealtimeCoachReplyStreaming(sessions.get(sessionId), 'how did that sound', res);

  const carried = sessions.get(sessionId).voiceState.lastCueGiven;
  assert.ok(carried, 'the streaming path must stamp the same record as the buffered one');
  assert.equal(carried.id, 'starter-light-lift');
  assert.equal(carried.axis, 'pitch_floor');
});

// ---------------------------------------------------------------------------
// 3. The signal read-back
// ---------------------------------------------------------------------------

test('buildSignal: voiceState.lastCueGiven surfaces as previousCue, separate from this turn\'s drill', () => {
  const h = harness();
  try {
    const carried = { id: 'starter-nasal-buzz', axis: 'resonance_forward', instruction: 'Hum the line on "m" or "n" first.' };
    const voiceState = h.runtime.voiceStateRuntime.normalizeVoiceState({
      ...takeState(), lastCueGiven: carried,
    });
    const signal = buildSignal({
      voiceState, userMessage: '', practiceMode: 'guided', targetPreset: 'cute-feminine',
    });
    assert.deepEqual(signal.previousCue, carried);
    assert.ok(isValidCoachingSignal(signal), 'the signal is still structurally valid');
    // THIS turn's drill is a different axis and a different object: the take is a
    // pitch-floor miss, the carried cue was a resonance cue.
    assert.equal(signal.coachingDecision.primaryFocus, 'pitch_floor');
    assert.notEqual(signal.coachingDecision.recommendedDrill.id, signal.previousCue.id);

    // No carried cue -> the field is absent, never a guess.
    const bare = buildSignal({
      voiceState: h.runtime.voiceStateRuntime.normalizeVoiceState(takeState()),
      userMessage: '', practiceMode: 'guided', targetPreset: 'cute-feminine',
    });
    assert.equal(bare.previousCue, null);
    assert.ok(isValidCoachingSignal(bare));
  } finally {
    h.cleanup();
  }
});

test('signal schema: previousCue is optional, id-gated, and validated when present', () => {
  assert.equal(buildCoachingSignal({}).previousCue, null);
  assert.equal(buildCoachingSignal({ previousCue: { axis: 'pitch_floor' } }).previousCue, null, 'no id, no cue');
  assert.deepEqual(
    buildCoachingSignal({ previousCue: { id: 'starter-easy-hum' } }).previousCue,
    { id: 'starter-easy-hum', axis: null, instruction: '' },
  );
  const signal = buildCoachingSignal({});
  signal.previousCue = { id: '   ' };
  assert.equal(isValidCoachingSignal(signal), false, 'a cue with no nameable id is not valid');
  signal.previousCue = { id: 'starter-easy-hum' };
  assert.equal(isValidCoachingSignal(signal), true);
});

// ---------------------------------------------------------------------------
// 4. The win line
// ---------------------------------------------------------------------------

test('win line: the previous cue is NAMED instead of a stock next step', () => {
  const text = buildDirectReply(winSignal({
    previousCue: { id: 'starter-light-lift', axis: 'pitch_floor', instruction: 'irrelevant here' },
    trend: 'uncertain',
  }), {});
  assert.equal(text, 'That landed. You were starting the words on a small "mm" hum — keep that going.');
  // The action, not a stock sentence.
  assert.doesNotMatch(text, /same mouth shape|same loose jaw|easy start on the first word|jaw just as loose/);
});

test('win line: it names each code-owned cue in the learner\'s own action terms', () => {
  const cases = [
    ['starter-light-onset', /starting each word softly instead of pressing/],
    ['starter-nasal-buzz', /humming first and keeping that buzz on your lips/],
    ['starter-slowdown', /saying it slowly and letting the jaw finish each word/],
    ['starter-lift-end', /keeping the lips and jaw moving to the last word/],
  ];
  for (const [id, expected] of cases) {
    const signal = winSignal({ previousCue: { id, axis: 'x', instruction: '' }, trend: 'uncertain' });
    const text = buildDirectReply(signal, {});
    assert.match(text, expected, id);
    assert.match(text, /you were /i, `${id}: phrased as what she was doing`);
    // The law that matters most: a violating sentence is DROPPED at runtime, so
    // a composed win line must cross the sanitizer untouched.
    assert.equal(sanitizeCoachReply(text, signal), text, `${id}: not law-clean`);
  }
});

test('win line: CO-OCCURRENCE only — it never claims the cue caused the improvement', () => {
  // At one attempt the cue and the improvement co-occurred; nothing more can be
  // claimed. She may simply have warmed up, and this product's learners are
  // quick to conclude they are doing it wrong, so a false causal claim is worse
  // than a vague one.
  const CAUSAL = /\bbecause\b|\bcaused?\b|\bdid it\b|\bthanks to\b|\bthat(?:'s| is) why\b|\bso it worked\b|\bmade it work\b|\bworked because\b|\bthat did\b/i;
  const thread = [];
  for (const id of Object.keys(WIN_CUE_ACTIONS)) {
    for (const trend of ['improving', 'flat', 'fatiguing', 'uncertain']) {
      const signal = winSignal({ previousCue: { id, axis: 'x', instruction: '' }, trend });
      const text = buildDirectReply(signal, { conversationHistory: thread.slice(-3) });
      assert.doesNotMatch(text, CAUSAL, `${id}/${trend}: causal claim in "${text}"`);
      thread.push({ role: 'assistant', content: text });
    }
  }
  // And every frame in the rotation, not just the first.
  const framed = new Set();
  const rolling = [];
  for (let i = 0; i < 4; i += 1) {
    const signal = winSignal({ previousCue: { id: 'starter-light-onset', axis: 'x', instruction: '' } });
    const text = buildDirectReply(signal, { conversationHistory: rolling });
    assert.doesNotMatch(text, CAUSAL, text);
    framed.add(text);
    rolling.push({ role: 'assistant', content: text });
  }
  assert.equal(framed.size, 4, 'the named-cue tail rotates rather than repeating one sentence');
});

test('model renderer: an acknowledge_win prompt names the carried action and forbids causal promotion', () => {
  const signal = winSignal({
    previousCue: { id: 'starter-light-lift', axis: 'pitch_floor', instruction: 'ignored full instruction' },
  });
  const user = buildRendererUserMessage(signal);
  const [system] = buildRendererMessages(signal);

  assert.match(user, /PreviousCueAction: starting the words on a small "mm" hum/);
  assert.match(user, /never that it caused the win/i);
  assert.match(system.content, /co-occurrence, not cause/i);
  assert.match(system.content, /explicitly name that exact action/i);

  const unknown = buildRendererUserMessage(winSignal({
    previousCue: { id: 'registry-drill-42', axis: 'pitch_floor', instruction: 'do not truncate this' },
  }));
  assert.doesNotMatch(unknown, /PreviousCueAction:/, 'unknown cue ids fail closed rather than being guessed');
  assert.doesNotMatch(unknown, /do not truncate this/);
});

test('model safety boundary: keeps named co-occurrence and drops only unsupported causation', () => {
  const signal = winSignal({
    previousCue: { id: 'starter-light-lift', axis: 'pitch_floor', instruction: '' },
  });
  const safe = 'That landed. You were starting the words on a small "mm" hum — keep that going.';
  assert.equal(sanitizeCoachReply(safe, signal), safe, 'non-causal cue naming survives verbatim');

  const complianceWitness = {};
  const repairedOmission = sanitizeCoachReply(
    'That was a great start! Now, try to keep your tongue high and forward as you finish the sentence.',
    signal,
    { witness: complianceWitness },
  );
  assert.match(repairedOmission, /You were starting the words on a small "mm" hum — keep that going\./i);
  assert.match(repairedOmission, /That was a great start!/i, 'one safe model-authored acknowledgement survives');
  assert.doesNotMatch(repairedOmission, /tongue high and forward/i, 'an unrelated model action is replaced');
  assert.equal(complianceWitness.previousCueAcknowledgementRepaired, true);
  assert.ok(repairedOmission.split(/(?<=[.!?])\s+/).length <= 2);

  const requiredAction = /You were starting the words on a small "mm" hum — keep that going\./i;
  assert.match(
    sanitizeCoachReply(
      'That landed. Nice work. You were starting the words on a small "mm" hum — keep that going.',
      signal,
    ),
    requiredAction,
    'the spoken two-sentence clamp cannot discard a third-sentence acknowledgement',
  );
  assert.match(
    sanitizeCoachReply('That landed. You were starting the words on a small "mm" hum — keep that going.', {
      ...signal,
      personalization: { preferencePolicy: { maxSpokenWords: 8 } },
    }),
    requiredAction,
    'the finite acknowledgement outranks a smaller generic spoken-word budget',
  );
  assert.match(
    sanitizeCoachReply('', signal),
    requiredAction,
    'an empty model reply still crosses the known-cue learner-facing postcondition',
  );
  assert.equal(
    sanitizeCoachReply('', winSignal({ previousCue: { id: 'registry-drill-42', axis: 'pitch_floor', instruction: '' } })),
    '',
    'an empty reply with an unknown cue id still fails closed',
  );
  assert.match(
    sanitizeCoachReply('That landed due to you starting the words on a small "mm" hum.', signal),
    requiredAction,
    'a lexical action mention inside a causal frame is not accepted as compliance',
  );

  const witness = {};
  const raw = 'That take landed because you used the small "mm" hum. Keep starting the words on that small "mm" hum.';
  const filtered = sanitizeCoachReply(raw, signal, { witness });
  assert.doesNotMatch(filtered, /\bbecause\b/i);
  assert.match(filtered, /You were starting the words on a small "mm" hum — keep that going\./);
  assert.deepEqual(witness.unsupportedCausationHits, ['unsupported_single_take_causation']);

  const oneSentence = sanitizeCoachReply('The hum made that take work.', signal);
  assert.doesNotMatch(oneSentence, /made that take work/i, 'an all-causal reply fails closed to a safe action');
  const causalPredicate = sanitizeCoachReply(
    'The hum was the reason the take landed. Keep your jaw loose and start softly again.',
    signal,
  );
  assert.doesNotMatch(causalPredicate, /was the reason/i);
  assert.match(causalPredicate, requiredAction, 'the final learner boundary keeps co-occurrence but removes causal predicates');

  for (const causal of [
    'Starting each word softly did it.',
    'Starting each word softly made it work.',
    'Starting each word softly caused the improvement.',
    'Starting each word softly is why it landed.',
    'That is what did it.',
    'That made it work.',
    'You did it because of the hum.',
    'We did it thanks to the hum.',
    'That landed due to the hum.',
    'The take improved owing to the hum.',
    'The hum helped that take land.',
    'The hum got you there.',
    'That cue paid off.',
    'The hum was the reason the take landed.',
    'The hum was responsible for the improvement.',
    'It landed not just because of the hum.',
  ]) {
    const actionSubject = sanitizeUnsupportedWinCausation(
      `${causal} Keep the jaw loose and start softly again.`,
      signal,
      { replacement: '' },
    );
    assert.equal(actionSubject.hits[0], 'unsupported_single_take_causation', causal);
    assert.doesNotMatch(actionSubject.text, new RegExp(causal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    assert.match(actionSubject.text, /Keep the jaw loose/i);
  }

  for (const explicitDenial of [
    'It landed, but not because of the hum; you were using it — keep that going.',
    "It landed, but it wasn't because of the hum; you were using it — keep that going.",
    'It landed, not thanks to the hum; you were using it — keep that going.',
    "It wasn't the hum that made it work; you were using it — keep that going.",
    'You did it. You were starting softly — keep that going.',
    'You really did it. You were starting softly — keep that going.',
  ]) {
    assert.equal(
      sanitizeUnsupportedWinCausation(explicitDenial, signal, { replacement: '' }).text,
      explicitDenial,
      'an explicit denial of causation remains valid co-occurrence wording',
    );
  }

  const mixedPolarity = sanitizeUnsupportedWinCausation(
    'It landed not because of the hum but because you started each word softly.',
    signal,
    { replacement: '' },
  );
  assert.equal(mixedPolarity.hits[0], 'unsupported_single_take_causation');
  const mixedCleft = sanitizeUnsupportedWinCausation(
    "It wasn't because of the hum that the take landed; it was because you started softly.",
    signal,
    { replacement: '' },
  );
  assert.equal(mixedCleft.hits[0], 'unsupported_single_take_causation');

  const nonWin = { ...signal, coachingDecision: { ...signal.coachingDecision, intent: 'single_actionable_cue' } };
  assert.equal(
    sanitizeUnsupportedWinCausation(raw, nonWin, { replacement: '' }).text,
    raw,
    'the causal filter is scoped to acknowledge_win only',
  );
});

test('win line: no per-attempt number is quoted when the cue is named', () => {
  const text = buildDirectReply(winSignal({
    previousCue: { id: 'starter-light-lift', axis: 'pitch_floor', instruction: '' },
    last3TakeSummary: 't1: 158Hz/60% · t2: 165Hz/65%',
  }), {});
  assert.doesNotMatch(text, /\d/, `per-attempt figures are unreliable individually: "${text}"`);
});

test('win line: falls back to the stock line with no prior cue, or an unknown cue id', () => {
  const stock = /Say it again with that same mouth shape|same loose jaw|same easy start on the first word|jaw just as loose/;
  const noCue = buildDirectReply(winSignal({ previousCue: null, last3TakeSummary: 't1: 158Hz/60% · t2: 165Hz/65%' }), {});
  assert.match(noCue, stock, 'first turn / no cue given: unchanged behavior');
  assert.match(noCue, /last take 158 Hz, this one 165/, 'the stock branch keeps its comparison clause');

  // A drill-registry pick with no written action clause must NOT be guessed at
  // or truncated out of its instruction — it degrades to the stock line.
  const unknown = buildDirectReply(winSignal({
    previousCue: { id: 'registry-drill-42', axis: 'pitch_floor', instruction: 'Some registry instruction with, awkward, commas.' },
  }), {});
  assert.match(unknown, stock);
  assert.doesNotMatch(unknown, /registry|awkward/);
});

test('win line: every cue id recommendDrillForFocus can return has a written action clause', () => {
  // ANTI-DRIFT. A missing entry is silent: that axis just degrades back to the
  // stock line, which is precisely the failure this change exists to remove. So
  // the ids come from the REAL recommender over the REAL axis list, never a
  // copied literal.
  const ids = new Set();
  for (const focus of FOCUS_AXES) {
    const drill = recommendDrillForFocus(focus, '', null, null);
    if (drill?.id) ids.add(drill.id);
  }
  // The two target-relative overshoot variants, which only appear with a status.
  ids.add(recommendDrillForFocus('resonance_forward', '', null, { resonance: { status: 'too_bright' } }).id);
  ids.add(recommendDrillForFocus('vocal_weight', '', null, { weight: { status: 'too_light' } }).id);

  assert.ok(ids.size >= 11, `expected the full starter set, saw ${ids.size}`);
  const missing = [...ids].filter((id) => !WIN_CUE_ACTIONS[id]);
  assert.deepEqual(missing, [], `cue ids with no action clause: ${missing.join(', ')}`);
  // No dead entries either — a clause for an id nothing can recommend is drift
  // in the other direction.
  const orphaned = Object.keys(WIN_CUE_ACTIONS).filter((id) => !ids.has(id));
  assert.deepEqual(orphaned, [], `action clauses for unreachable cue ids: ${orphaned.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 5. The whole chain, through the real functions
// ---------------------------------------------------------------------------

test('crossing: cue given -> persisted -> signal.previousCue -> the win line names it', async (t) => {
  const h = harness();
  t.after(h.cleanup);
  const sessionId = await armed(h, takeState());

  // TURN 1 — a real coach turn gives the pitch-floor cue and persists it.
  await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId, message: 'how did that sound',
  });
  const carried = h.runtime.sessions.get(sessionId).voiceState.lastCueGiven;
  assert.equal(carried.id, 'starter-light-lift');

  // TURN 2 — the same session, now landing the take. The signal is built by the
  // REAL builder off the REAL persisted state; only the intent is forced,
  // because provoking a genuine acknowledge_win needs a whole second analyzer
  // fixture and would prove nothing extra about the carry.
  const voiceState = h.runtime.sessions.get(sessionId).voiceState;
  const signal = buildSignal({
    voiceState, userMessage: '', practiceMode: 'guided', targetPreset: 'cute-feminine',
  });
  assert.deepEqual(signal.previousCue, carried, 'the persisted cue reached the next turn\'s signal');

  signal.coachingDecision.intent = 'acknowledge_win';
  signal.coachMove.intent = 'acknowledge_win';
  const text = buildDirectReply(signal, {});
  assert.ok(text, 'the win composes');
  assert.match(text, /you were starting the words on a small "mm" hum/i);
  assert.equal(sanitizeCoachReply(text, signal), text, 'and survives the live sanitizer verbatim');
});
