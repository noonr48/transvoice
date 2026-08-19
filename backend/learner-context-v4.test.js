'use strict';

// v4 tutor-memory: schema additions + back-compat normalization + apply helpers.
// Uses an in-memory fs mock so the service is exercised without touching disk.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  createLearnerContextService,
  LEARNER_CONTEXT_SCHEMA_VERSION,
  SESSIONS_LIMIT,
  MOMENTS_LIMIT,
  COACH_PREFERENCES_LIMIT,
  normalizeWhatWorkedEntry,
  mergeWhatWorked,
  normalizeSessionEntry,
} = require('./learner-context-service');
const { buildHistory, buildSignal, pickBaseline } = require('./coaching/signal-builder');

// ── Minimal in-memory fs mock (just the calls the service uses) ──────────────
function makeMemFs() {
  const files = new Map();
  const dirs = new Set();
  return {
    files,
    existsSync: (p) => files.has(p) || dirs.has(p),
    mkdirSync: (p) => { dirs.add(p); },
    chmodSync: () => {},
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
      return files.get(p);
    },
    writeFileSync: (p, data) => { files.set(p, data); },
    appendFileSync: (p, data) => { files.set(p, (files.get(p) || '') + data); },
    renameSync: (a, b) => {
      files.set(b, files.get(a));
      files.delete(a);
    },
  };
}

function makeService(now = () => 1_700_000_000_000) {
  const fsModule = makeMemFs();
  const svc = createLearnerContextService({
    fsModule,
    logger: { warn() {} },
    now,
    storageRoot: '/tmp/lc-v4-test',
  });
  return { svc, fsModule };
}

function customTargetSummary({
  profileId,
  targetHitPct,
  meanPitchHz,
  measurementAvailable = true,
  bands = {},
}) {
  const targetBands = {
    pitchFloorHz: 170,
    pitchCeilingHz: 230,
    resonanceFloor: 0.35,
    resonanceCeiling: 0.65,
    weightFloor: 0.3,
    weightCeiling: 0.6,
    ...bands,
  };
  return {
    voiceSessionId: `voice-${profileId}`,
    durationMs: 4_000,
    targetPreset: 'cute-feminine',
    analysisVersion: 'voice-metrics-v2',
    target: {
      source: 'custom-handmade',
      targetPreset: 'cute-feminine',
      targetProfileId: profileId,
      direction: 'feminine',
      ...targetBands,
    },
    metrics: {
      meanPitchHz,
      pitchRangeSt: 4,
      resonanceMean: 0.5,
      weightMean: 0.45,
      targetHitPct,
      similarityScore: targetHitPct,
      advanced: {
        measurementAvailable,
        measurementRejectionReasons: measurementAvailable ? [] : ['no_voiced_frames'],
        scoreConfidence: measurementAvailable ? 0.9 : 0,
        voicedFramePct: measurementAvailable ? 0.9 : 0,
        confidentFramePct: measurementAvailable ? 0.85 : 0,
        captureReliability: measurementAvailable ? 0.9 : 0.1,
        reliabilityFlags: measurementAvailable ? [] : ['no_voiced_frames'],
      },
    },
    issues: [],
    nextDrills: [],
  };
}

function signalForTarget(summary, snapshot, nowValue = 1_700_000_000_000) {
  return buildSignal({
    voiceState: {
      targetPreset: summary.targetPreset,
      targetSource: summary.target.source,
      lastSummary: summary,
      lastAttemptArtifact: { finalizedAt: nowValue, summary },
    },
    learnerContext: snapshot,
    baseline: pickBaseline(snapshot),
    now: nowValue,
  });
}

test('structured mirror keeps missing metrics null and preserves explicit zero', async () => {
  const fsModule = makeMemFs();
  const calls = [];
  const svc = createLearnerContextService({
    fsModule,
    logger: { warn() {} },
    now: () => 1_700_000_000_000,
    storageRoot: '/tmp/lc-v4-metric-contract',
    structuredCall: async (method, route, options) => {
      calls.push({ method, route, options });
      return { ok: true };
    },
  });

  svc.recordVoiceAttempt('metric-contract-student', {
    attemptId: 'missing-metrics',
    summary: {
      targetPreset: 'masculine',
      metrics: {
        meanPitchHz: null,
        pitchRangeSt: null,
        targetHitPct: null,
        resonanceMean: null,
        advanced: {
          measurementAvailable: true,
          formantLite: { frontnessScore: null },
        },
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.filter((call) => call.route === '/structured/metrics').length, 0);
  const missingEvent = calls.find((call) => call.route === '/structured/events');
  assert.equal(missingEvent.options.body.payload.targetHitPct, null);
  assert.equal(missingEvent.options.body.payload.meanPitchHz, null);

  calls.length = 0;
  svc.recordVoiceAttempt('metric-contract-student', {
    attemptId: 'explicit-zero-metrics',
    summary: {
      // Any live preset; this test is about zero-vs-missing metric recording.
      targetPreset: 'soft-feminine',
      metrics: {
        meanPitchHz: 0,
        pitchRangeSt: 0,
        targetHitPct: 0,
        resonanceMean: 0,
        advanced: {
          measurementAvailable: true,
          formantLite: { frontnessScore: 0 },
        },
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  const metricCalls = calls.filter((call) => call.route === '/structured/metrics');
  assert.equal(metricCalls.length, 5);
  assert.ok(metricCalls.every((call) => call.options.body.value === 0));
  const zeroEvent = calls.find((call) => call.route === '/structured/events');
  assert.equal(zeroEvent.options.body.payload.targetHitPct, 0);
  assert.equal(zeroEvent.options.body.payload.meanPitchHz, 0);
});

test('recorded canonical metrics survive the learner snapshot into Fable history and baseline deltas', async () => {
  const { svc } = makeService();
  const attempts = [
    { id: 'history-1', meanPitchHz: 180, pitchRangeSt: 2, resonanceMean: 0.2, weightMean: 0.7, targetHitPct: 0.55 },
    { id: 'history-2', meanPitchHz: 190, pitchRangeSt: 3, resonanceMean: 0.3, weightMean: 0.6, targetHitPct: 0.70 },
    { id: 'history-3', meanPitchHz: 205, pitchRangeSt: 4, resonanceMean: 0.4, weightMean: 0.5, targetHitPct: 0.82 },
  ];
  for (const attempt of attempts) {
    svc.recordVoiceAttempt('history-metrics-student', {
      attemptId: attempt.id,
      summary: {
        targetPreset: 'everyday-feminine',
        // v4 baseline honesty: every real trainer summary carries the analyzer
        // calibration it was measured under (VoiceAttemptSummary.analysisVersion
        // defaults to VOICE_ANALYSIS_VERSION). This test is about metrics
        // surviving the round trip, so all three takes share one calibration and
        // the deltas are comparable. The cross-calibration case is covered by
        // backend/learner-context-baseline-calibration.test.js.
        analysisVersion: 'voice-metrics-v4-formants',
        metrics: {
          meanPitchHz: attempt.meanPitchHz,
          pitchRangeSt: attempt.pitchRangeSt,
          resonanceMean: attempt.resonanceMean,
          weightMean: attempt.weightMean,
          targetHitPct: attempt.targetHitPct,
          advanced: {
            measurementAvailable: true,
            scoreConfidence: 0.9,
            voicedFramePct: 0.9,
            confidentFramePct: 0.85,
            captureReliability: 0.9,
            reliabilityFlags: [],
          },
        },
      },
    });
  }

  const snapshot = await svc.getVoiceStudentModelSnapshot('history-metrics-student');
  assert.deepEqual(
    snapshot.recentAttempts.map((attempt) => ({
      meanPitchHz: attempt.meanPitchHz,
      pitchRangeSt: attempt.pitchRangeSt,
      resonanceMean: attempt.resonanceMean,
      weightMean: attempt.weightMean,
      targetHitPct: attempt.targetHitPct,
    })),
    attempts.map(({ id, ...metrics }) => metrics),
  );

  const history = buildHistory(snapshot, snapshot.learnerContext.baseline);
  assert.equal(history.last3TakeSummary, 't1: 180Hz/55% · t2: 190Hz/70% · t3: 205Hz/82%');
  assert.equal(history.trend, 'improving');
  assert.equal(history.baseline.pitchMedianDeltaHz, 13.3);
  assert.equal(history.baseline.pitchRangeDeltaSt, 1);
  assert.equal(history.baseline.resonanceDeltaPct, 10);
  assert.equal(history.baseline.weightDeltaPct, -10);
  assert.equal(history.baseline.targetHitPctDelta, 13);
});

test('custom targets sharing one base preset never mix Fable history, baseline, wins, or misses', async () => {
  const { svc } = makeService();
  const record = (attemptId, summary) => svc.recordVoiceAttempt('custom-target-student', {
    attemptId,
    summary,
    voiceState: {
      targetPreset: summary.targetPreset,
      targetSource: summary.target.source,
      targetVoiceProfile: {
        profileId: summary.target.targetProfileId,
        analysisVersion: summary.analysisVersion,
        ...summary.target,
      },
    },
  });

  const a1 = customTargetSummary({ profileId: 'custom-a', targetHitPct: 0.85, meanPitchHz: 180 });
  const a2 = customTargetSummary({ profileId: 'custom-a', targetHitPct: 0.90, meanPitchHz: 190 });
  const a3 = customTargetSummary({ profileId: 'custom-a', targetHitPct: 0.88, meanPitchHz: 188 });
  record('a1', a1);
  record('a2', a2);
  record('a3', a3);

  const rejectedB = customTargetSummary({
    profileId: 'custom-b', targetHitPct: 0.99, meanPitchHz: 260, measurementAvailable: false,
  });
  const b1 = customTargetSummary({ profileId: 'custom-b', targetHitPct: 0.10, meanPitchHz: 150 });
  record('b-rejected', rejectedB);
  record('b1', b1);

  const bSnapshot = await svc.getVoiceStudentModelSnapshot('custom-target-student');
  const keys = new Set(bSnapshot.recentAttempts.map((attempt) => attempt.targetKey));
  assert.equal(keys.size, 2, 'two exact custom targets retain different opaque identities');
  assert.equal(bSnapshot.learnerContext.baseline, null, 'B cannot inherit A baseline');
  assert.equal(bSnapshot.recentAttempts.find((attempt) => attempt.attemptId === 'b-rejected').usableForLearning, false);

  const bSignal = signalForTarget(b1, bSnapshot);
  assert.equal(bSignal.history.last3TakeSummary, 't1: 150Hz/10%');
  assert.equal(bSignal.history.trend, 'uncertain');
  assert.ok(Object.values(bSignal.history.baseline).every((value) => value == null));
  assert.equal(bSignal.decisionWitness.consecutiveMisses, 0);
  assert.doesNotMatch(bSignal.personalization.recentWin, /improved/i);

  const a4 = customTargetSummary({ profileId: 'custom-a', targetHitPct: 0.92, meanPitchHz: 195 });
  record('a4', a4);
  const aSnapshot = await svc.getVoiceStudentModelSnapshot('custom-target-student');
  assert.ok(aSnapshot.learnerContext.baseline, 'switching back restores A baseline');
  const aSignal = signalForTarget(a4, aSnapshot);
  assert.equal(aSignal.history.last3TakeSummary, 't1: 190Hz/90% · t2: 188Hz/88% · t3: 195Hz/92%');
  assert.notEqual(aSignal.history.baseline.pitchMedianDeltaHz, null);
  assert.doesNotMatch(aSignal.history.last3TakeSummary, /150Hz|260Hz/);
});

// Seed a raw profile JSON file directly (simulating an on-disk v3 file).
function seedProfile(fsModule, svc, studentId, rawProfile) {
  const p = svc.getProfilePath(studentId);
  fsModule.files.set(p, JSON.stringify(rawProfile));
}

test('v6 schema + back-compat', async (t) => {
  await t.test('schema version is v6', () => {
    assert.equal(LEARNER_CONTEXT_SCHEMA_VERSION, 'sloane.learner_context.v6');
  });

  await t.test('a v3 profile (string whatWorked, no sessions/moments) normalizes cleanly', () => {
    const { svc, fsModule } = makeService();
    // A realistic v3 on-disk profile: whatWorked is an array of STRINGS, and the
    // v4 fields (sessions/lastSessionAt/moments/coachPreferences) are absent.
    seedProfile(fsModule, svc, 'v3-user', {
      schemaVersion: 'sloane.learner_context.v3',
      studentId: 'v3-user',
      profile: { displayName: 'Mara', topics: ['phone calls'], hobbies: ['piano'] },
      voice: {
        targetPreset: 'cute-feminine',
        whatWorked: ['the hum onset landed', 'forward resonance held'],
        realSentences: [],
        // no sessions, lastSessionAt, moments, coachPreferences
      },
    });

    const profile = svc.readProfile('v3-user');
    assert.equal(profile.schemaVersion, 'sloane.learner_context.v6');
    // whatWorked upgraded: each legacy string -> {text, axis:null, date:''}.
    assert.ok(Array.isArray(profile.voice.whatWorked));
    assert.equal(profile.voice.whatWorked.length, 2);
    for (const w of profile.voice.whatWorked) {
      assert.equal(typeof w.text, 'string');
      assert.equal(w.axis, null);
      assert.equal(w.date, '');
    }
    assert.equal(profile.voice.whatWorked[0].text, 'the hum onset landed');
    // New v4 fields default cleanly.
    assert.deepEqual(profile.voice.sessions, []);
    assert.equal(profile.voice.lastSessionAt, '');
    assert.deepEqual(profile.voice.moments, []);
    assert.equal(profile.voice.coachCheckpoint, null);
    assert.deepEqual(profile.voice.coachPreferences, []);
    // Existing v3 data preserved.
    assert.equal(profile.profile.displayName, 'Mara');
    assert.deepEqual(profile.profile.topics, ['phone calls']);
  });

  await t.test('normalizeWhatWorkedEntry + mergeWhatWorked dedupe by text, cap', () => {
    assert.deepEqual(normalizeWhatWorkedEntry('hi'), { text: 'hi', axis: null, date: '' });
    assert.deepEqual(
      normalizeWhatWorkedEntry({ text: 'hi', axis: 'resonance', date: '2026-06-11' }),
      { text: 'hi', axis: 'resonance', date: '2026-06-11' },
    );
    // invalid axis dropped to null
    assert.equal(normalizeWhatWorkedEntry({ text: 'x', axis: 'bogus' }).axis, null);
    // empty text -> null
    assert.equal(normalizeWhatWorkedEntry({ text: '' }), null);

    // merge: additions prepend, dedupe by text (case-insensitive).
    const merged = mergeWhatWorked(
      [{ text: 'New win', axis: 'pitch', date: '2026-06-11' }],
      ['new win', 'old win'], // 'new win' dups the addition (case-insensitive)
      10,
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0].text, 'New win');
    assert.equal(merged[0].axis, 'pitch');
    assert.equal(merged[1].text, 'old win');
  });

  await t.test('normalizeSessionEntry coerces shape + clamps', () => {
    const e = normalizeSessionEntry({
      date: '2026-06-11', startedAt: 1_700_000_000_000, minutes: 12.345, takes: 7.6, focusAxis: 'resonance', oneLine: '7 takes on resonance',
    });
    assert.equal(e.date, '2026-06-11');
    assert.equal(e.minutes, 12.35);
    assert.equal(e.takes, 8);
    assert.equal(e.focusAxis, 'resonance');
    // invalid focus axis -> null; entry with neither date nor startedAt -> null.
    assert.equal(normalizeSessionEntry({ startedAt: 1, focusAxis: 'nope' }).focusAxis, null);
    assert.equal(normalizeSessionEntry({ minutes: 5 }), null);
  });
});

test('v4 service apply helpers', async (t) => {
  await t.test('addSession appends to the ring (newest LAST) + sets lastSessionAt', () => {
    const { svc } = makeService(() => 2_000_000_000_000);
    svc.addSession('s-user', {
      startedAt: 1_999_999_000_000, endedAt: 2_000_000_000_000, minutes: 10, takes: 4, focusAxis: 'pitch', oneLine: '4 takes on pitch',
    });
    const p = svc.readProfile('s-user');
    assert.equal(p.voice.sessions.length, 1);
    assert.equal(p.voice.sessions[0].focusAxis, 'pitch');
    assert.equal(p.voice.sessions[0].oneLine, '4 takes on pitch');
    assert.equal(p.voice.lastSessionAt, 2_000_000_000_000);
  });

  await t.test('sessions ring is capped at SESSIONS_LIMIT (newest kept)', () => {
    const { svc, fsModule } = makeService();
    const many = Array.from({ length: SESSIONS_LIMIT + 10 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      startedAt: 1_700_000_000_000 + i * 1000,
      minutes: 5, takes: i, focusAxis: 'pitch', oneLine: `${i} takes on pitch`,
    }));
    seedProfile(fsModule, svc, 'ring-user', {
      schemaVersion: 'sloane.learner_context.v4',
      studentId: 'ring-user',
      voice: { sessions: many },
    });
    const p = svc.readProfile('ring-user');
    assert.equal(p.voice.sessions.length, SESSIONS_LIMIT);
    // The newest (highest takes) survives at the tail.
    assert.equal(p.voice.sessions[p.voice.sessions.length - 1].takes, SESSIONS_LIMIT + 9);
  });

  await t.test('addMoment appends (newest first), defaults kind, caps at 40', () => {
    const { svc } = makeService();
    svc.addMoment('m-user', { kind: 'gendered-right', text: "ma'am'd on the phone" });
    svc.addMoment('m-user', { text: 'no kind -> milestone' });
    const p = svc.readProfile('m-user');
    assert.equal(p.voice.moments.length, 2);
    // newest first
    assert.equal(p.voice.moments[0].kind, 'milestone');
    assert.equal(p.voice.moments[1].kind, 'gendered-right');
    // cap
    for (let i = 0; i < MOMENTS_LIMIT + 5; i += 1) svc.addMoment('m-user', { text: `moment ${i}` });
    assert.equal(svc.readProfile('m-user').voice.moments.length, MOMENTS_LIMIT);
  });

  await t.test('addCoachPreference stores only canonical policy IDs and dedupes them', () => {
    const { svc } = makeService();
    svc.addCoachPreference('p-user', { id: 'concrete-over-imagery' });
    const p = svc.readProfile('p-user');
    assert.equal(p.voice.coachPreferences.length, 1);
    assert.equal(p.voice.coachPreferences[0].id, 'concrete-over-imagery');
    assert.match(p.voice.coachPreferences[0].text, /concrete physical cues/i);
    assert.ok(p.voice.coachPreferences[0].date, 'a date is stamped');
    svc.addCoachPreference('p-user', { text: 'Prefers concrete physical cues over imagery or metaphor' });
    svc.addCoachPreference('p-user', { text: 'arbitrary model prose must not become policy' });
    assert.equal(svc.readProfile('p-user').voice.coachPreferences.length, 1);
  });

  await t.test('v6 identity fields: pronouns/direction/goal/avoid default, normalize, and edit', () => {
    const { svc } = makeService();
    const p0 = svc.readProfile('id-user');
    assert.equal(p0.profile.pronouns, '');
    assert.equal(p0.profile.direction, 'unspecified');
    assert.equal(p0.profile.goal, '');
    assert.deepEqual(p0.voice.avoid, []);
    // learner edits via updateLearnerProfile
    svc.updateLearnerProfile('id-user', { pronouns: 'she/her', direction: 'MTF', goal: 'pass on the phone', avoid: ['pushing chest voice'] });
    const p1 = svc.readProfile('id-user');
    assert.equal(p1.profile.pronouns, 'she/her');
    assert.equal(p1.profile.direction, 'mtf'); // lowercased + validated against the enum
    assert.equal(p1.profile.goal, 'pass on the phone');
    assert.deepEqual(p1.voice.avoid, ['pushing chest voice']);
    // an invalid direction falls back to 'unspecified'
    svc.updateLearnerProfile('id-user', { direction: 'sideways' });
    assert.equal(svc.readProfile('id-user').profile.direction, 'unspecified');
  });

  await t.test('v6 learner control: moment ids + removeMoment / removeCoachPreference / resetLearnerMemory', () => {
    const { svc } = makeService();
    svc.addMoment('fg-user', { kind: 'hard-moment', text: 'misgendered today' });
    svc.addMoment('fg-user', { kind: 'milestone', text: 'nailed forward resonance' });
    svc.addCoachPreference('fg-user', { id: 'gentle-tone' });
    let p = svc.readProfile('fg-user');
    assert.equal(p.voice.moments.length, 2);
    assert.ok(p.voice.moments[0].id, 'moments get a stable id');
    // delete a specific moment by id
    const milestoneId = p.voice.moments.find((m) => m.kind === 'milestone').id;
    svc.removeMoment('fg-user', milestoneId);
    p = svc.readProfile('fg-user');
    assert.equal(p.voice.moments.length, 1);
    assert.equal(p.voice.moments[0].kind, 'hard-moment');
    // delete a moment by exact text (legacy fallback)
    svc.removeMoment('fg-user', 'misgendered today');
    assert.equal(svc.readProfile('fg-user').voice.moments.length, 0);
    // delete a coaching preference by text (case-insensitive)
    svc.removeCoachPreference('fg-user', 'gentle-tone');
    assert.equal(svc.readProfile('fg-user').voice.coachPreferences.length, 0);
    // reset clears accumulated memory but KEEPS identity
    svc.updateLearnerProfile('fg-user', { displayName: 'Mara', pronouns: 'she/her' });
    svc.addMoment('fg-user', { kind: 'milestone', text: 'x' });
    svc.addCoachPreference('fg-user', { id: 'slower-pace' });
    svc.resetLearnerMemory('fg-user');
    p = svc.readProfile('fg-user');
    assert.deepEqual(p.voice.moments, []);
    assert.deepEqual(p.voice.coachPreferences, []);
    assert.equal(p.profile.displayName, 'Mara', 'identity kept after reset');
    assert.equal(p.profile.pronouns, 'she/her', 'pronouns kept after reset');
  });

  await t.test('appendLearnerTopics/Hobbies APPEND (dedupe, cap 12)', () => {
    const { svc, fsModule } = makeService();
    seedProfile(fsModule, svc, 'th-user', {
      schemaVersion: 'sloane.learner_context.v4',
      studentId: 'th-user',
      profile: { topics: ['existing topic'], hobbies: [] },
      voice: {},
    });
    svc.appendLearnerTopics('th-user', ['new topic', 'existing topic']); // dup ignored
    const p = svc.readProfile('th-user');
    assert.deepEqual(p.profile.topics, ['existing topic', 'new topic']);
    // cap 12
    svc.appendLearnerTopics('th-user', Array.from({ length: 20 }, (_, i) => `t${i}`));
    assert.equal(svc.readProfile('th-user').profile.topics.length, 12);
  });

  await t.test('updateLearnerProfile whatWorked append takes {text,axis,date} objects', () => {
    const { svc } = makeService();
    svc.updateLearnerProfile('ww-user', {
      whatWorked: [{ text: 'forward resonance held', axis: 'resonance', date: '2026-06-11' }],
    });
    const p = svc.readProfile('ww-user');
    assert.equal(p.voice.whatWorked.length, 1);
    assert.equal(p.voice.whatWorked[0].axis, 'resonance');
    assert.equal(p.voice.whatWorked[0].date, '2026-06-11');
    // a plain string still works (back-compat input).
    svc.updateLearnerProfile('ww-user', { whatWorked: ['a plain string win'] });
    const p2 = svc.readProfile('ww-user');
    assert.equal(p2.voice.whatWorked[0].text, 'a plain string win');
    assert.equal(p2.voice.whatWorked[0].axis, null);
  });

  await t.test('v4 fields surface in the student-model snapshot (top-level + nested)', async () => {
    const { svc } = makeService();
    svc.addSession('snap-user', { startedAt: 1_700_000_000_000, endedAt: 1_700_000_500_000, minutes: 8, takes: 3, focusAxis: 'weight', oneLine: '3 takes on weight' });
    svc.addMoment('snap-user', { kind: 'milestone', text: 'carried: A flat white, please.' });
    const snap = await svc.getVoiceStudentModelSnapshot('snap-user');
    assert.equal(snap.sessions.length, 1);
    assert.equal(snap.moments.length, 1);
    assert.ok(snap.lastSessionAt);
    // nested mirror
    assert.equal(snap.learnerContext.sessions.length, 1);
    assert.equal(snap.learnerContext.moments.length, 1);
  });
});

test('v5 SM-2 review scheduling + per-concept EWMA mastery via recordVoiceAttempt', async (t) => {
  const NOW = 1_700_000_000_000;
  const DAY = 86_400_000;

  await t.test('an attempt populates ewma/level, an SM-2 schedule, and real (non-0.72) urgency', () => {
    const { svc } = makeService();
    svc.recordVoiceAttempt('u5', {
      attemptId: 'a1',
      evaluations: [
        { conceptId: 'pitch_floor', conceptName: 'pitch floor', correct: true },
        { conceptId: 'forward_resonance', conceptName: 'forward resonance', correct: false },
      ],
    });
    const p = svc.readProfile('u5');
    // per-concept EWMA (first obs seeds: pass -> 1, miss -> 0); level novice (<3 attempts)
    assert.equal(p.voice.conceptStats.pitch_floor.ewma, 1);
    assert.equal(p.voice.conceptStats.forward_resonance.ewma, 0);
    assert.equal(p.voice.conceptStats.pitch_floor.level, 'novice');
    // SM-2 schedule: pass -> interval 1, due +1 day; miss -> lapse (reps 0, lapses 1)
    assert.equal(p.voice.reviewSchedule.pitch_floor.intervalDays, 1);
    assert.equal(p.voice.reviewSchedule.pitch_floor.dueAt, NOW + DAY);
    assert.equal(p.voice.reviewSchedule.forward_resonance.lapses, 1);
    assert.equal(p.voice.reviewSchedule.forward_resonance.reps, 0);
    // review queue: the MISSED concept surfaces with a REAL urgency (not the old flat 0.72)
    const q = p.voice.reviewQueue.find((it) => it.conceptId === 'forward_resonance');
    assert.ok(q, 'missed concept is queued');
    assert.notEqual(q.urgency, 0.72);
    assert.ok(q.urgency > 0.5, 'freshly-missed low-mastery concept is high urgency');
    // the PASSED concept is NOT queued (not missed, not overdue)
    assert.ok(!p.voice.reviewQueue.some((it) => it.conceptId === 'pitch_floor'));
  });

  await t.test('repeated passes raise EWMA into a mastery band; SM-2 intervals grow', () => {
    const { svc } = makeService();
    for (let i = 0; i < 4; i += 1) {
      svc.recordVoiceAttempt('u6', { attemptId: `p${i}`, evaluations: [{ conceptId: 'c', conceptName: 'C', correct: true }] });
    }
    const cs = svc.readProfile('u6').voice.conceptStats.c;
    assert.equal(cs.total, 4);
    assert.equal(cs.ewma, 1);
    assert.equal(cs.level, 'mastered');
    const sched = svc.readProfile('u6').voice.reviewSchedule.c;
    assert.equal(sched.reps, 4);
    assert.ok(sched.intervalDays > 6, 'interval expanded past the 6-day second step');
  });
});

test('measurement-invalid attempts are retained as telemetry but never train the learner model', async (t) => {
  const invalidAttempt = (attemptId) => ({
    attemptId,
    summary: {
      targetPreset: 'cute-feminine',
      metrics: {
        // These deliberately resemble the historical fabricated-silence values.
        meanPitchHz: 201.5,
        resonanceMean: 0.58,
        weightMean: 0.42,
        targetHitPct: 0.8,
        advanced: {
          measurementAvailable: false,
          measurementRejectionReasons: ['no_voiced_frames'],
          scoreConfidence: 0,
          voicedFramePct: 0,
          captureReliability: 0.1,
          reliabilityFlags: ['no_voiced_frames', 'low_voiced_coverage'],
        },
      },
    },
    evaluations: [
      { conceptId: 'voice_pitch_center', conceptName: 'Pitch center', correct: true },
      { conceptId: 'voice_resonance_brightness', conceptName: 'Resonance', correct: false, misconception: 'false miss' },
    ],
  });

  await t.test('one invalid attempt has an audit record but no mastery, queue, struggle, or win', () => {
    const { svc } = makeService();
    svc.recordVoiceAttempt('invalid-one', invalidAttempt('invalid-1'));
    const profile = svc.readProfile('invalid-one');
    assert.equal(profile.voice.recentAttempts.length, 1);
    assert.equal(profile.voice.recentAttempts[0].usableForLearning, false);
    assert.deepEqual(profile.voice.recentAttempts[0].measurementRejectionReasons, [
      'no_voiced_frames',
      'low_score_confidence',
      'low_voiced_coverage',
      'low_capture_reliability',
    ]);
    assert.deepEqual(profile.voice.conceptStats, {});
    assert.deepEqual(profile.voice.reviewSchedule, {});
    assert.deepEqual(profile.voice.reviewQueue, []);
    assert.deepEqual(profile.voice.struggles, []);
    assert.deepEqual(profile.voice.whatWorked, []);
  });

  await t.test('three invalid attempts cannot freeze a target baseline', () => {
    const { svc } = makeService();
    for (let index = 0; index < 3; index += 1) {
      svc.recordVoiceAttempt('invalid-baseline', invalidAttempt(`invalid-${index}`));
    }
    const profile = svc.readProfile('invalid-baseline');
    assert.equal(profile.voice.recentAttempts.length, 3);
    assert.deepEqual(profile.voice.baseline, {});
  });

  await t.test('explicitly measurable but degraded attempt remains audit-only', () => {
    const { svc } = makeService();
    const degraded = invalidAttempt('degraded-1');
    degraded.summary.metrics.advanced = {
      measurementAvailable: true,
      scoreConfidence: 0.05,
      voicedFramePct: 0.01,
      captureReliability: 0.2,
      reliabilityFlags: ['low_voiced_coverage', 'low_score_confidence'],
    };
    svc.recordVoiceAttempt('degraded-one', degraded);
    const profile = svc.readProfile('degraded-one');
    const record = profile.voice.recentAttempts[0];
    assert.equal(record.measurementAvailable, true);
    assert.equal(record.usableForLearning, false);
    assert.ok(record.measurementRejectionReasons.includes('low_score_confidence'));
    assert.ok(record.measurementRejectionReasons.includes('low_voiced_coverage'));
    assert.deepEqual(profile.voice.conceptStats, {});
    assert.deepEqual(profile.voice.reviewQueue, []);
    assert.deepEqual(profile.voice.baseline, {});
  });
});
