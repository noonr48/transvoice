'use strict';

/**
 * section-loop battery — the sentence-teardown isolation loop (phase C).
 *
 * Six surfaces, because any one of them alone leaves a hole:
 *
 *   (A) STATE MACHINE   — enter / retry / success / cap / full-line / safety /
 *                         no-re-enter-on-the-same-take, driven through the real
 *                         transition function.
 *   (B) CARD            — the fragment card is authored, and the whole sentence
 *                         comes back byte-identical afterwards.
 *   (C) CUE TABLE       — variety inside one loop, and DIRECTION-LAW compliance for
 *                         every entry in BOTH directions, proven by running each
 *                         string through the live runtime sanitizer rather than by
 *                         eyeballing the wording.
 *   (D) PRODUCT LAWS    — every new spoken string against the CONTENT tier (the
 *                         stricter bar content-product-laws.test.js applies to
 *                         code-owned copy) and the runtime pipeline.
 *   (E) INTEGRATION     — the entry and reassembly lines really render into the
 *                         renderer prompt, and a retry really does not call the LLM
 *                         (proven with a spy on coachingTurn's callModel).
 *   (F) EVIDENCE GATES  — an unusable or unmeasured fragment take can never exit the
 *                         loop as a success, and a stale take can never open one.
 *
 * Prediction before running: all pass; the cue-table direction checks are the ones
 * most likely to fail, since a cue that names a pitch direction is deleted for the
 * opposite learner (the documented failure this table was designed around).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveSectionLoopTurn,
  canEnterSectionLoop,
  mustAbortSectionLoop,
  buildFragmentCardSpec,
  pickSectionCue,
  looksLikeFullLine,
  readAxisVerdict,
  resolveTakeKey,
  resolveTakeTranscript,
  SECTION_CUES,
  SECTION_LOOP_CAP_EXIT,
  MAX_ATTEMPTS,
  SECTION_LOOP_AXES,
  FULL_LINE_MIN_EXTRA_WORDS,
  FULL_LINE_COVERAGE,
} = require('./section-loop');
const {
  sanitizeCoachReply,
  HOMEWORK_RULES,
  EQUIPMENT_RULES,
} = require('./sanitizer');
const { buildRendererUserMessage, buildRendererSystemPrompt } = require('./renderer-client');
const { coachingTurn } = require('./index');
const { buildSignal } = require('./signal-builder');
const { PracticeCardStore, createCard } = require('../lessons/practice-cards');
const { createVoiceSessionStateRuntime } = require('../voice-session-state');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PHRASE = 'The quick brown fox ran';

/** The voice-state runtime with the same injected deps voice-session-state.vad.test.js uses. */
function createStateRuntime() {
  return createVoiceSessionStateRuntime({
    appendVoiceCoachThreadMessage: () => [],
    buildVoiceCueSheet: () => ({}),
    buildVoiceStudentModelEvaluations: () => ({}),
    getCachedDefaultModelId: () => null,
    getRenderableVoicePhraseComparison: () => null,
    getVoiceDrillById: () => null,
    normalizeDeepTutorVoiceState: (value) => value || {},
    normalizeDifficultyPreference: (value) => value || 'adaptive',
    normalizeRequestedModel: () => null,
    normalizeVoiceCoachInputConfidence: () => null,
    normalizeVoiceCoachInputProvider: (value) => (value === 'backend' ? 'backend' : 'browser'),
    resolveActiveVoicePhrase: () => null,
    resolveValidatedSessionModel: async () => null,
  });
}

/**
 * A signal shaped exactly as buildSignal produces one, reduced to the fields the
 * transition table reads. Hand-built rather than driven through buildSignal for the
 * state-machine tests: the point is to sit the machine on each boundary exactly, and
 * a synthesized take cannot be tuned to land on "confident but one attempt from the
 * cap". The (E)/(F) tests use the REAL buildSignal, so the field shapes are pinned
 * by something other than this helper's opinion.
 */
function signalWith(overrides = {}) {
  const {
    worst,
    axisStatus = {},
    usable = true,
    coachingAction = 'coach',
    shouldCorrect = true,
    safetyState = 'normal',
    intent = 'single_actionable_cue',
    takeKind = 'phrase',
    userUtterance = 'brown fox',
  } = overrides;
  return {
    mode: 'active_drill',
    styleTarget: 'cute-feminine',
    practiceLine: PHRASE,
    userUtterance,
    takeKind,
    takeQuality: { usable },
    policy: { shouldCorrect, coachingAction, safetyState, avoidTopics: [], maxCueCount: 1 },
    coachingDecision: { intent },
    targetFit: {
      pitch: { status: axisStatus.pitch || 'in_band' },
      resonance: { status: axisStatus.resonance || 'target' },
      weight: { status: axisStatus.weight || 'target' },
    },
    ...(worst === null ? {} : {
      takeSections: {
        sectionCount: 5,
        alignment: 'uniform-word-index',
        worst: {
          tokenStart: 2,
          tokenEnd: 2,
          text: 'brown',
          axis: 'pitch',
          direction: 'under',
          margin: 2.1,
          voicedFrames: 16,
          score: 2.4,
          confident: true,
          ...(worst || {}),
        },
      },
    }),
    decisionWitness: {},
  };
}

/** Enter a loop and hand back the resulting state, for the tests that start mid-loop. */
function enteredLoop(overrides = {}) {
  const result = resolveSectionLoopTurn({
    sectionLoop: null,
    lastTakeKey: null,
    signal: signalWith(overrides),
    takeKey: 'take-1',
    phrase: PHRASE,
    now: 1_700_000_000_000,
  });
  assert.equal(result.transition, 'entered', 'fixture precondition: the loop opens');
  return result.sectionLoop;
}

// ---------------------------------------------------------------------------
// (A) STATE MACHINE
// ---------------------------------------------------------------------------

test('(A1) a confident weak section on a phrase take opens the loop', () => {
  const result = resolveSectionLoopTurn({
    sectionLoop: null,
    signal: signalWith(),
    takeKey: 'take-1',
    phrase: PHRASE,
    now: 1_700_000_000_000,
  });

  assert.equal(result.transition, 'entered');
  assert.equal(result.active, true);
  assert.equal(result.cardAction, 'isolate');
  assert.equal(result.deterministicReply, null, 'the ENTRY turn is LLM-phrased');
  assert.deepEqual(result.signalPatch, {
    entering: true, fragment: 'brown', axis: 'pitch', direction: 'under',
  });
  assert.deepEqual(result.sectionLoop, {
    phrase: PHRASE,
    tokenStart: 2,
    tokenEnd: 2,
    fragmentText: 'brown',
    fragmentTokens: ['brown'],
    axis: 'pitch',
    direction: 'under',
    attempts: 0,
    maxAttempts: MAX_ATTEMPTS,
    enteredAt: 1_700_000_000_000,
    lastCueId: null,
    usedCueIds: [],
    lastTakeKey: 'take-1',
  });
  assert.equal(result.witness.state, 'entered');
});

test('(A2) an UNCONFIDENT weak section never opens a loop', () => {
  const result = resolveSectionLoopTurn({
    sectionLoop: null,
    signal: signalWith({ worst: { confident: false } }),
    takeKey: 'take-1',
    phrase: PHRASE,
  });
  assert.equal(result.transition, null);
  assert.equal(result.sectionLoop, null);
  assert.equal(canEnterSectionLoop(signalWith({ worst: { confident: false } })).reason, 'no_confident_section');
});

test('(A3) a clean fragment take exits to REASSEMBLY, whole line back on the card', () => {
  const loop = enteredLoop();
  const result = resolveSectionLoopTurn({
    sectionLoop: loop,
    signal: signalWith({ axisStatus: { pitch: 'in_band' }, userUtterance: 'brown' }),
    takeKey: 'take-2',
    phrase: PHRASE,
  });

  assert.equal(result.transition, 'exited_success');
  assert.equal(result.sectionLoop, null, 'the loop is cleared');
  assert.equal(result.cardAction, 'restore');
  assert.equal(result.deterministicReply, null, 'the REASSEMBLY turn is LLM-phrased');
  assert.equal(result.signalPatch.reassembling, true);
  assert.equal(result.signalPatch.phrase, PHRASE);
  assert.equal(result.lastTakeKey, 'take-2', 'the closing take is remembered as the re-entry guard');
  assert.equal(result.witness.attempts, 1);
  assert.equal(result.witness.usable, true);
});

test('(A4) three failing fragment takes exit at the cap, warmly and deterministically', () => {
  let loop = enteredLoop();
  const failing = () => signalWith({ axisStatus: { pitch: 'below' }, userUtterance: 'brown' });
  const states = [];

  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    const result = resolveSectionLoopTurn({
      sectionLoop: loop,
      signal: failing(),
      takeKey: `take-${i + 1}`,
      phrase: PHRASE,
    });
    states.push(result);
    loop = result.sectionLoop;
  }

  assert.deepEqual(states.map((s) => s.transition), ['retry', 'retry', 'exited_cap']);
  assert.deepEqual(states.map((s) => s.witness.attempts), [1, 2, 3]);
  // Retries carry an engine cue; the cap carries the warm exit.
  assert.ok(states[0].deterministicReply, 'retry 1 is engine-authored');
  assert.ok(states[1].deterministicReply, 'retry 2 is engine-authored');
  assert.equal(states[2].deterministicReply, SECTION_LOOP_CAP_EXIT);
  assert.equal(states[2].sectionLoop, null, 'the cap clears the loop — no nagging');
  assert.equal(states[2].cardAction, 'restore');
  // The cap exit is complete in itself: no fourth attempt is ever invited.
  assert.doesNotMatch(SECTION_LOOP_CAP_EXIT, /\bone more\b/i);
});

test('(A5) the learner speaking the WHOLE line is honored, silently', () => {
  const loop = enteredLoop();
  const result = resolveSectionLoopTurn({
    sectionLoop: loop,
    signal: signalWith({ axisStatus: { pitch: 'below' } }),
    takeKey: 'take-2',
    takeTranscript: 'the quick brown fox ran',
    phrase: PHRASE,
  });

  assert.equal(result.transition, 'exited_full_line');
  assert.equal(result.sectionLoop, null);
  assert.equal(result.cardAction, 'restore');
  assert.equal(result.deterministicReply, null, 'silently — no cue, no correction, no telling-off');
  assert.equal(result.signalPatch, null, 'the turn is scored as an ordinary take');
});

test('(A5b) the full-line heuristic separates a stumble past the fragment from the whole line', () => {
  // A stumble past the fragment is NOT a decision to take the line.
  assert.equal(looksLikeFullLine('brown fox', 'brown', PHRASE), false);
  assert.equal(looksLikeFullLine('brown fox ran', 'brown', PHRASE), false);
  // The whole line is, and so is the whole line minus one dropped ASR word.
  assert.equal(looksLikeFullLine('the quick brown fox ran', 'brown', PHRASE), true);
  assert.equal(looksLikeFullLine('quick brown fox ran', 'brown', PHRASE), true);
  // CONTENT, not just length: a spoken question of the same length is not the line.
  assert.equal(looksLikeFullLine('how did that sound', 'brown', PHRASE), false);
  assert.equal(looksLikeFullLine('can we try something else', 'brown', PHRASE), false);
  // Casing and punctuation must not decide it.
  assert.equal(looksLikeFullLine('The Quick, Brown Fox ran!', 'brown', PHRASE), true);
  // A fragment that IS the phrase can never be answered "with the whole line".
  assert.equal(looksLikeFullLine('brown brown brown', 'brown', 'brown'), false);
  assert.equal(looksLikeFullLine('', 'brown', PHRASE), false);
  // The longest shipped line shape: 8 words, a 3-word fragment.
  const long = 'i think the weather turned out really nice today';
  assert.equal(looksLikeFullLine('turned out really', 'turned out really', long), false);
  assert.equal(looksLikeFullLine(long, 'turned out really', long), true);
});

test('(A5c) THE FULL-LINE CHECK READS THE TAKE, NOT THE COACH TURN\'S MESSAGE', () => {
  // The defect this pins, reproduced before the fix: signal.userUtterance is the
  // COACH TURN'S message (signal-builder.js `userUtterance: userMessage`), and the
  // app's own post-take route fires the coach with a fixed twelve-word engine string.
  // Measured against a one-word fragment of a five-word line that cleared both
  // full-line thresholds, so EVERY first fragment take exited as `exited_full_line` —
  // the cue table, the cap exit and the whole reassembly step were unreachable on the
  // real flow, and the witness recorded a reason that was not true.
  const POST_TAKE_MESSAGE = 'Give me one concise post-take coaching note for the latest voice attempt.';
  const spoken = POST_TAKE_MESSAGE.split(/\s+/).length;
  assert.equal(spoken, 12);

  // The historical defect condition, stated exactly: the engine string clears BOTH
  // length thresholds against a one-word fragment of a five-word line. Those were the
  // only two tests at the time, so it read as "the learner took the whole line".
  assert.ok(spoken >= 1 + FULL_LINE_MIN_EXTRA_WORDS, 'clears the extra-words bar');
  assert.ok(spoken >= Math.ceil(5 * FULL_LINE_COVERAGE), 'clears the coverage bar');

  // TWO independent guards now stand between that and a false exit, and both are
  // asserted so neither can be removed silently:
  //   (i)  the input is the TAKE's transcript, never the coach turn's message;
  //   (ii) even fed in directly, the content check rejects it — it shares no word
  //        with the practice line.
  assert.equal(
    looksLikeFullLine(POST_TAKE_MESSAGE, 'brown', PHRASE),
    false,
    'guard (ii): length alone must no longer be enough',
  );

  const loop = enteredLoop();
  const turn = (takeTranscript) => resolveSectionLoopTurn({
    sectionLoop: loop,
    // The coach turn's message is the engine string; the learner spoke the fragment.
    signal: signalWith({ userUtterance: POST_TAKE_MESSAGE, axisStatus: { pitch: 'below' } }),
    takeKey: 'take-2',
    takeTranscript,
    phrase: PHRASE,
  });

  assert.equal(turn('brown').transition, 'retry', 'the learner spoke the fragment -> the loop continues');
  assert.equal(turn('how did that sound').transition, 'retry', 'a typed aside is not a spoken full line either');
  assert.equal(turn('the quick brown fox ran').transition, 'exited_full_line', 'a real full line IS still honored');

  // FAIL CLOSED: a take with no transcript at all (a practice take with no ASR leg)
  // must keep isolating rather than silently deleting the teardown.
  assert.equal(turn(null).transition, 'retry');
  assert.equal(turn('').transition, 'retry');
});

test('(A5d) resolveTakeTranscript reads the take, in the documented order', () => {
  const artifactSummary = { lastAttemptArtifact: { summary: { transcript: 'from the take summary' } } };
  assert.equal(resolveTakeTranscript(artifactSummary), 'from the take summary');
  assert.equal(resolveTakeTranscript({ lastAttemptArtifact: { transcript: 'on the artifact' } }), 'on the artifact');
  // The take's own transcript wins over the live-input one, and needs no time check.
  assert.equal(
    resolveTakeTranscript({
      lastAttemptArtifact: { summary: { transcript: 'from the take summary' } },
      voiceInputRuntime: { lastTranscript: 'live asr', lastProcessedAt: 1 },
      lastTakeFinalizedAt: 9999,
    }),
    'from the take summary',
  );
  assert.equal(resolveTakeTranscript({}), null);
  assert.equal(resolveTakeTranscript(null), null);
});

test('(A5e) THE LIVE-ASR TRANSCRIPT IS ONLY ACCEPTED WHEN IT IS AT LEAST AS NEW AS THE TAKE', () => {
  // The defect this pins: voiceInputRuntime.lastTranscript is NOT take-bound on the
  // practice-take path — finalizeVoiceTake never touches it (verified: zero
  // references), the take request carries no transcript, and the trainer leaves the
  // artifact transcript unset. So the field simply retains the LAST spoken turn.
  // Reproduced: the ENTRY take's transcript (the whole line) was still sitting there
  // when the first FRAGMENT take landed, and reading it bare reported "the learner
  // spoke the whole line" and exited the loop on attempt zero — the original
  // blocker's exact symptom, surviving the binding fix.
  const base = (input) => ({
    lastTakeFinalizedAt: 5000,
    lastAttemptArtifact: { attemptId: 'aa-fragment', finalizedAt: 5000 },
    voiceInputRuntime: { lastTranscript: PHRASE, ...input },
  });

  // STALE: the ASR predates the take, so it cannot be a transcript OF that take.
  assert.equal(resolveTakeTranscript(base({ lastProcessedAt: 1000, lastCapturedAt: 900 })), null);
  // FRESH: at or after the take -> honored, so leniency is intact on the live path.
  assert.equal(resolveTakeTranscript(base({ lastProcessedAt: 5200 })), PHRASE);
  assert.equal(resolveTakeTranscript(base({ lastProcessedAt: 5000 })), PHRASE, 'at-or-after, not strictly after');
  assert.equal(resolveTakeTranscript(base({ lastCapturedAt: 5100 })), PHRASE, 'either timestamp qualifies it');
  // FAIL CLOSED: an untimestamped transcript, or an untimestamped take, cannot be
  // proven to belong together.
  assert.equal(resolveTakeTranscript(base({})), null);
  assert.equal(
    resolveTakeTranscript({ voiceInputRuntime: { lastTranscript: PHRASE, lastProcessedAt: 5200 } }),
    null,
    'no take timestamp at all -> refuse',
  );

  // And end to end: on the stale take the loop CONTINUES instead of false-exiting.
  const stale = resolveSectionLoopTurn({
    sectionLoop: enteredLoop(),
    signal: signalWith({ axisStatus: { pitch: 'below' } }),
    takeKey: 'aa-fragment',
    takeTranscript: resolveTakeTranscript(base({ lastProcessedAt: 1000 })),
    phrase: PHRASE,
  });
  assert.equal(stale.transition, 'retry', 'a stale transcript must never end the isolation');
  assert.equal(stale.sectionLoop.attempts, 1);
});

test('(A6) safety, capture repair, breather and an ease-off request all release the loop', () => {
  const cases = [
    ['safety_state', { safetyState: 'fatigue_or_strain' }],
    ['safety_state', { safetyState: 'stop' }],
    ['capture_repair', { intent: 'repair_capture' }],
    ['breather', { coachingAction: 'breather' }],
    // Symmetry with ISOLATION_ACTIONS: if "go easy on me" blocks a loop from
    // opening, it must also close one that is already open.
    ['ease_off_request', { coachingAction: 'gentle' }],
  ];
  for (const [reason, overrides] of cases) {
    const loop = enteredLoop();
    const result = resolveSectionLoopTurn({
      sectionLoop: loop,
      signal: signalWith(overrides),
      takeKey: 'take-2',
      phrase: PHRASE,
    });
    assert.equal(result.transition, 'exited_safety', JSON.stringify(overrides));
    assert.equal(result.witness.reason, reason);
    assert.equal(result.sectionLoop, null);
    assert.equal(result.cardAction, 'restore');
    assert.equal(result.deterministicReply, null, 'a gentle turn is never stacked with a drill cue');
  }
});

test('(A6b) the same states BLOCK a loop from ever opening', () => {
  const blocked = [
    [{ safetyState: 'stop' }, 'safety_state'],
    [{ safetyState: 'capture_only' }, 'safety_state'],
    [{ intent: 'repair_capture' }, 'capture_repair'],
    [{ shouldCorrect: false }, 'correction_not_permitted'],
    [{ coachingAction: 'breather' }, 'action_breather'],
    [{ coachingAction: 'converse' }, 'action_converse'],
    // An explicit "go easy on me" turn must not be answered by taking their
    // sentence apart — that is the opposite of easing off.
    [{ coachingAction: 'gentle' }, 'action_gentle'],
    [{ usable: false }, 'take_unusable'],
    [{ takeKind: 'siren' }, 'not_a_phrase_take'],
    [{ takeKind: 'hum_sovt' }, 'not_a_phrase_take'],
    [{ worst: { text: '   ' } }, 'unnameable_fragment'],
    [{ worst: { axis: 'prosody' } }, 'unknown_axis'],
  ];
  for (const [overrides, reason] of blocked) {
    const signal = signalWith(overrides);
    assert.equal(canEnterSectionLoop(signal).reason, reason, JSON.stringify(overrides));
    const result = resolveSectionLoopTurn({
      sectionLoop: null, signal, takeKey: 'take-1', phrase: PHRASE,
    });
    assert.equal(result.transition, null, `no entry for ${reason}`);
    assert.equal(result.sectionLoop, null);
  }
  assert.equal(mustAbortSectionLoop(signalWith()), null, 'a normal coaching turn aborts nothing');
});

test('(A7) the take that CLOSED a loop can never immediately re-open one', () => {
  const loop = enteredLoop();
  const closed = resolveSectionLoopTurn({
    sectionLoop: loop,
    signal: signalWith({ axisStatus: { pitch: 'in_band' }, userUtterance: 'brown' }),
    takeKey: 'take-2',
    phrase: PHRASE,
  });
  assert.equal(closed.transition, 'exited_success');

  // The reassembly turn's own signal STILL carries the confident weak section from
  // the take that opened the loop. Without the guard this re-isolates immediately,
  // and the fragment take's timeline gets sliced by the whole-sentence card's
  // tokens — blame on the wrong words, from the wrong audio.
  const next = resolveSectionLoopTurn({
    sectionLoop: null,
    lastTakeKey: closed.lastTakeKey,
    signal: signalWith(),
    takeKey: 'take-2',
    phrase: PHRASE,
  });
  assert.equal(next.transition, null, 'no re-entry on the same take');
  assert.equal(next.sectionLoop, null);

  // A genuinely NEW take may open a loop again.
  const later = resolveSectionLoopTurn({
    sectionLoop: null,
    lastTakeKey: closed.lastTakeKey,
    signal: signalWith(),
    takeKey: 'take-3',
    phrase: PHRASE,
  });
  assert.equal(later.transition, 'entered');
});

test('(A8) a turn with no NEW take HOLDS: no attempt spent, no cue, loop preserved', () => {
  const loop = enteredLoop();
  for (const takeKey of [null, 'take-1']) {
    const result = resolveSectionLoopTurn({
      sectionLoop: loop,
      signal: signalWith({ userUtterance: 'wait, what do you mean?' }),
      takeKey,
      phrase: PHRASE,
    });
    assert.equal(result.holdReason, 'no_new_take', `takeKey=${takeKey}`);
    assert.equal(result.hold, true, `takeKey=${takeKey}`);
    assert.equal(result.transition, null, 'a hold is not a transition and logs nothing');
    assert.equal(result.sectionLoop.attempts, 0, 'a question must not burn the cap');
    assert.equal(result.deterministicReply, null, 'the model answers the question');
    assert.equal(result.cardAction, null, 'the fragment stays on the card');
    assert.deepEqual(result.signalPatch, {
      isolating: true, fragment: 'brown', axis: 'pitch', attempts: 0,
    });
  }
});

test('(A8b) A SPOKEN QUESTION MID-LOOP IS ANSWERED, NOT SCORED AS AN ATTEMPT', () => {
  // The defect this pins: the hold used to key ONLY on "no new take", which assumed a
  // turn the learner did not take could be told apart by the take key. On the live
  // coach path that is false — phase A makes every finalized spoken segment an
  // analyzer take, so the key advances on a spoken QUESTION exactly as on a spoken
  // fragment. Reproduced: the question went unanswered, an engine cue was spoken at
  // the learner instead, attempts went 0 -> 1, and the witness claimed a measured
  // retry for an attempt that never happened. Two questions ate the cap.
  const loop = enteredLoop();
  const cases = [
    ['conversation', { coachingAction: 'converse', shouldCorrect: false, intent: 'continue_conversation' }],
    ['conversation', { shouldCorrect: false }],
    ['conversation', { coachingAction: 'converse' }],
    // A hum/siren/trill mid-loop has no word fragment in it: scoring it would spend
    // the cap on audio that was never the fragment, and could even false-exit as a
    // success on unrelated evidence.
    ['not_a_phrase_take', { takeKind: 'siren' }],
    ['not_a_phrase_take', { takeKind: 'hum_sovt' }],
    ['not_a_phrase_take', { takeKind: 'ear_training' }],
  ];
  for (const [reason, overrides] of cases) {
    const result = resolveSectionLoopTurn({
      sectionLoop: loop,
      signal: signalWith(overrides),
      // A take DID land — this is the live path, where every utterance does.
      takeKey: 'take-question',
      takeTranscript: 'what does that mean',
      phrase: PHRASE,
    });
    const where = JSON.stringify(overrides);
    assert.equal(result.holdReason, reason, where);
    assert.equal(result.hold, true, where);
    assert.equal(result.transition, null, `${where}: a hold is not a transition`);
    assert.equal(result.deterministicReply, null, `${where}: no cue is spoken at a question`);
    assert.equal(result.sectionLoop.attempts, 0, `${where}: no attempt is spent`);
    assert.equal(result.cardAction, null, `${where}: the fragment stays on the card`);
    assert.equal(result.witness, null, `${where}: and nothing false is filed`);
    assert.equal(result.signalPatch.isolating, true, `${where}: the model gets the context`);
  }

  // Two questions in a row still leave the full cap available.
  let held = loop;
  for (const key of ['q1', 'q2']) {
    held = resolveSectionLoopTurn({
      sectionLoop: held,
      signal: signalWith({ coachingAction: 'converse', shouldCorrect: false }),
      takeKey: key,
      phrase: PHRASE,
    }).sectionLoop;
  }
  assert.equal(held.attempts, 0, 'questions can never eat the cap');
});

test('(A9) resolveTakeKey prefers the normalized attemptId, then the finalize receipt', () => {
  assert.equal(resolveTakeKey({ lastAttemptArtifact: { attemptId: 'aa-9' } }), 'aa-9');
  assert.equal(resolveTakeKey({ lastAttemptArtifact: { attemptArtifactId: 'raw-9' } }), 'raw-9');
  assert.equal(resolveTakeKey({ lastTakeFinalizedAt: 1234 }), 'finalized:1234');
  assert.equal(resolveTakeKey({}), null, 'no take -> null, never a constant');
  assert.equal(resolveTakeKey(null), null);

  // And it really is the field a NORMALIZED artifact carries: a bare `.id` does not
  // exist on one, so reading that would have silently fallen through to the clock.
  const runtime = createStateRuntime();
  const normalized = runtime.normalizeVoiceState({
    lastAttemptArtifact: { attemptArtifactId: 'aa-normalized', summary: { voiceSessionId: 'vs-1' } },
  });
  assert.equal(normalized.lastAttemptArtifact.id, undefined);
  assert.equal(resolveTakeKey(normalized), 'aa-normalized');
});

test('(A10) voiceState normalizes and round-trips a live loop, and fails closed on a broken one', () => {
  const runtime = createStateRuntime();
  const loop = enteredLoop();

  const kept = runtime.normalizeVoiceState({ sectionLoop: loop, sectionLoopLastTakeKey: 'take-1' });
  assert.deepEqual(kept.sectionLoop, loop, 'a live loop survives persistence unchanged');
  assert.equal(kept.sectionLoopLastTakeKey, 'take-1');

  // Defaults exist so the field is never `undefined` on a fresh session.
  const fresh = runtime.normalizeVoiceState({});
  assert.equal(fresh.sectionLoop, null);
  assert.equal(fresh.sectionLoopLastTakeKey, null);

  // Fail-closed: an unreconstructable loop becomes null rather than half-restored.
  for (const broken of [
    { ...loop, axis: 'prosody' },
    { ...loop, axis: null },
    { ...loop, fragmentText: '', fragmentTokens: [] },
    'not-an-object',
    [],
  ]) {
    assert.equal(runtime.normalizeVoiceState({ sectionLoop: broken }).sectionLoop, null);
  }

  // Bounds are enforced, not trusted.
  const overrun = runtime.normalizeVoiceState({
    sectionLoop: { ...loop, attempts: 99, maxAttempts: 99, fragmentTokens: ['a', 'b', 'c', 'd', 'e'] },
  }).sectionLoop;
  assert.equal(overrun.maxAttempts, MAX_ATTEMPTS);
  assert.equal(overrun.attempts, MAX_ATTEMPTS);
  assert.equal(overrun.fragmentTokens.length, 3, 'a fragment is at most three words');
});

// ---------------------------------------------------------------------------
// (B) THE CARD
// ---------------------------------------------------------------------------

test('(B1) the fragment card holds only the fragment, at full emphasis, tagged section-loop', () => {
  const loop = { ...enteredLoop(), fragmentText: 'brown fox', fragmentTokens: ['brown', 'fox'] };
  const spec = buildFragmentCardSpec(loop, { targetPreset: 'cute-feminine' });
  const card = createCard(spec);

  assert.equal(card.phrase, 'brown fox');
  assert.deepEqual(card.tokens.map((t) => t.text), ['brown', 'fox']);
  assert.deepEqual(card.tokens.map((t) => t.emphasis), [3, 3]);
  assert.equal(card.source, 'section-loop', 'backend provenance is preserved');
  assert.equal(card.kind, 'drill');
  assert.equal(card.focus.axis, 'pitch');
  assert.ok(card.focus.statement, 'the strip still gets a focus statement');
  // An unknown source still degrades to the pre-phase-C behaviour.
  assert.equal(createCard({ phrase: 'x y', source: 'nonsense' }).source, 'tutor');
  assert.equal(createCard({ phrase: 'x y', source: 'fallback' }).source, 'fallback');
});

test('(B2) the whole-sentence card is stashed and restored byte-identical', () => {
  const store = new PracticeCardStore();
  const sentence = store.createCard('s1', { phrase: PHRASE, source: 'tutor' });
  // The tutor had emphasized a word on it — a re-authored twin would lose this.
  store.applyCardOps('s1', [{ op: 'emphasize', token: 'fox', level: 3 }]);
  const before = store.getActiveCard('s1');
  assert.notEqual(before.id, sentence.id, 'precondition: the emphasis bumped the card');

  const loop = { ...enteredLoop(), fragmentText: 'brown fox', fragmentTokens: ['brown', 'fox'] };
  store.stashActiveCard('s1', createCard(buildFragmentCardSpec(loop, {})));
  assert.equal(store.getActiveCard('s1').phrase, 'brown fox');
  assert.equal(store.hasStashedCard('s1'), true);

  store.restoreStashedCard('s1');
  assert.deepEqual(store.getActiveCard('s1'), before, 'the exact sentence card comes back');
  assert.equal(store.hasStashedCard('s1'), false);
});

test('(B3) a lost stash still returns the learner to a whole-sentence card', () => {
  const store = new PracticeCardStore();
  store.createCard('s2', { phrase: 'brown fox', source: 'section-loop' });
  store.restoreStashedCard('s2', { phrase: PHRASE, difficulty: 'easy', source: 'tutor' });
  assert.equal(store.getActiveCard('s2').phrase, PHRASE);
  assert.notEqual(store.getActiveCard('s2').source, 'section-loop');
  // NOT 'fallback': the frontend auto-speaks a fallback-sourced card, so an internal
  // recovery path must never make the app read the sentence aloud unprompted.
  assert.notEqual(store.getActiveCard('s2').source, 'fallback');

  // And an EMPTY store (fresh process, cleared cards) still recovers — "no card at
  // all" must not be mistaken for "something else owns the strip".
  const empty = new PracticeCardStore();
  empty.restoreStashedCard('s7', { phrase: PHRASE, difficulty: 'easy', source: 'tutor' });
  assert.equal(empty.getActiveCard('s7').phrase, PHRASE);
});

test('(B3b) a card authored DURING an isolation is never reverted by the stash', () => {
  // Reproduced during review: the learner picks their "one real sentence" while a
  // fragment is isolated; on exit the strip silently went back to the pre-isolation
  // drill line. The rule is that the stash is only valid while the loop still owns
  // the strip — i.e. while the active card is still a section-loop card.
  const store = new PracticeCardStore();
  store.createCard('s4', { phrase: PHRASE, source: 'tutor' });
  store.stashActiveCard('s4', createCard({ phrase: 'brown', source: 'section-loop' }));
  assert.equal(store.getActiveCard('s4').phrase, 'brown');

  store.createCard('s4', { phrase: 'I would like a coffee please', kind: 'real_sentence', source: 'tutor' });
  store.restoreStashedCard('s4');
  assert.equal(
    store.getActiveCard('s4').phrase,
    'I would like a coffee please',
    'the learner keeps the card they chose',
  );
  assert.equal(store.hasStashedCard('s4'), false, 'and the stale stash is dropped');

  // The same rule via applyCardOps, which mutates the active card directly and would
  // slip past a guard placed only in createCard/setActiveCard.
  const viaOps = new PracticeCardStore();
  viaOps.createCard('s5', { phrase: PHRASE, source: 'tutor' });
  viaOps.stashActiveCard('s5', createCard({ phrase: 'brown', source: 'section-loop' }));
  viaOps.applyCardOps('s5', [{ op: 'advance' }]);
  const advanced = viaOps.getActiveCard('s5').phrase;
  viaOps.restoreStashedCard('s5');
  assert.equal(viaOps.getActiveCard('s5').phrase, advanced, 'an advanced card is not reverted either');

  // But an op that EDITS the fragment keeps the loop's ownership, so the sentence
  // still comes back — otherwise an emphasize would strand the learner on a fragment.
  const edited = new PracticeCardStore();
  edited.createCard('s6', { phrase: PHRASE, source: 'tutor' });
  edited.stashActiveCard('s6', createCard({
    phrase: 'brown fox', source: 'section-loop', tokens: [{ text: 'brown', emphasis: 3 }, { text: 'fox', emphasis: 3 }],
  }));
  edited.applyCardOps('s6', [{ op: 'emphasize', token: 'fox', level: 1 }]);
  assert.equal(edited.getActiveCard('s6').source, 'section-loop', 'an edit keeps the loop provenance');
  edited.restoreStashedCard('s6');
  assert.equal(edited.getActiveCard('s6').phrase, PHRASE, 'so the sentence still comes back');
});

test('(B4) a second stash never overwrites the sentence with a fragment', () => {
  const store = new PracticeCardStore();
  store.createCard('s3', { phrase: PHRASE, source: 'tutor' });
  store.stashActiveCard('s3', createCard({ phrase: 'brown fox', source: 'section-loop' }));
  store.stashActiveCard('s3', createCard({ phrase: 'quick brown', source: 'section-loop' }));
  store.restoreStashedCard('s3');
  assert.equal(store.getActiveCard('s3').phrase, PHRASE);
});

// ---------------------------------------------------------------------------
// (C) THE CUE TABLE
// ---------------------------------------------------------------------------

test('(C1) every axis has at least three distinct cues with unique ids', () => {
  const seen = new Set();
  for (const axis of SECTION_LOOP_AXES) {
    const cues = SECTION_CUES[axis];
    assert.ok(Array.isArray(cues) && cues.length >= 3, `${axis} needs >= 3 cues, has ${cues?.length}`);
    const texts = new Set();
    for (const cue of cues) {
      assert.ok(cue.id && cue.text, `${axis} cue shape`);
      assert.equal(seen.has(cue.id), false, `duplicate cue id ${cue.id}`);
      assert.equal(texts.has(cue.text), false, `duplicate cue text in ${axis}`);
      seen.add(cue.id);
      texts.add(cue.text);
    }
  }
});

test('(C2) no cue repeats inside one loop, on any axis', () => {
  for (const axis of SECTION_LOOP_AXES) {
    let loop = enteredLoop({ worst: { axis, direction: 'under' } });
    assert.equal(loop.axis, axis);
    const issued = [];
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      const result = resolveSectionLoopTurn({
        sectionLoop: loop,
        signal: signalWith({
          axisStatus: { pitch: 'below', resonance: 'too_dark', weight: 'too_light' },
          userUtterance: 'brown',
        }),
        takeKey: `t-${i}`,
        phrase: PHRASE,
      });
      assert.equal(result.transition, 'retry');
      issued.push(result.witness.cueId);
      loop = result.sectionLoop;
    }
    assert.equal(new Set(issued).size, issued.length, `${axis} repeated a cue: ${issued}`);
    assert.deepEqual(loop.usedCueIds, issued, `${axis} usedCueIds tracks every spent cue`);
    assert.equal(loop.lastCueId, issued[issued.length - 1]);
  }
});

test('(C2b) pickSectionCue is total, and the >=3-cue requirement is EXERCISED not just counted', () => {
  assert.equal(pickSectionCue('prosody'), null);
  assert.equal(pickSectionCue(null), null);
  const all = SECTION_CUES.pitch.map((c) => c.id);
  assert.ok(pickSectionCue('pitch', all), 'never returns nothing to say');

  // (C2) only drives two retries, so the third distinct cue is never issued there —
  // the >=3 requirement would otherwise rest on (C1) counting the table, which is the
  // implementation asserting itself. Drive the picker past two spent cues on every
  // axis and require a genuinely new one each time.
  for (const axis of SECTION_LOOP_AXES) {
    const spent = [];
    for (let i = 0; i < 3; i += 1) {
      const cue = pickSectionCue(axis, spent);
      assert.ok(cue, `${axis} ran out of cues at ${i + 1}`);
      assert.equal(spent.includes(cue.id), false, `${axis} repeated ${cue.id} at pick ${i + 1}`);
      spent.push(cue.id);
    }
    assert.equal(spent.length, 3, `${axis} yielded three distinct cues`);
  }
});

test('(C3) DIRECTION LAW: every cue survives the runtime pipeline in BOTH directions', () => {
  // The failure this guards is measured and specific: a cue naming a pitch or
  // resonance DIRECTION is deleted whole by the cross-direction stripper for the
  // opposite learner, and the turn collapses to an acknowledgment with no action in
  // it. An engine cue that can be deleted is not an engine cue.
  // 2026-07-26 MTF-ONLY: the masculinizing row is retired with the direction it
  // tested. The guarantee is unchanged — no cue may be deleted by the stripper —
  // and it is still proven against every direction the product can produce.
  const directions = [
    ['feminizing', { styleTarget: 'cute-feminine', direction: 'mtf' }],
    ['none', { styleTarget: 'androgynous' }],
    ['retired-ftm', { styleTarget: 'masc-natural' }],
  ];
  const everyString = [
    ...SECTION_LOOP_AXES.flatMap((axis) => SECTION_CUES[axis].map((c) => [`${axis}/${c.id}`, c.text])),
    ['cap-exit', SECTION_LOOP_CAP_EXIT],
  ];

  for (const [where, text] of everyString) {
    for (const [name, base] of directions) {
      const out = sanitizeCoachReply(text, {
        ...base,
        mode: 'active_drill',
        policy: { shouldCorrect: true, coachingAction: 'coach', avoidTopics: [], safetyState: 'normal', maxCueCount: 1 },
        takeQuality: { usable: true },
        personalization: {},
      });
      assert.equal(out, text, `${where} was rewritten for a ${name} learner:\n  in:  ${text}\n  out: ${out}`);
    }
  }
});

test('(C3a) the cross-direction stripper is actually LOADED — this box, this run', () => {
  // sanitizer.js requires the stripper by ABSOLUTE PATH from a sibling repo, inside a
  // try/catch that leaves it null on failure, and the call sites guard on
  // `typeof === 'function'`. On a checkout without that repo the direction tests
  // would silently degrade to no-ops and still pass green. Assert the capability
  // itself, so an absent stripper FAILS here instead of quietly voiding (C3)/(C3b).
  const mtf = {
    mode: 'active_drill', styleTarget: 'cute-feminine', direction: 'mtf',
    policy: { shouldCorrect: true, coachingAction: 'coach', avoidTopics: [], safetyState: 'normal', maxCueCount: 1 },
    takeQuality: { usable: true }, personalization: {},
  };
  const crossDirection = 'Drop into chest resonance on those words and add weight.';
  assert.notEqual(
    sanitizeCoachReply(crossDirection, mtf),
    crossDirection,
    'the cross-direction stripper is not loaded — every direction assertion below is void',
  );
});

test('(C3b) the direction check has TEETH: a direction-naming cue really is rejected', () => {
  // Guards against (C3) passing because the stripper stopped loading or stopped
  // matching. Each of these is a cue a well-meaning author might write; each is
  // deleted for the OPPOSITE learner, which is exactly what (C3) forbids. If this
  // test ever passes trivially, (C3)'s guarantee is worthless.
  const signalFor = (styleTarget, direction) => ({
    mode: 'active_drill',
    styleTarget,
    direction,
    policy: { shouldCorrect: true, coachingAction: 'coach', avoidTopics: [], safetyState: 'normal', maxCueCount: 1 },
    takeQuality: { usable: true },
    personalization: {},
  });
  // 2026-07-27 cue-vocabulary law: these two cues used to say "brighten the
  // vowel" and "drop into chest resonance". Both are now banned outright
  // (quality_bright / register_folklore), so BOTH were being rewritten by the
  // vocabulary law rather than by the direction filter — which made this test
  // pass for the wrong reason and then fail on the androgynous control.
  // MEASURED with the new wording: the feminizing cue survives MTF unchanged,
  // the masculinizing cue is stripped for MTF and survives for a learner with
  // no direction, so the direction filter is again the only thing under test.
  const feminizingCue = 'Let the pitch of those words step up a little and keep the tongue high and forward.';
  const masculinizingCue = 'Let the larynx settle lower on those words and add weight.';

  // 2026-07-26 MTF-ONLY: the masculinizing LEARNER is retired, but the
  // masculinizing CUE is exactly what must never reach the surviving feminizing
  // learner — so that half is the teeth now, and it is asserted, not deleted.
  assert.notEqual(
    sanitizeCoachReply(masculinizingCue, signalFor('cute-feminine', 'mtf')),
    masculinizingCue,
    'a masculinizing cue must still be stripped for a feminizing learner',
  );
  // The filter must be DIRECTION-GATED, not a blanket ban: the same cue survives
  // for a learner with no direction. This is what proves the (C3) table is
  // passing on merit rather than because the stripper stopped matching.
  assert.equal(sanitizeCoachReply(masculinizingCue, signalFor('androgynous', null)), masculinizingCue);
  // No false positive on the surviving direction's own cue.
  assert.equal(sanitizeCoachReply(feminizingCue, signalFor('cute-feminine', 'mtf')), feminizingCue);

  // So "survives EVERY direction" — what (C3) asserts of all twelve cues — is a
  // real constraint that a direction-naming cue fails and the table passes.
  const survivesAll = sanitizeCoachReply(masculinizingCue, signalFor('cute-feminine', 'mtf')) === masculinizingCue
    && sanitizeCoachReply(masculinizingCue, signalFor('androgynous', null)) === masculinizingCue;
  assert.equal(survivesAll, false, `a direction-naming cue must not pass (C3): ${masculinizingCue}`);
});

test('(C4) every cue is an executable body action inside the spoken budget', () => {
  const BODY = /\b(tongue|lips?|jaw|palate|teeth|mouth|shoulders?|neck|chin|chest|throat|hand|palm|fingers|spine|ears?)\b/i;
  const VERB = /\b(let|keep|say|start|lift|spread|loosen|release|drop|rest|carry|speak|hold)\b/i;
  for (const axis of SECTION_LOOP_AXES) {
    for (const cue of SECTION_CUES[axis]) {
      assert.match(cue.text, BODY, `${cue.id} names no body part`);
      assert.match(cue.text, VERB, `${cue.id} names no physical action`);
      assert.ok(cue.text.trim().split(/\s+/).length <= 45, `${cue.id} exceeds 45 spoken words`);
      assert.ok(cue.text.split(/(?<=[.!?])\s+/).filter(Boolean).length <= 2, `${cue.id} exceeds two sentences`);
      assert.equal(/\d/.test(cue.text), false, `${cue.id} contains a numeral`);
    }
  }
  assert.ok(SECTION_LOOP_CAP_EXIT.trim().split(/\s+/).length <= 45);
});

// ---------------------------------------------------------------------------
// (D) PRODUCT LAWS — the CONTENT tier
// ---------------------------------------------------------------------------

// The same stricter bar content-product-laws.test.js applies to code-owned copy.
// Restated here (rather than imported) because that file exports nothing; the SOURCE
// scan there now covers coaching/section-loop.js, so the two surfaces agree.
const CONTENT_ONLY_RULES = [
  { code: 'content_away_place', pattern: /\b(?:on your own|by yourself|at home|in your own time)\b/i },
  { code: 'content_future_day', pattern: /\b(?:tomorrow|yesterday|next time|next session|next week|this week|later today|later tonight)\b/i },
  { code: 'content_cadence', pattern: /\b(?:each day|every day|daily|nightly|weekly)\b/i },
  { code: 'content_mirror_word', pattern: /\bmirrors?\b/i },
  { code: 'content_playback', pattern: /\bplay\s+(?:two|both|back|your|the|a)\b[^'"`]{0,28}\btakes?\b|\btakes?\s+back to back\b/i },
  { code: 'content_life_transfer', pattern: /\b(?:out )?into the world\b|\bcarry (?:it|this|that|one|the sentence)\b[^'"`]{0,24}\bwith you\b/i },
];
const ALL_CONTENT_RULES = [...HOMEWORK_RULES, ...EQUIPMENT_RULES, ...CONTENT_ONLY_RULES];
const firstViolation = (text) => (ALL_CONTENT_RULES.find((r) => r.pattern.test(String(text || ''))) || {}).code || null;

test('(D1) every code-owned spoken string in this module is lawful under the content tier', () => {
  const strings = [
    ...SECTION_LOOP_AXES.flatMap((axis) => SECTION_CUES[axis].map((c) => [`${axis}/${c.id}`, c.text])),
    ['cap-exit', SECTION_LOOP_CAP_EXIT],
  ];
  assert.equal(strings.length, 13, 'the whole spoken inventory is scanned, not a sample');
  for (const [where, text] of strings) {
    assert.equal(firstViolation(text), null, `content-law violation in ${where}: ${text}`);
  }
  // Teeth: the scan is really running.
  assert.equal(firstViolation('Practise those words at home tomorrow.'), 'practice_away');
  assert.equal(firstViolation('Blow through a straw on those words.'), 'object_straw');
});

test('(D2) the prompt lines are time-blind, prop-free, name-free and carry no pressure', () => {
  const TIME_WORDS = /\b(minutes?|mins?|seconds?|secs?|hours?|timers?|countdown|clock|stopwatch|duration|time left|time's up|out of time|how long)\b/i;
  const PROP_WORDS = /\b(straws?|pencils?|spoons?|candles?|tissues?|mirrors?|balloons?|kazoos?|cup of)\b/i;
  const ONE_MORE_PRESSURE = /\b(one more\?|just one more)\b/i;

  const surfaces = [
    buildRendererSystemPrompt(false),
    buildRendererUserMessage({ ...signalWith(), sectionLoop: { entering: true, fragment: 'brown fox', axis: 'pitch' } }),
    buildRendererUserMessage({ ...signalWith(), sectionLoop: { isolating: true, fragment: 'brown fox', axis: 'weight', attempts: 2 } }),
    buildRendererUserMessage({ ...signalWith(), sectionLoop: { reassembling: true, fragment: 'brown fox', phrase: PHRASE } }),
  ];
  for (const surface of surfaces) {
    assert.doesNotMatch(surface, TIME_WORDS);
    assert.doesNotMatch(surface, PROP_WORDS);
    assert.doesNotMatch(surface, ONE_MORE_PRESSURE);
  }
  // The system prompt really does teach the flow, all three states named.
  const sp = buildRendererSystemPrompt(false);
  assert.match(sp, /"SectionLoop:" line/);
  assert.match(sp, /ENTERING/);
  assert.match(sp, /ISOLATING/);
  assert.match(sp, /REASSEMBLING/);
  assert.match(sp, /Never read the "SectionLoop:" line out loud/);
  assert.match(sp, /If the learner speaks the whole line while you are isolating/i);
});

// ---------------------------------------------------------------------------
// (E) SIGNAL / RENDERER INTEGRATION
// ---------------------------------------------------------------------------

test('(E1) entry and reassembly render exactly one SectionLoop line each', () => {
  const entering = buildRendererUserMessage({
    ...signalWith(),
    sectionLoop: { entering: true, fragment: 'brown fox', axis: 'pitch', direction: 'under' },
  });
  const entryLines = entering.split('\n').filter((l) => l.startsWith('SectionLoop:'));
  assert.equal(entryLines.length, 1);
  assert.equal(
    entryLines[0],
    'SectionLoop: ENTERING "brown fox" — pitch dipped too low there. The card now shows only that fragment. Say those words back, give ONE physical cue for them, and ask only for that fragment.',
  );
  // The "how it missed" clause is the phase-B vocabulary, per axis and per side,
  // and it degrades to the bare axis when the side is unknown.
  const entryFor = (axis, direction) => buildRendererUserMessage({
    ...signalWith(), sectionLoop: { entering: true, fragment: 'brown', axis, direction },
  }).split('\n').find((l) => l.startsWith('SectionLoop:'));
  assert.match(entryFor('resonance', 'over'), /resonance tongue pushed too far forward there\./);
  assert.match(entryFor('weight', 'under'), /weight ran thin and light there\./);
  assert.match(entryFor('pitch', null), /ENTERING "brown" — pitch\. The card/);

  const reassembling = buildRendererUserMessage({
    ...signalWith(),
    sectionLoop: { reassembling: true, fragment: 'brown fox', phrase: PHRASE },
  });
  const reLines = reassembling.split('\n').filter((l) => l.startsWith('SectionLoop:'));
  assert.equal(reLines.length, 1);
  assert.match(reLines[0], /REASSEMBLING — "brown fox" landed\./);
  assert.match(reLines[0], /invite the whole line/);
});

test('(E2) the teardown line supersedes the phase-B weak-section line, never doubles it', () => {
  const isolating = buildRendererUserMessage({
    ...signalWith(),
    sectionLoop: { isolating: true, fragment: 'brown', axis: 'pitch', attempts: 1 },
  });
  assert.match(isolating, /SectionLoop: ISOLATING/);
  assert.equal(isolating.includes('Weak section:'), false, 'two instructions about the same words is one too many');

  // With no loop running, phase B's line is untouched.
  const noLoop = buildRendererUserMessage(signalWith());
  assert.match(noLoop, /Weak section: "brown"/);
  assert.equal(noLoop.includes('SectionLoop:'), false);

  // A malformed or empty patch renders nothing at all rather than a broken line.
  for (const patch of [{}, { entering: true }, { isolating: true, fragment: '' }, null]) {
    const rendered = buildRendererUserMessage({ ...signalWith(), sectionLoop: patch });
    assert.equal(rendered.includes('SectionLoop:'), false, JSON.stringify(patch));
  }
});

test('(E3) a retry NEVER calls the model; entry and reassembly DO', async () => {
  const voiceState = { targetPreset: 'cute-feminine', lastTakeFinalizedAt: 42 };
  let calls = 0;
  const callModel = async () => { calls += 1; return 'model line'; };

  // The signal a real buildSignal produces here carries no confident section (no
  // take artifact), so the loop is driven from explicit state — which is exactly
  // how the runtime drives it.
  const loop = enteredLoop();

  const retry = await coachingTurn({
    voiceState,
    userMessage: 'brown',
    callModel,
    sectionLoop: loop,
    sectionLoopLastTakeKey: null,
    cardPhrase: PHRASE,
  });
  assert.equal(calls, 0, 'THE LATENCY LAW: a retry pays no model round-trip');
  assert.equal(retry.sectionLoop.deterministicReply, retry.rawReply, "the verdict names the engine line");
  assert.equal(retry.fallbackReply, false, 'an engine cue is a designed reply, not a failure');
  assert.equal(retry.sectionLoop.transition, 'retry');
  assert.ok(SECTION_CUES.pitch.some((c) => c.text === retry.rawReply), 'the reply came from the cue table');
  // And it still crossed the sanitizer like any other line.
  assert.equal(retry.sanitizedReply, retry.rawReply);

  // A hold turn (no new take) DOES go to the model — the learner asked something.
  const hold = await coachingTurn({
    voiceState: { ...voiceState, lastTakeFinalizedAt: null },
    userMessage: 'what do you mean?',
    callModel,
    sectionLoop: loop,
    cardPhrase: PHRASE,
  });
  assert.equal(calls, 1, 'a question mid-isolation is answered by the model');
  assert.equal(hold.sectionLoop.hold, true);
  assert.equal(hold.signal.sectionLoop.isolating, true);
});

test('(E4) the cap exit is engine-authored and survives the live sanitizer verbatim', async () => {
  let calls = 0;
  const atCap = { ...enteredLoop(), attempts: MAX_ATTEMPTS - 1 };
  const result = await coachingTurn({
    voiceState: { targetPreset: 'cute-feminine', lastTakeFinalizedAt: 99 },
    userMessage: 'brown',
    callModel: async () => { calls += 1; return 'model line'; },
    sectionLoop: atCap,
    cardPhrase: PHRASE,
  });
  assert.equal(calls, 0);
  assert.equal(result.sectionLoop.transition, 'exited_cap');
  assert.equal(result.rawReply, SECTION_LOOP_CAP_EXIT);
  assert.equal(result.sanitizedReply, SECTION_LOOP_CAP_EXIT, 'the warm exit reaches the learner intact');
  assert.equal(result.sectionLoop.sectionLoop, null, 'and the loop is gone');
});

// ---------------------------------------------------------------------------
// (F) FRESHNESS + USABILITY GATES
// ---------------------------------------------------------------------------

test('(F1) an UNUSABLE fragment take spends an attempt but is never a success', () => {
  const loop = enteredLoop();
  const result = resolveSectionLoopTurn({
    sectionLoop: loop,
    // takeQuality.usable false, and the axis reads clean — the trap this guards.
    signal: signalWith({ usable: false, axisStatus: { pitch: 'in_band' }, userUtterance: 'brown' }),
    takeKey: 'take-2',
    phrase: PHRASE,
  });
  assert.equal(result.transition, 'retry', 'never exited_success on unusable evidence');
  assert.equal(result.sectionLoop.attempts, 1, 'it still costs an attempt');
  assert.equal(result.witness.usable, false, 'and the witness says so');
  assert.equal(result.witness.reason, 'measurement_unusable');
});

test('(F2) an UNMEASURED axis is neither success nor failure evidence', () => {
  for (const status of ['uncertain', 'unstable']) {
    const verdict = readAxisVerdict(signalWith({ axisStatus: { pitch: status } }), 'pitch');
    assert.equal(verdict.measured, false, status);
    assert.equal(verdict.clean, false, status);

    const result = resolveSectionLoopTurn({
      sectionLoop: enteredLoop(),
      signal: signalWith({ axisStatus: { pitch: status }, userUtterance: 'brown' }),
      takeKey: 'take-2',
      phrase: PHRASE,
    });
    assert.equal(result.transition, 'retry', status);
    assert.equal(result.witness.usable, false, status);
  }
  // Each axis's own in-band verdict is read correctly.
  assert.equal(readAxisVerdict(signalWith({ axisStatus: { pitch: 'in_band' } }), 'pitch').clean, true);
  assert.equal(readAxisVerdict(signalWith({ axisStatus: { pitch: 'above' } }), 'pitch').clean, false);
  assert.equal(readAxisVerdict(signalWith({ axisStatus: { resonance: 'target' } }), 'resonance').clean, true);
  assert.equal(readAxisVerdict(signalWith({ axisStatus: { resonance: 'too_bright' } }), 'resonance').clean, false);
  assert.equal(readAxisVerdict(signalWith({ axisStatus: { weight: 'target' } }), 'weight').clean, true);
  assert.equal(readAxisVerdict(signalWith({ axisStatus: { weight: 'too_heavy' } }), 'weight').clean, false);
});

test('(F3) an unusable run reaches the cap and exits warmly — it never hangs open', () => {
  let loop = enteredLoop();
  let last = null;
  for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
    last = resolveSectionLoopTurn({
      sectionLoop: loop,
      signal: signalWith({ usable: false, userUtterance: 'brown' }),
      takeKey: `t-${i}`,
      phrase: PHRASE,
    });
    loop = last.sectionLoop;
  }
  assert.equal(last.transition, 'exited_cap');
  assert.equal(last.sectionLoop, null);
  assert.equal(last.witness.usable, false, 'honest: the cap was reached without measured evidence');
});

test('(F4) a STALE take can never open a loop (the phase-B freshness gate, end to end)', () => {
  // Driven through the REAL buildSignal so the freshness plumbing is exercised, not
  // simulated: a take finalized before this turn's window is stripped, so there is
  // no takeSections block for the loop to enter on.
  const SESSION_STARTED_AT = 1_700_000_000_000;
  const timeline = [];
  for (let i = 0; i < 100; i += 1) {
    const progress = i / 99;
    timeline.push({
      t: Math.round(progress * 2000),
      voiced: true,
      pitchHz: progress >= 0.4 && progress < 0.6 ? 145 : 210,
      resonanceScore: 0.6,
      weightScore: 0.2,
      confidence: 0.9,
    });
  }
  const target = {
    source: 'preset', targetPreset: 'cute-feminine', direction: 'feminine',
    pitchFloorHz: 188, pitchCeilingHz: 255,
    resonanceFloor: 0.32, resonanceCeiling: 1, weightFloor: 0, weightCeiling: 0.4,
    minTargetHitPct: 0.28,
  };
  const advanced = {
    measurementAvailable: true, sampleCount: 100, voicedFramePct: 1,
    confidentFramePct: 0.95, scoreConfidence: 0.9, captureReliability: 0.9,
    snrDb: 24, clippingPct: 0, pitchValidFrameCount: 100, medianPitchHz: 205,
  };
  const stateAt = (finalizedAt) => ({
    sessionStartedAt: SESSION_STARTED_AT,
    targetPreset: 'cute-feminine',
    lastTakeFinalizedAt: finalizedAt,
    lastSummary: {
      voiceSessionId: 'vs-c', durationMs: 2000, targetPreset: 'cute-feminine',
      target: { ...target }, metrics: { pitchHz: 205, resonance: 0.6, weight: 0.2, advanced }, issues: [],
    },
    lastAttemptArtifact: {
      attemptId: `aa-${finalizedAt}`, voiceSessionId: 'vs-c', finalizedAt,
      target: { ...target }, metrics: { pitchHz: 205, resonance: 0.6, weight: 0.2, advanced },
      durationMs: 2000, timeline,
    },
    voiceInputRuntime: { previousInputTurnAt: SESSION_STARTED_AT + 1_000 },
  });
  const build = (finalizedAt) => buildSignal({
    voiceState: stateAt(finalizedAt),
    userMessage: 'how did that sound',
    practiceMode: 'active_drill',
    targetPreset: 'cute-feminine',
    cardTokens: ['The', 'quick', 'brown', 'fox', 'ran'].map((text) => ({ text, emphasis: 1, focusHint: '' })),
    turnWindowStartedAt: SESSION_STARTED_AT + 2_000,
    now: SESSION_STARTED_AT + 6_000,
  });

  const stale = build(SESSION_STARTED_AT + 500);
  assert.equal(stale.decisionWitness.intent.takeFreshness.fresh, false, 'precondition: gated as stale');
  assert.equal(stale.takeSections, undefined);
  assert.equal(
    resolveSectionLoopTurn({
      sectionLoop: null, signal: stale, takeKey: resolveTakeKey(stateAt(SESSION_STARTED_AT + 500)), phrase: PHRASE,
    }).transition,
    null,
    'a stale take must not tear a sentence apart',
  );

  const fresh = build(SESSION_STARTED_AT + 5_000);
  assert.equal(fresh.takeSections.worst.confident, true, 'precondition: the fresh twin does localize');
  const opened = resolveSectionLoopTurn({
    sectionLoop: null, signal: fresh, takeKey: resolveTakeKey(stateAt(SESSION_STARTED_AT + 5_000)), phrase: PHRASE,
  });
  assert.equal(opened.transition, 'entered');
  assert.equal(opened.sectionLoop.fragmentText, 'brown');
  assert.equal(opened.sectionLoop.axis, 'pitch');
  assert.equal(opened.sectionLoop.lastTakeKey, 'aa-1700000005000');
});

test('(F5) one complete loop, end to end — the transcript this pedagogy promises', () => {
  // entry -> deterministic retry -> success -> reassembly, with the witness line for
  // every transition. This is the walkthrough the phase-C report quotes.
  const transcript = [];
  const store = new PracticeCardStore();
  store.createCard('sess', { phrase: PHRASE, source: 'tutor' });

  // 1. The learner speaks the line; "brown" is confidently flat.
  const entry = resolveSectionLoopTurn({
    sectionLoop: null, lastTakeKey: null, signal: signalWith(),
    takeKey: 'take-1', phrase: PHRASE, now: 1_700_000_000_000,
  });
  store.stashActiveCard('sess', createCard(buildFragmentCardSpec(entry.sectionLoop, {})));
  transcript.push([entry.transition, store.getActiveCard('sess').phrase, entry.deterministicReply]);

  // 2. The fragment comes back still flat -> ONE engine cue, no model call.
  const retry = resolveSectionLoopTurn({
    sectionLoop: entry.sectionLoop,
    signal: signalWith({ axisStatus: { pitch: 'below' }, userUtterance: 'brown' }),
    takeKey: 'take-2', phrase: PHRASE,
  });
  transcript.push([retry.transition, store.getActiveCard('sess').phrase, retry.deterministicReply]);

  // 3. The fragment lands -> reassemble, whole sentence back on the card.
  const success = resolveSectionLoopTurn({
    sectionLoop: retry.sectionLoop,
    signal: signalWith({ axisStatus: { pitch: 'in_band' }, userUtterance: 'brown' }),
    takeKey: 'take-3', phrase: PHRASE,
  });
  store.restoreStashedCard('sess');
  transcript.push([success.transition, store.getActiveCard('sess').phrase, success.deterministicReply]);

  assert.deepEqual(transcript.map((row) => row[0]), ['entered', 'retry', 'exited_success']);
  assert.deepEqual(transcript.map((row) => row[1]), ['brown', 'brown', PHRASE]);
  assert.equal(transcript[0][2], null, 'entry is LLM-phrased');
  assert.ok(transcript[1][2], 'the retry is engine-authored');
  assert.equal(transcript[2][2], null, 'reassembly is LLM-phrased');

  // Witness shape, exactly as the runtime spreads it into coach_gates.
  assert.deepEqual(
    [entry, retry, success].map((r) => ({ state: r.witness.state, attempts: r.witness.attempts })),
    [
      { state: 'entered', attempts: 0 },
      { state: 'retry', attempts: 1 },
      { state: 'exited_success', attempts: 2 },
    ],
  );
  // And the loop really is closed with the guard armed.
  assert.equal(success.sectionLoop, null);
  assert.equal(success.lastTakeKey, 'take-3');
});

// (A9) Strip takeover mid-loop: a card authored by anyone else (a model create
// op on a HOLD turn, an advance) means the fragment is no longer on screen.
// Drilling invisible words is the half-performed isolation the entry guard
// refuses, so the loop closes, the NEWER card wins (no restore), no cue is
// spoken, and attempts freeze. Reviewer-reproduced 2026-07-26.
test('(A9) a mid-loop card takeover closes the loop without a cue or a restore', () => {
  const loop = enteredLoop();
  const result = resolveSectionLoopTurn({
    sectionLoop: { ...loop, attempts: 1 },
    lastTakeKey: 'take-1',
    signal: signalWith({}),
    takeKey: 'take-2',
    phrase: PHRASE,
    stripOwned: false,
  });
  assert.equal(result.transition, 'exited_card_takeover');
  assert.equal(result.sectionLoop, null);
  assert.equal(result.cardAction, null, 'the newer card wins — no restore');
  assert.equal(result.deterministicReply, null, 'no cue on a takeover exit');
  assert.equal(result.witness.state, 'exited_card_takeover');
  assert.equal(result.witness.attempts, 1, 'attempts frozen, not incremented');
  assert.equal(result.witness.reason, 'card_takeover');
  // Owned strip (or no card at all) keeps the loop alive — the default path.
  const owned = resolveSectionLoopTurn({
    sectionLoop: { ...loop, attempts: 1 },
    lastTakeKey: 'take-1',
    signal: signalWith({}),
    takeKey: 'take-2',
    phrase: PHRASE,
    stripOwned: true,
  });
  assert.notEqual(owned.transition, 'exited_card_takeover');
});
