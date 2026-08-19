'use strict';

// Defect 4 (2026-07-26) — the drill recommendation was stateless: the runtime
// called recommendVoiceDrillIds with NO summary and NO history, so voice-drills
// gave every 'starter' drill a flat +1.2 and returned one fixed permutation of
// the same three drills forever, no matter what the learner's takes said and no
// matter how many times the frontend re-fetched.
//
// ALSO (2026-07-26) — a no-speech turn on a VOCALISE drill (hum / SOVT / siren /
// sustained) is a wordless practice turn, not a failure: the ASR is supposed to
// find no words. The turn used to return before any coach turn was built, so
// the learner heard nothing back.
//
// Prediction before running: summary-driven scoring changes the recommendation;
// two consecutive fetches rotate; a hum drill gets an acknowledgment on
// no-speech; a phrase drill's no-speech behavior is untouched.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createVoiceStandaloneRuntime } = require('./voice-standalone-runtime');
const {
  getVoiceDrillPack,
  recommendVoiceDrillIds,
  RECENTLY_PRESCRIBED_MEMORY,
} = require('./voice-drills');

function createRuntime(overrides = {}) {
  return createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => null,
      recordVoiceAttempt: () => {},
    },
    fetchImpl: async () => { throw new Error('offline test'); },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// (a) + (c) summary-driven variation
// ---------------------------------------------------------------------------

test('recommendVoiceDrillIds varies with the summary instead of returning one fixed permutation', () => {
  const targetPreset = 'cute-feminine';
  const noSummary = recommendVoiceDrillIds({ targetPreset });

  // A take whose issues point at resonance should not produce the same list as
  // one that points at pitch stability.
  const resonance = recommendVoiceDrillIds({
    targetPreset,
    summary: { issues: ['resonance sits too far back'], metrics: { targetHitPct: 0.3 } },
  });
  const pitch = recommendVoiceDrillIds({
    targetPreset,
    summary: { issues: ['pitch drifts and wobbles'], metrics: { targetHitPct: 0.3 } },
  });

  assert.notDeepEqual(resonance, noSummary, 'a summary must change the recommendation');
  assert.notDeepEqual(
    resonance,
    pitch,
    'different measured issues must recommend different drills',
  );
});

// ---------------------------------------------------------------------------
// (b) recently-prescribed down-ranking
// ---------------------------------------------------------------------------

test('recently prescribed drills are down-ranked, not hard-excluded', () => {
  const targetPreset = 'cute-feminine';
  const first = recommendVoiceDrillIds({ targetPreset });
  const second = recommendVoiceDrillIds({ targetPreset, recentDrillIds: first });

  assert.notDeepEqual(second, first, 'the permutation rotates');
  assert.notEqual(second[0], first[0], 'the top pick moves on');

  // Down-ranked, NOT excluded: an explicitly selected drill still wins even
  // when it was the most recent recommendation.
  const selected = first[0];
  const withSelection = recommendVoiceDrillIds({
    targetPreset,
    recentDrillIds: first,
    selectedLessonId: selected,
  });
  assert.equal(withSelection[0], selected, 'the learner\'s own choice still outranks the penalty');
});

test('drill rotation is bounded by the recently-prescribed memory', () => {
  const targetPreset = 'cute-feminine';
  const pack = getVoiceDrillPack(targetPreset);
  assert.ok(pack.length > RECENTLY_PRESCRIBED_MEMORY, 'the pack is larger than the memory window');
  const oversized = pack.map((drill) => drill.id);
  // Ids beyond the memory window carry no penalty at all.
  const penalised = recommendVoiceDrillIds({ targetPreset, recentDrillIds: oversized });
  assert.equal(penalised.length, 3);
});

// ---------------------------------------------------------------------------
// The runtime wiring: the recommendation actually rotates across fetches
// ---------------------------------------------------------------------------

test('consecutive drill fetches rotate because the session remembers what it prescribed', async () => {
  const runtime = createRuntime();
  await runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: 'drill-session',
    studentId: 'drill-learner',
  });

  const first = await runtime.voiceOperationRouteHandlers.getVoiceDrills({ sessionId: 'drill-session' });
  const second = await runtime.voiceOperationRouteHandlers.getVoiceDrills({ sessionId: 'drill-session' });

  assert.equal(first.recommendedIds.length, 3);
  assert.notDeepEqual(
    second.recommendedIds,
    first.recommendedIds,
    'the same three drills forever was the bug',
  );
  // The rotation clock is real session state, not a per-call random.
  const stored = runtime.sessions.get('drill-session').voiceState.recentDrillIds;
  assert.deepEqual(stored.slice(0, 3), second.recommendedIds);
  const third = await runtime.voiceOperationRouteHandlers.getVoiceDrills({ sessionId: 'drill-session' });
  assert.notDeepEqual(third.recommendedIds, second.recommendedIds, 'and it keeps rotating');
});

test('a session with a measured summary recommends from the summary, not the starter ordering', async () => {
  const runtime = createRuntime();
  await runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: 'summary-session',
    studentId: 'summary-learner',
  });
  const blank = await runtime.voiceOperationRouteHandlers.getVoiceDrills({ sessionId: 'summary-session' });

  // Plant a measured take on the session, exactly as finalizeVoiceTake would.
  const runtime2 = createRuntime();
  await runtime2.appCompatibilityRouteHandlers.startSession({
    sessionId: 'summary-session',
    studentId: 'summary-learner',
  });
  const session = runtime2.sessions.get('summary-session');
  session.voiceState = {
    ...session.voiceState,
    lastSummary: {
      issues: ['resonance sits too far back'],
      metrics: { targetHitPct: 0.3, meanPitchHz: 165 },
    },
  };
  const measured = await runtime2.voiceOperationRouteHandlers.getVoiceDrills({ sessionId: 'summary-session' });

  assert.notDeepEqual(
    measured.recommendedIds,
    blank.recommendedIds,
    'a measured take must steer the recommendation',
  );
});

// ---------------------------------------------------------------------------
// ALSO — wordless vocalise practice acknowledgment on a no-speech turn
// ---------------------------------------------------------------------------

function createNoSpeechRuntime(witnesses) {
  const runtime = createRuntime({
    voiceInputAsrBridge: {
      getStatus: async () => ({ enabled: true, available: true, reason: null }),
      transcribeAudio: async () => ({
        noSpeech: true,
        providerStyle: 'simple',
        transcriptSource: 'backend-asr',
      }),
    },
  });
  runtime.debugBus = {
    push: (level, category, message, metadata) => {
      witnesses.push({ level, category, message, metadata });
    },
  };
  return runtime;
}

async function noSpeechTurnWithDrill(drillFilter, witnesses) {
  const runtime = createNoSpeechRuntime(witnesses);
  await runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: 'wordless-session',
    studentId: 'wordless-learner',
  });
  const drill = getVoiceDrillPack('cute-feminine').find(drillFilter);
  assert.ok(drill, 'the fixture drill exists in the pack');
  await runtime.voiceOperationRouteHandlers.selectVoiceDrill({
    sessionId: 'wordless-session',
    lessonId: drill.id,
  });
  const payload = await runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
    sessionId: 'wordless-session',
    requestedProvider: 'backend',
    captureProvider: 'backend',
    audioBase64: Buffer.from('hum-bytes').toString('base64'),
    audioFormat: 'webm',
    mimeType: 'audio/webm',
  });
  return { drill, payload };
}

test('no-speech on a VOCALISE drill returns a deterministic wordless-practice acknowledgment', async () => {
  const witnesses = [];
  const { drill, payload } = await noSpeechTurnWithDrill((d) => d.kind === 'hum_sovt', witnesses);

  assert.equal(payload.inputTurn.outcome, 'no-speech', 'still capture-ready, not an error');
  assert.equal(payload.inputTurn.wordlessPractice, true);
  assert.equal(payload.inputTurn.takeKind, 'hum_sovt');
  assert.equal(
    payload.inputTurn.coachLine,
    'I could not get a usable voice reading. Try the hum again, easy and unforced.',
  );
  // No fabricated scoring rode along.
  assert.equal(payload.inputTurn.confidence, null);
  assert.equal(payload.inputTurn.transcript, null);

  const witness = witnesses.find(({ metadata }) => metadata?.outcome === 'wordless_practice_ack');
  assert.ok(witness, `wordless witness missing: ${JSON.stringify(witnesses)}`);
  assert.equal(witness.metadata.take_kind, 'hum_sovt');
  assert.equal(witness.metadata.drill_id, drill.id);
});

test('a siren drill gets its own line, in the same register', async () => {
  const witnesses = [];
  const { payload } = await noSpeechTurnWithDrill((d) => d.kind === 'siren', witnesses);
  assert.equal(payload.inputTurn.takeKind, 'siren');
  assert.match(payload.inputTurn.coachLine, /Try the slide again/);
});

test('no-speech on a PHRASE drill asks for the sentence again without relabeling it as sound practice', async () => {
  const witnesses = [];
  const { payload } = await noSpeechTurnWithDrill((d) => !d.kind, witnesses);

  assert.equal(payload.inputTurn.outcome, 'no-speech');
  assert.equal(payload.inputTurn.wordlessPractice, undefined);
  assert.equal(payload.inputTurn.semanticRetry, true);
  assert.match(payload.inputTurn.coachLine, /sentence again/i);
  assert.equal(payload.inputTurn.takeKind, 'phrase');
  assert.equal(
    witnesses.some(({ metadata }) => metadata?.outcome === 'semantic_retry'),
    true,
    'the recoverable lexical miss is named without becoming wordless practice',
  );
});
