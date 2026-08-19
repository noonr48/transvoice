'use strict';

// ---------------------------------------------------------------------------
// Sentence-teardown isolation loop — RUNTIME WIRING (phase C, 2026-07-26)
//
// coaching/section-loop.test.js proves the transition table. This file proves the
// three things the table cannot: that the loop is actually REACHED on the live
// coach path, that its verdict really moves the practice card and the persisted
// voice state, and that the witnesses really appear in the journal.
//
// The bypass is proven the only way that cannot be faked: the model transport is
// wired to a fetch that REJECTS. A retry turn that still returns the engine cue —
// and is not flagged as a fallback — cannot have called the model.
// ---------------------------------------------------------------------------

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createVoiceStandaloneRuntime } = require('./voice-standalone-runtime');
const { PracticeCardStore } = require('./lessons/practice-cards');
const { SECTION_CUES, SECTION_LOOP_CAP_EXIT, MAX_ATTEMPTS } = require('./coaching/section-loop');

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
 * A take whose third of five words sits well under the pitch band, and whose
 * measurement passes the usability gate — the exact shape phase B's scorer needs to
 * name a fragment with confident:true.
 */
function takeState({ finalizedAt = SESSION_STARTED_AT + 5_000, flatToken = 2, meanPitchHz = 205 } = {}) {
  const timeline = [];
  for (let i = 0; i < 100; i += 1) {
    const progress = i / 99;
    const inFlat = flatToken != null
      && progress >= flatToken / 5
      && progress < (flatToken + 1) / 5;
    timeline.push({
      t: Math.round(progress * 2000),
      voiced: true,
      pitchHz: inFlat ? 145 : 210,
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
  };
  // CANONICAL metric names. `meanPitchHz` / `resonanceMean` / `weightMean` are what
  // resolveMetricContract reads (signal-builder.js:330-332) and therefore what
  // buildTargetFit scores the axis from. The legacy `pitchHz` / `resonance` /
  // `weight` spellings are silently ignored there: a fixture using them yields
  // targetFit.pitch.status 'uncertain' with medianHz null, so the loop reads every
  // fragment take as unmeasured and can never exit as a success. Measured while
  // building this file — the first version of these fixtures had exactly that bug
  // and the success path was never actually executed.
  const metrics = { meanPitchHz, resonanceMean: 0.6, weightMean: 0.2, advanced };
  return {
    sessionStartedAt: SESSION_STARTED_AT,
    targetPreset: 'cute-feminine',
    targetSource: 'built-in',
    lastTakeFinalizedAt: finalizedAt,
    lastSummary: {
      voiceSessionId: 'vs-phaseC',
      durationMs: 2000,
      targetPreset: 'cute-feminine',
      target: { ...TARGET },
      metrics,
      issues: [],
    },
    lastAttemptArtifact: {
      attemptId: `aa-${finalizedAt}`,
      voiceSessionId: 'vs-phaseC',
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

function harness({ modelText = null } = {}) {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'transvoice-section-loop-'));
  const logLines = [];
  let modelCalls = 0;
  const practiceCards = new PracticeCardStore();
  const runtime = createVoiceStandaloneRuntime({
    stateRoot,
    disableSessionPersistence: true,
    learnerContextRoot: path.join(stateRoot, 'learner-context'),
    practiceCards,
    logger: { log: (line) => logLines.push(line), warn() {}, error() {} },
    fetchImpl: async (url) => {
      if (String(url).includes('/chat/completions')) {
        modelCalls += 1;
        // A null modelText means "the model transport is DEAD": any turn that still
        // produces a coach line must have produced it without the model.
        if (modelText == null) throw new Error('model transport is deliberately unavailable');
        return modelReply(modelText);
      }
      throw new Error(`unexpected fetch: ${url}`);
    },
  });
  return {
    runtime,
    practiceCards,
    logLines,
    modelCalls: () => modelCalls,
    lines: (event) => logLines.filter((line) => line?.event === event),
    cleanup: () => { try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

async function armed(h, voiceState) {
  const started = await h.runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: `sl-${Math.random().toString(16).slice(2)}`,
    studentId: 'section-loop-user',
  });
  const sessionId = started.sessionId;
  const session = h.runtime.sessions.get(sessionId);
  session.agentId = 'voice';
  session.voiceState = { ...session.voiceState, ...voiceState };
  h.practiceCards.createCard(sessionId, { phrase: PHRASE, source: 'tutor', targetPreset: 'cute-feminine' });
  return sessionId;
}

test('runtime: a confident weak fragment isolates the card, writes the state, and witnesses the entry', async (t) => {
  const h = harness({ modelText: 'Let us take just that piece, with a loose jaw.' });
  t.after(h.cleanup);
  const sessionId = await armed(h, takeState());
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, PHRASE, 'precondition: the sentence is up');

  await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    message: 'how did that sound',
  });

  // 1. THE CARD really swapped to the fragment, tagged with its provenance.
  const card = h.practiceCards.getActiveCard(sessionId);
  assert.equal(card.phrase, 'brown', 'the strip now holds only the weak fragment');
  assert.equal(card.source, 'section-loop');
  assert.deepEqual(card.tokens.map((token) => token.emphasis), [3]);

  // 2. THE STATE really persisted, through the normalizer.
  const loop = h.runtime.sessions.get(sessionId).voiceState.sectionLoop;
  assert.ok(loop, 'the loop is on the session voice state');
  assert.equal(loop.fragmentText, 'brown');
  assert.equal(loop.axis, 'pitch');
  assert.equal(loop.attempts, 0);
  assert.equal(loop.maxAttempts, MAX_ATTEMPTS);
  assert.equal(loop.lastTakeKey, 'aa-1700000005000');

  // 3. THE WITNESSES really fired — the dedicated transition line, and the
  // section_loop block spread into the existing coach_gates line.
  const transitions = h.lines('coach_section_loop');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].state, 'entered');
  assert.equal(transitions[0].axis, 'pitch');
  assert.equal(transitions[0].attempts, 0);
  assert.equal(transitions[0].fragment_tokens, 1);

  const gates = h.lines('coach_gates');
  assert.ok(gates.length >= 1, 'coach_gates was emitted');
  assert.deepEqual(gates.at(-1).section_loop, { state: 'entered', attempts: 0 });

  // The ENTRY turn is LLM-phrased, so the model WAS called.
  assert.equal(h.modelCalls(), 1);
});

test('runtime: a retry answers from the cue table with the model transport DEAD', async (t) => {
  // No modelText -> every /chat/completions call throws. A coach line still comes
  // back, is one of the twelve engine cues, and is NOT flagged as a fallback.
  const h = harness();
  t.after(h.cleanup);

  const sessionId = await armed(h, {
    ...takeState({ finalizedAt: SESSION_STARTED_AT + 6_000, flatToken: null, meanPitchHz: 145 }),
    sectionLoop: {
      phrase: PHRASE,
      tokenStart: 2,
      tokenEnd: 2,
      fragmentText: 'brown',
      fragmentTokens: ['brown'],
      axis: 'pitch',
      direction: 'under',
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      enteredAt: SESSION_STARTED_AT + 5_500,
      lastCueId: null,
      usedCueIds: [],
      lastTakeKey: 'aa-1700000005000',
    },
  });

  // Put the fragment card up, exactly as the entry turn does, so "the retry leaves
  // the card alone" is a real assertion rather than a vacuous one.
  const fragmentCard = h.practiceCards.createCard('fragment-source', {
    phrase: 'brown', source: 'section-loop', tokens: [{ text: 'brown', emphasis: 3 }],
  });
  h.practiceCards.stashActiveCard(sessionId, fragmentCard);
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, 'brown');

  const payload = await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    message: 'brown',
  });

  assert.equal(h.modelCalls(), 0, 'THE LATENCY LAW: no model round-trip on a retry');
  assert.ok(
    SECTION_CUES.pitch.some((cue) => cue.text === payload.coachMessage),
    `the reply is a pitch cue from the table, got: ${payload.coachMessage}`,
  );
  assert.equal(payload.fallbackReply, false, 'an engine cue is a designed reply, not a failure');

  const loop = h.runtime.sessions.get(sessionId).voiceState.sectionLoop;
  assert.equal(loop.attempts, 1, 'the attempt was spent');
  assert.equal(loop.usedCueIds.length, 1, 'and the cue is now spent for this loop');

  const transitions = h.lines('coach_section_loop');
  assert.equal(transitions.length, 1);
  assert.equal(transitions[0].state, 'retry');
  assert.equal(transitions[0].cue_id, loop.lastCueId);
  assert.equal(h.lines('coach_gates').at(-1).section_loop.state, 'retry');
  // The fragment card is untouched by a retry — the learner keeps the same words in
  // front of them while the cue changes.
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, 'brown', 'the retry changes no card');
  assert.equal(h.practiceCards.hasStashedCard(sessionId), true, 'the sentence is still waiting');
});

test('runtime: a clean fragment take reassembles — sentence back, loop closed, model re-engaged', async (t) => {
  const h = harness({ modelText: 'That word sat right where you wanted it. Take the whole line now, and let the jaw stay loose all the way through.' });
  t.after(h.cleanup);

  // A fragment take whose pitch lands INSIDE the band (210 Hz in 188-255).
  const sessionId = await armed(h, {
    ...takeState({ finalizedAt: SESSION_STARTED_AT + 9_000, flatToken: null, meanPitchHz: 210 }),
    sectionLoop: {
      phrase: PHRASE,
      tokenStart: 2,
      tokenEnd: 2,
      fragmentText: 'brown',
      fragmentTokens: ['brown'],
      axis: 'pitch',
      direction: 'under',
      attempts: 1,
      maxAttempts: MAX_ATTEMPTS,
      enteredAt: SESSION_STARTED_AT + 5_500,
      lastCueId: 'pitch_jaw_anchor',
      usedCueIds: ['pitch_jaw_anchor'],
      lastTakeKey: 'aa-1700000005000',
    },
  });
  const sentenceCard = h.practiceCards.getActiveCard(sessionId);
  h.practiceCards.stashActiveCard(sessionId, h.practiceCards.createCard('fragment-source', {
    phrase: 'brown', source: 'section-loop', tokens: [{ text: 'brown', emphasis: 3 }],
  }));
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, 'brown', 'precondition: isolated');

  const payload = await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    message: 'brown',
  });

  // The REASSEMBLY turn is LLM-phrased, so the model IS called again — and it was
  // told, in the prompt, that the fragment landed. The model line here is a
  // deliberately ACTIONABLE one ("let the jaw stay loose"): the reassembly invite
  // crosses the same core-loop repair as any coach turn, so a purely celebratory
  // reassembly would be replaced by the generic cue. That is correct behaviour, and
  // this assertion is what proves the reassembly is a normal sanitized coach turn
  // rather than a privileged path.
  assert.equal(h.modelCalls(), 1);
  assert.equal(payload.coachMessage, 'That word sat right where you wanted it. Take the whole line now, and let the jaw stay loose all the way through.');
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, sentenceCard.phrase, 'the whole sentence is back');
  assert.equal(h.runtime.sessions.get(sessionId).voiceState.sectionLoop, null, 'the loop is closed');
  assert.equal(
    h.runtime.sessions.get(sessionId).voiceState.sectionLoopLastTakeKey,
    'aa-1700000009000',
    'the closing take is armed as the re-entry guard',
  );
  const transition = h.lines('coach_section_loop').at(-1);
  assert.equal(transition.state, 'exited_success');
  assert.equal(transition.attempts, 2);
  assert.equal(transition.measurement_usable, true, 'success needs MEASURED evidence');
  assert.equal(transition.reason, 'in_band');
  assert.deepEqual(h.lines('coach_gates').at(-1).section_loop, { state: 'exited_success', attempts: 2 });
});

test('runtime: the cap exits warmly, restores the sentence card, and clears the state', async (t) => {
  const h = harness();
  t.after(h.cleanup);

  const sessionId = await armed(h, {
    ...takeState({ finalizedAt: SESSION_STARTED_AT + 6_000, flatToken: null, meanPitchHz: 145 }),
    sectionLoop: {
      phrase: PHRASE,
      tokenStart: 2,
      tokenEnd: 2,
      fragmentText: 'brown',
      fragmentTokens: ['brown'],
      axis: 'pitch',
      direction: 'under',
      attempts: MAX_ATTEMPTS - 1,
      maxAttempts: MAX_ATTEMPTS,
      enteredAt: SESSION_STARTED_AT + 5_500,
      lastCueId: 'pitch_jaw_anchor',
      usedCueIds: ['pitch_jaw_anchor', 'pitch_neck_long'],
      lastTakeKey: 'aa-1700000005000',
    },
  });
  // Put a FRAGMENT card up and stash the sentence, exactly as the entry turn does.
  const sentenceCard = h.practiceCards.getActiveCard(sessionId);
  h.practiceCards.stashActiveCard(sessionId, h.practiceCards.createCard('fragment-source', {
    phrase: 'brown', source: 'section-loop', tokens: [{ text: 'brown', emphasis: 3 }],
  }));
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, 'brown', 'precondition: isolated');

  const payload = await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    message: 'brown',
  });

  assert.equal(h.modelCalls(), 0, 'the warm exit is engine-authored too');
  assert.equal(payload.coachMessage, SECTION_LOOP_CAP_EXIT);
  assert.equal(payload.fallbackReply, false);
  assert.equal(
    h.runtime.sessions.get(sessionId).voiceState.sectionLoop,
    null,
    'the loop is cleared — the coach moves on rather than nagging',
  );
  assert.equal(
    h.runtime.sessions.get(sessionId).voiceState.sectionLoopLastTakeKey,
    'aa-1700000006000',
    'and the closing take is armed as the re-entry guard',
  );
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, sentenceCard.phrase, 'the sentence came back');
  assert.equal(h.lines('coach_section_loop').at(-1).state, 'exited_cap');
  assert.equal(h.lines('coach_gates').at(-1).section_loop.attempts, MAX_ATTEMPTS);
});

test('runtime: the PRODUCTION post-take message does not end the isolation', async (t) => {
  // THE REGRESSION THIS PINS. The app's own post-take route fires the coach with a
  // fixed engine string (voice-standalone-runtime.js startAsyncVoiceCoachTask). While
  // the full-line check read `signal.userUtterance` — which is that message — every
  // first fragment take exited as `exited_full_line`, making the cue table, the warm
  // cap exit and the entire reassembly step unreachable on the real flow. Uses the
  // VERBATIM production string so a reworded route re-runs this check.
  const POST_TAKE_MESSAGE = 'Give me one concise post-take coaching note for the latest voice attempt.';
  const routeSource = fs.readFileSync(path.join(__dirname, 'voice-standalone-runtime.js'), 'utf8');
  assert.ok(
    routeSource.includes(POST_TAKE_MESSAGE),
    'the production post-take route no longer uses this string — update this test to the new one',
  );

  const h = harness();
  t.after(h.cleanup);
  const sessionId = await armed(h, {
    ...takeState({ finalizedAt: SESSION_STARTED_AT + 6_000, flatToken: null, meanPitchHz: 145 }),
    // The learner spoke only the fragment — which is what we asked for.
    voiceInputRuntime: { previousInputTurnAt: SESSION_STARTED_AT + 1_000, lastTranscript: 'brown' },
    sectionLoop: {
      phrase: PHRASE,
      tokenStart: 2,
      tokenEnd: 2,
      fragmentText: 'brown',
      fragmentTokens: ['brown'],
      axis: 'pitch',
      direction: 'under',
      attempts: 0,
      maxAttempts: MAX_ATTEMPTS,
      enteredAt: SESSION_STARTED_AT + 5_500,
      lastCueId: null,
      usedCueIds: [],
      lastTakeKey: 'aa-1700000005000',
    },
  });

  const payload = await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    message: POST_TAKE_MESSAGE,
  });

  const transition = h.lines('coach_section_loop').at(-1);
  assert.equal(transition.state, 'retry', 'the isolation continues — the learner spoke the fragment');
  assert.notEqual(transition.state, 'exited_full_line');
  assert.ok(
    SECTION_CUES.pitch.some((cue) => cue.text === payload.coachMessage),
    'and the engine cue table is reachable again',
  );
  assert.equal(h.runtime.sessions.get(sessionId).voiceState.sectionLoop.attempts, 1);

  // The same route, when the learner really DID take the whole line, still honors it.
  const h2 = harness({ modelText: 'Nice — let the jaw stay loose right through the line.' });
  t.after(h2.cleanup);
  const s2 = await armed(h2, {
    ...takeState({ finalizedAt: SESSION_STARTED_AT + 6_000, flatToken: null, meanPitchHz: 145 }),
    voiceInputRuntime: {
      previousInputTurnAt: SESSION_STARTED_AT + 1_000,
      lastTranscript: PHRASE,
      // At-or-after the take: this ASR really is a transcript OF this take. Without
      // the timestamp the live-ASR source is refused outright — see (A5e).
      lastProcessedAt: SESSION_STARTED_AT + 6_100,
    },
    sectionLoop: {
      phrase: PHRASE, tokenStart: 2, tokenEnd: 2, fragmentText: 'brown', fragmentTokens: ['brown'],
      axis: 'pitch', direction: 'under', attempts: 0, maxAttempts: MAX_ATTEMPTS,
      enteredAt: SESSION_STARTED_AT + 5_500, lastCueId: null, usedCueIds: [], lastTakeKey: 'aa-1700000005000',
    },
  });
  await h2.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId: s2,
    message: POST_TAKE_MESSAGE,
  });
  assert.equal(h2.lines('coach_section_loop').at(-1).state, 'exited_full_line', 'leniency is intact');
  assert.equal(h2.runtime.sessions.get(s2).voiceState.sectionLoop, null);
});

test('runtime: a QUESTION mid-loop is ANSWERED by the model, and costs no attempt', async (t) => {
  // On the live coach path every spoken utterance lands an analyzer take, so the
  // take key advances on a question exactly as on a fragment. Before the hold gate
  // covered conversational turns, the learner's question got no answer at all: an
  // engine cue was spoken at them, an attempt was burned, and the witness filed a
  // measured retry for something that never happened.
  const answer = 'It just means the tongue stays high while the jaw hangs loose.';
  const h = harness({ modelText: answer });
  t.after(h.cleanup);
  const sessionId = await armed(h, {
    ...takeState({ finalizedAt: SESSION_STARTED_AT + 6_000, flatToken: null, meanPitchHz: 145 }),
    voiceInputRuntime: {
      previousInputTurnAt: SESSION_STARTED_AT + 1_000,
      lastTranscript: 'what does that mean',
      lastProcessedAt: SESSION_STARTED_AT + 6_100,
    },
    sectionLoop: {
      phrase: PHRASE, tokenStart: 2, tokenEnd: 2, fragmentText: 'brown', fragmentTokens: ['brown'],
      axis: 'pitch', direction: 'under', attempts: 0, maxAttempts: MAX_ATTEMPTS,
      enteredAt: SESSION_STARTED_AT + 5_500, lastCueId: null, usedCueIds: [], lastTakeKey: 'aa-1700000005000',
    },
  });
  const fragmentCard = h.practiceCards.createCard('fragment-source', {
    phrase: 'brown', source: 'section-loop', tokens: [{ text: 'brown', emphasis: 3 }],
  });
  h.practiceCards.stashActiveCard(sessionId, fragmentCard);

  const payload = await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    // A conversational question — policy-gates reads this as CONVERSE.
    message: 'what does that mean',
  });

  assert.equal(h.modelCalls(), 1, 'the model IS called — the learner asked something');
  assert.equal(payload.coachMessage, answer, 'and the answer is what they get back');
  assert.equal(
    SECTION_CUES.pitch.some((cue) => cue.text === payload.coachMessage),
    false,
    'no engine cue is spoken at a question',
  );
  const loop = h.runtime.sessions.get(sessionId).voiceState.sectionLoop;
  assert.ok(loop, 'the loop is intact');
  assert.equal(loop.attempts, 0, 'no attempt was spent');
  assert.deepEqual(loop.usedCueIds, [], 'and no cue was consumed');
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, 'brown', 'the fragment stays on screen');
  assert.equal(h.lines('coach_section_loop').length, 0, 'a hold is not a transition and files nothing');
  for (const line of h.lines('coach_gates')) {
    assert.equal(line.section_loop, undefined, 'and nothing false lands in coach_gates');
  }
});

test('runtime: a STALE live-ASR transcript does not end the isolation', async (t) => {
  // The practice-take path leaves voiceInputRuntime holding the PREVIOUS turn's
  // transcript. Here that is the whole line, left over from the entry take, while
  // the fragment take that just landed carries no transcript of its own.
  const h = harness();
  t.after(h.cleanup);
  const sessionId = await armed(h, {
    ...takeState({ finalizedAt: SESSION_STARTED_AT + 9_000, flatToken: null, meanPitchHz: 145 }),
    voiceInputRuntime: {
      previousInputTurnAt: SESSION_STARTED_AT + 1_000,
      lastTranscript: PHRASE,
      // The ENTRY take's ASR — older than the fragment take that just landed.
      lastProcessedAt: SESSION_STARTED_AT + 5_000,
    },
    sectionLoop: {
      phrase: PHRASE, tokenStart: 2, tokenEnd: 2, fragmentText: 'brown', fragmentTokens: ['brown'],
      axis: 'pitch', direction: 'under', attempts: 0, maxAttempts: MAX_ATTEMPTS,
      enteredAt: SESSION_STARTED_AT + 5_500, lastCueId: null, usedCueIds: [], lastTakeKey: 'aa-1700000005000',
    },
  });

  await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    message: 'Give me one concise post-take coaching note for the latest voice attempt.',
  });

  const transition = h.lines('coach_section_loop').at(-1);
  assert.equal(transition.state, 'retry', 'a leftover transcript must never end the isolation');
  assert.notEqual(transition.state, 'exited_full_line');
  assert.equal(h.runtime.sessions.get(sessionId).voiceState.sectionLoop.attempts, 1);

  // And a transcript that really is from THIS take is still honored.
  const h2 = harness({ modelText: 'Nice — let the jaw stay loose right through the line.' });
  t.after(h2.cleanup);
  const s2 = await armed(h2, {
    ...takeState({ finalizedAt: SESSION_STARTED_AT + 9_000, flatToken: null, meanPitchHz: 145 }),
    voiceInputRuntime: {
      previousInputTurnAt: SESSION_STARTED_AT + 1_000,
      lastTranscript: PHRASE,
      lastProcessedAt: SESSION_STARTED_AT + 9_200,
    },
    sectionLoop: {
      phrase: PHRASE, tokenStart: 2, tokenEnd: 2, fragmentText: 'brown', fragmentTokens: ['brown'],
      axis: 'pitch', direction: 'under', attempts: 0, maxAttempts: MAX_ATTEMPTS,
      enteredAt: SESSION_STARTED_AT + 5_500, lastCueId: null, usedCueIds: [], lastTakeKey: 'aa-1700000005000',
    },
  });
  await h2.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId: s2,
    message: 'Give me one concise post-take coaching note for the latest voice attempt.',
  });
  assert.equal(h2.lines('coach_section_loop').at(-1).state, 'exited_full_line', 'leniency intact');
});

test('runtime: a card TAKEOVER during a hold closes the loop on the next turn', async (t) => {
  // Reviewer repro. A model `create` op on a HOLD turn replaces the fragment card
  // while the loop is still running, so the coach would go on drilling up to three
  // attempts on words that are no longer on screen — the half-performed isolation the
  // entry guard refuses to create, reached from the other side. The loop must notice
  // it no longer owns the strip and stand down, leaving the newer card alone.
  const takeoverReply = [
    'Sure — here is a shorter line to work with.',
    '```card-ops',
    '{"card_ops":[{"op":"create","phrase":"a small easy line","difficulty":"easy"}]}',
    '```',
  ].join('\n');
  const h = harness({ modelText: takeoverReply });
  t.after(h.cleanup);

  const loopState = {
    phrase: PHRASE, tokenStart: 2, tokenEnd: 2, fragmentText: 'brown', fragmentTokens: ['brown'],
    axis: 'pitch', direction: 'under', attempts: 1, maxAttempts: MAX_ATTEMPTS,
    enteredAt: SESSION_STARTED_AT + 5_500, lastCueId: 'pitch_jaw_anchor',
    usedCueIds: ['pitch_jaw_anchor'], lastTakeKey: 'aa-1700000005000',
  };
  const sessionId = await armed(h, {
    ...takeState({ finalizedAt: SESSION_STARTED_AT + 6_000, flatToken: null, meanPitchHz: 145 }),
    voiceInputRuntime: {
      previousInputTurnAt: SESSION_STARTED_AT + 1_000,
      lastTranscript: 'what does that mean',
      lastProcessedAt: SESSION_STARTED_AT + 6_100,
    },
    sectionLoop: loopState,
  });
  h.practiceCards.stashActiveCard(sessionId, h.practiceCards.createCard('fragment-source', {
    phrase: 'brown', source: 'section-loop', tokens: [{ text: 'brown', emphasis: 3 }],
  }));
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, 'brown', 'precondition: isolated');
  assert.equal(h.practiceCards.hasCardTakeover(sessionId), false, 'precondition: no takeover yet');

  // TURN 1 — a question mid-isolation. The turn HOLDS, and the model's create op
  // replaces the fragment card.
  await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    message: 'what does that mean',
  });
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, 'a small easy line', 'the model took the strip');
  assert.equal(h.practiceCards.hasCardTakeover(sessionId), true, 'and the store recorded the takeover');
  assert.ok(h.runtime.sessions.get(sessionId).voiceState.sectionLoop, 'the loop is still open this turn');
  assert.equal(h.lines('coach_section_loop').length, 0, 'the hold itself filed nothing');

  // TURN 2 — the loop notices it no longer owns the strip and stands down.
  h.runtime.sessions.get(sessionId).voiceState = {
    ...h.runtime.sessions.get(sessionId).voiceState,
    ...takeState({ finalizedAt: SESSION_STARTED_AT + 10_000, flatToken: null, meanPitchHz: 145 }),
    sectionLoop: loopState,
  };
  const payload = await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    message: 'Give me one concise post-take coaching note for the latest voice attempt.',
  });

  const transition = h.lines('coach_section_loop').at(-1);
  assert.equal(transition.state, 'exited_card_takeover');
  assert.equal(transition.reason, 'card_takeover');
  assert.equal(transition.attempts, 1, 'attempts are frozen where they stopped, not advanced');
  assert.equal(h.runtime.sessions.get(sessionId).voiceState.sectionLoop, null, 'the loop is closed');
  assert.equal(
    h.practiceCards.getActiveCard(sessionId).phrase,
    'a small easy line',
    'the newer card wins — no restore, the learner keeps what they are looking at',
  );
  assert.equal(
    SECTION_CUES.pitch.some((cue) => cue.text === payload.coachMessage),
    false,
    'and no engine cue is spoken about the vanished fragment',
  );
  assert.equal(h.practiceCards.hasCardTakeover(sessionId), false, 'the detector is rearmed for the next isolation');
  assert.deepEqual(h.lines('coach_gates').at(-1).section_loop, { state: 'exited_card_takeover', attempts: 1 });
});

test('runtime: an ordinary isolation is NEVER mistaken for a takeover', async (t) => {
  // The counterweight. The naive ownership signal (`activeCard.source ===
  // 'section-loop'`) closed the loop on the routine post-take turn, because a loop
  // whose card store is merely out of step reads identically to a real takeover.
  // A run with no replacement at all must produce no takeover, ever.
  const h = harness();
  t.after(h.cleanup);
  const sessionId = await armed(h, {
    ...takeState({ finalizedAt: SESSION_STARTED_AT + 6_000, flatToken: null, meanPitchHz: 145 }),
    sectionLoop: {
      phrase: PHRASE, tokenStart: 2, tokenEnd: 2, fragmentText: 'brown', fragmentTokens: ['brown'],
      axis: 'pitch', direction: 'under', attempts: 0, maxAttempts: MAX_ATTEMPTS,
      enteredAt: SESSION_STARTED_AT + 5_500, lastCueId: null, usedCueIds: [], lastTakeKey: 'aa-1700000005000',
    },
  });
  // Deliberately NO fragment card in the store — the state the naive read misfired on.
  assert.notEqual(h.practiceCards.getActiveCard(sessionId).source, 'section-loop');
  assert.equal(h.practiceCards.hasCardTakeover(sessionId), false);

  await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    message: 'Give me one concise post-take coaching note for the latest voice attempt.',
  });
  assert.equal(h.lines('coach_section_loop').at(-1).state, 'retry', 'the isolation continues normally');
});

test('runtime: an isolation never survives a restart', async (t) => {
  // The loop persists with the session; the fragment card does not (PracticeCardStore
  // is memory-only). A restored loop would resume mid-teardown with the whole
  // sentence on screen — the half-performed isolation the entry guard refuses to
  // create in the first place.
  const h = harness();
  t.after(h.cleanup);
  const stored = new Map([['restored-session', {
    id: 'restored-session',
    agentId: 'voice',
    studentId: 'restore-user',
    createdAt: SESSION_STARTED_AT,
    updatedAt: SESSION_STARTED_AT,
    mode: 'voice',
    voiceState: {
      targetPreset: 'cute-feminine',
      sectionLoopLastTakeKey: 'aa-old',
      sectionLoop: {
        phrase: PHRASE, tokenStart: 2, tokenEnd: 2, fragmentText: 'brown', fragmentTokens: ['brown'],
        axis: 'pitch', direction: 'under', attempts: 1, maxAttempts: MAX_ATTEMPTS,
        enteredAt: SESSION_STARTED_AT, lastCueId: 'pitch_jaw_anchor',
        usedCueIds: ['pitch_jaw_anchor'], lastTakeKey: 'aa-old',
      },
    },
  }]]);
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'transvoice-restore-'));
  t.after(() => { try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ } });
  const restored = createVoiceStandaloneRuntime({
    sessions: stored,
    stateRoot,
    disableSessionPersistence: true,
    learnerContextRoot: path.join(stateRoot, 'learner-context'),
    logger: false,
    fetchImpl: async () => { throw new Error('no network in this test'); },
  });

  const session = restored.sessions.get('restored-session');
  assert.ok(session, 'the session itself is restored');
  assert.equal(session.voiceState.sectionLoop, null, 'but the isolation is not');
  assert.equal(session.voiceState.sectionLoopLastTakeKey, null);
});

test('runtime: the STREAMING coach path runs the same loop as the buffered one', async (t) => {
  // The two coach paths do not share a function: the buffered one goes through
  // coachingTurn, the SSE one builds the signal and streams itself. A loop wired to
  // only one of them would isolate a fragment the other could never close, so this
  // drives the streaming path through the same retry the buffered test drives — with
  // the same dead model transport.
  const h = harness();
  t.after(h.cleanup);
  const sessionId = await armed(h, {
    ...takeState({ finalizedAt: SESSION_STARTED_AT + 6_000, flatToken: null, meanPitchHz: 145 }),
    sectionLoop: {
      phrase: PHRASE,
      tokenStart: 2,
      tokenEnd: 2,
      fragmentText: 'brown',
      fragmentTokens: ['brown'],
      axis: 'pitch',
      direction: 'under',
      attempts: MAX_ATTEMPTS - 1,
      maxAttempts: MAX_ATTEMPTS,
      enteredAt: SESSION_STARTED_AT + 5_500,
      lastCueId: 'pitch_jaw_anchor',
      usedCueIds: ['pitch_jaw_anchor', 'pitch_neck_long'],
      lastTakeKey: 'aa-1700000005000',
    },
  });
  const sentenceCard = h.practiceCards.getActiveCard(sessionId);
  h.practiceCards.stashActiveCard(sessionId, h.practiceCards.createCard('fragment-source', {
    phrase: 'brown', source: 'section-loop', tokens: [{ text: 'brown', emphasis: 3 }],
  }));

  const writes = [];
  await h.runtime.generateRealtimeCoachReplyStreaming(
    h.runtime.sessions.get(sessionId),
    'brown',
    { writeHead() {}, write(v) { writes.push(String(v)); }, end() {} },
  );

  assert.equal(h.modelCalls(), 0, 'the streaming path honors the latency law too');
  const done = writes
    .filter((v) => v.startsWith('data: '))
    .map((v) => JSON.parse(v.slice(6)))
    .find((e) => e.done === true);
  assert.ok(done, 'the SSE stream still completes');
  assert.equal(done.session.coachMessage, SECTION_LOOP_CAP_EXIT);
  assert.equal(done.session.fallbackReply, false, 'not a fallback — nothing failed');
  assert.equal(h.runtime.sessions.get(sessionId).voiceState.sectionLoop, null, 'the loop closed');
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, sentenceCard.phrase, 'the sentence came back');
  assert.equal(h.lines('coach_section_loop').at(-1).state, 'exited_cap');
  assert.deepEqual(
    h.lines('coach_gates').at(-1).section_loop,
    { state: 'exited_cap', attempts: MAX_ATTEMPTS },
    'and the same coach_gates block is emitted on both paths',
  );
});

test('runtime: if the fragment card cannot be authored, no loop opens at all', async (t) => {
  // Fail-closed on the half-performed isolation. Without this the coach would spend
  // three turns drilling a fragment the learner cannot see, because the pedagogy is
  // "isolate the fragment ONTO the card" — a loop with no fragment on screen is not
  // the thing that was asked for.
  const h = harness({ modelText: 'Let us take just that piece.' });
  t.after(h.cleanup);
  const sessionId = await armed(h, takeState());
  // Break exactly the card-authoring step, nothing else.
  h.practiceCards.stashActiveCard = () => { throw new Error('card store unavailable'); };

  await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    message: 'how did that sound',
  });

  assert.equal(
    h.runtime.sessions.get(sessionId).voiceState.sectionLoop,
    null,
    'no loop is opened when the fragment never reached the card',
  );
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, PHRASE, 'the sentence is still up');
  const line = h.lines('coach_section_loop').at(-1);
  assert.equal(line.state, 'entry_abandoned');
  assert.equal(line.reason, 'fragment_card_not_authored');
});

test('runtime: a session that never tears a sentence apart logs no section-loop fields at all', async (t) => {
  const h = harness({ modelText: 'Keep the jaw loose through the whole line.' });
  t.after(h.cleanup);
  // A clean take: nothing is confidently weak, so nothing isolates.
  const sessionId = await armed(h, takeState({ flatToken: null }));

  await h.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId,
    message: 'how did that sound',
  });

  assert.equal(h.lines('coach_section_loop').length, 0);
  for (const line of h.lines('coach_gates')) {
    assert.equal(line.section_loop, undefined, 'the witness line shape is unchanged on ordinary turns');
  }
  assert.equal(h.runtime.sessions.get(sessionId).voiceState.sectionLoop, null);
  assert.equal(h.practiceCards.getActiveCard(sessionId).phrase, PHRASE, 'the sentence stays up');
});
