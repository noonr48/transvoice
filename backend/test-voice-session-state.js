const assert = require('assert');

const { createVoiceSessionStateRuntime } = require('./voice-session-state');

function createRuntime(overrides = {}) {
  return createVoiceSessionStateRuntime({
    appendVoiceCoachThreadMessage(voiceState, role, content, kind) {
      return [
        ...(voiceState.coachThread || []),
        {
          role,
          content,
          kind,
          id: `${role}-${kind}`,
          channel: role === 'user' ? 'coach' : 'deeptutor',
          createdAt: 1,
        },
      ];
    },
    buildVoiceCueSheet({ phrase }) {
      return {
        cueLine: phrase,
        styledCueLine: `${phrase}!`,
        phraseIntent: 'guided practice',
        teachingFocus: ['focus'],
      };
    },
    buildVoiceStudentModelEvaluations({ thresholds, concepts }) {
      return { thresholds, concepts };
    },
    decorateVoicePhraseForecast(value) {
      return value;
    },
    getCachedDefaultModelId() {
      return 'default-model';
    },
    getRenderableVoicePhraseComparison({ phraseComparison }) {
      return phraseComparison;
    },
    getVoiceDrillById(_preset, lessonId) {
      return lessonId ? { title: 'Lesson Title' } : null;
    },
    logger: console,
    normalizeDeepTutorVoiceState(value) {
      return {
        guideSessionId: null,
        currentKnowledge: null,
        lastTutorMessage: null,
        lastUserMessage: null,
        status: 'idle',
        runtimeState: 'off',
        ...(value || {}),
      };
    },
    normalizeDifficultyPreference(value) {
      return value || 'adaptive';
    },
    normalizePhraseComparison(value) {
      return value;
    },
    normalizeRequestedModel(value) {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      return trimmed || null;
    },
    normalizeVoiceCoachInputConfidence(value) {
      return Number.isFinite(Number(value)) ? Number(value) : null;
    },
    normalizeVoiceCoachInputProvider(value) {
      return value === 'backend' ? 'backend' : 'browser';
    },
    async resolveValidatedSessionModel() {
      return null;
    },
    resolveActiveVoicePhrase({ activeLine }) {
      return activeLine?.displayText || null;
    },
    ...overrides,
  });
}

function testNormalizeVoiceState() {
  const runtime = createRuntime();
  const normalized = runtime.normalizeVoiceState({
    targetPreset: 'cute-feminine',
    lessonId: 'lesson-1',
    activeLine: { displayText: '  hi there  ', teachingFocus: ['soft'], difficulty: 'hard' },
    lineQueue: [{ displayText: '  next line ' }],
    coachThread: [
      { role: 'coach', content: '  keep going  ', kind: 'note' },
      { role: 'coach', content: '   ', kind: 'note' },
    ],
    voiceInputRuntime: { status: 'waiting', requestedProvider: 'backend', successfulTurns: '3' },
    voiceConditioning: { styleInstruction: '  brighter placement  ' },
    advancedPanel: { open: 1 },
  });

  assert.strictEqual(normalized.activeLine.displayText, 'hi there');
  assert.strictEqual(normalized.lineQueue.length, 1);
  assert.strictEqual(normalized.coachThread.length, 1);
  assert.strictEqual(normalized.voiceInputRuntime.requestedProvider, 'backend');
  assert.strictEqual(normalized.voiceInputRuntime.successfulTurns, 3);
  assert.strictEqual(normalized.voiceConditioning.styleInstruction, 'brighter placement');
  assert.strictEqual(normalized.advancedPanel.open, true);
}

function testNormalizeVoiceStateKeepsNestedAdvancedMetrics() {
  const runtime = createRuntime();
  const normalized = runtime.normalizeVoiceState({
    lastTakeTimeline: [
      {
        t: 12,
        voiced: true,
        pitchHz: 201.6,
        pitchScore: 0.82,
        resonanceScore: 0.63,
        weightScore: 0.31,
        confidence: 0.74,
        loudnessDb: -19.25,
        advanced: {
          pitchConfidence: 1.4,
          rms: 0.0123456,
          spectralFlux: 0.123456,
        },
        analysisVersion: '  frame-v2  ',
        frameLabel: 'kept',
      },
    ],
    lastSummary: {
      durationMs: '1820',
      analysisVersion: '  voice-metrics-v2  ',
      metrics: {
        meanPitchHz: '212.345',
        targetHitPct: '0.63',
        advanced: {
          voicedFramePct: '1.2',
          scoreConfidence: '0.734',
          measurementAvailable: false,
          measurementRejectionReasons: [' no_voiced_frames ', ''],
          pitchValidFrameCount: '0',
          hnrValidFrameCount: '3',
          hnrVoicedCoveragePct: '0.25',
          pitchP10Hz: '186.44',
          pitchTargetOccupancyPct: '63.4',
          phraseFinalDropSemitones: '-1.48',
          phraseEndDropHz: '14.82',
          reliabilityFlags: [' quiet_input ', '', 'low_voiced_coverage'],
        },
      },
      target: {
        source: ' custom-handmade ',
        targetPreset: ' everyday-feminine ',
        targetProfileId: ' custom-low ',
        direction: 'feminine',
        pitchFloorHz: '120.25',
        pitchCeilingHz: '140.75',
        resonanceFloor: '0.1',
        resonanceCeiling: '0.3',
        weightFloor: '0.6',
        weightCeiling: '0.8',
        pitchPlacement: 'above',
        pitchGapHz: '71.595',
        resonanceGap: '-0.1118',
        weightGap: '0.1238',
      },
      issues: [' keep the ending lifted ', ''],
      nextDrills: [' question-style ending holds '],
      sourceTag: 'kept',
    },
    targetVoiceProfile: {
      analysisVersion: '  profile-v2  ',
      metrics: {
        advanced: {
          stabilityMean: '0.6789',
        },
      },
      advancedBands: {
        pitchP10HzFloor: '191.44',
        stabilityFloor: '0.62',
      },
      notes: [' bright and light ', ''],
      profileTag: 'kept',
    },
    phraseForecast: {
      phrase: '  hey there  ',
      analysisVersion: '  forecast-v2  ',
      metrics: {
        advanced: {
          pitchStdSt: '2.4567',
        },
      },
      timeline: [
        {
          t: 0,
          voiced: true,
          pitchHz: 208.4,
          pitchScore: 0.8,
          resonanceScore: 0.61,
          weightScore: 0.29,
          confidence: 0.77,
          loudnessDb: -18.5,
          advanced: {
            spectralFlux: 0.234567,
          },
          analysisVersion: '  forecast-frame-v2  ',
        },
      ],
      notes: [' airy ', ''],
      forecastTag: 'kept',
    },
  });

  assert.strictEqual(normalized.lastTakeTimeline[0].analysisVersion, 'frame-v2');
  assert.strictEqual(normalized.lastTakeTimeline[0].advanced.pitchConfidence, 1);
  assert.strictEqual(normalized.lastTakeTimeline[0].advanced.rms, 0.01235);
  assert.strictEqual(normalized.lastTakeTimeline[0].frameLabel, 'kept');
  assert.strictEqual(normalized.lastSummary.analysisVersion, 'voice-metrics-v2');
  assert.strictEqual(normalized.lastSummary.metrics.advanced.voicedFramePct, 1);
  assert.strictEqual(normalized.lastSummary.metrics.advanced.measurementAvailable, false);
  assert.deepStrictEqual(normalized.lastSummary.metrics.advanced.measurementRejectionReasons, ['no_voiced_frames']);
  assert.strictEqual(normalized.lastSummary.metrics.advanced.pitchValidFrameCount, 0);
  assert.strictEqual(normalized.lastSummary.metrics.advanced.hnrValidFrameCount, 3);
  assert.strictEqual(normalized.lastSummary.metrics.advanced.hnrVoicedCoveragePct, 0.25);
  assert.strictEqual(normalized.lastSummary.metrics.advanced.pitchTargetOccupancyPct, 63.4);
  assert.strictEqual(normalized.lastSummary.metrics.advanced.phraseFinalDropSemitones, -1.48);
  assert.strictEqual(normalized.lastSummary.metrics.advanced.phraseEndDropHz, 14.82);
  assert.deepStrictEqual(normalized.lastSummary.metrics.advanced.reliabilityFlags, ['quiet_input', 'low_voiced_coverage']);
  assert.strictEqual(normalized.lastSummary.target.source, 'custom-handmade');
  assert.strictEqual(normalized.lastSummary.target.targetProfileId, 'custom-low');
  assert.strictEqual(normalized.lastSummary.target.pitchFloorHz, 120.25);
  assert.strictEqual(normalized.lastSummary.target.resonanceFloor, 0.1);
  assert.strictEqual(normalized.lastSummary.target.weightCeiling, 0.8);
  assert.strictEqual(normalized.lastSummary.target.pitchGapHz, 71.59);
  assert.strictEqual(normalized.lastSummary.target.resonanceGap, -0.112);
  assert.strictEqual(normalized.lastSummary.target.weightGap, 0.124);
  assert.strictEqual(normalized.lastSummary.sourceTag, 'kept');
  assert.strictEqual(normalized.targetVoiceProfile.analysisVersion, 'profile-v2');
  assert.strictEqual(normalized.targetVoiceProfile.advancedBands.pitchP10HzFloor, 191.44);
  assert.deepStrictEqual(normalized.targetVoiceProfile.notes, ['bright and light']);
  assert.strictEqual(normalized.targetVoiceProfile.profileTag, 'kept');
  assert.strictEqual(normalized.phraseForecast.analysisVersion, 'forecast-v2');
  assert.strictEqual(normalized.phraseForecast.metrics.advanced.pitchStdSt, 2.457);
  assert.strictEqual(normalized.phraseForecast.timeline[0].advanced.spectralFlux, 0.2346);
  assert.strictEqual(normalized.phraseForecast.timeline[0].analysisVersion, 'forecast-frame-v2');
  assert.strictEqual(normalized.phraseForecast.forecastTag, 'kept');
}

function testUpdateSessionSummaryAndPersistence() {
  const runtime = createRuntime();
  const session = {
    agentId: 'voice',
    messages: [],
    deeptutorVoiceState: {},
    voiceState: {},
  };

  const voiceState = runtime.updateSessionVoiceState(session, {
    lessonId: 'lesson-1',
    referenceClipName: 'Ref Clip',
    phraseComparison: { pathMatchScore: 0.83 },
    status: 'ready',
  });

  assert.strictEqual(voiceState.lessonId, 'lesson-1');
  assert.ok(session.summary.includes('Lesson Title'));
  assert.ok(session.summary.includes('Ref Clip'));
  assert.ok(session.summary.includes('83%'));
  assert.strictEqual(runtime.shouldPersistSession(session), true);
}

function testAppendDeepTutorVoiceThread() {
  const runtime = createRuntime();
  const session = {
    agentId: 'voice',
    voiceState: {
      coachThread: [],
    },
    deeptutorVoiceState: {},
  };

  const nextVoiceState = runtime.appendDeepTutorVoiceThread(session, {
    userMessage: 'Why this drill?',
    coachMessage: 'Because your phrasing is flattening.',
  });

  assert.strictEqual(nextVoiceState.coachThread.length, 2);
  assert.strictEqual(nextVoiceState.lastCoachMessage, 'Because your phrasing is flattening.');
}

function testUpdateSessionDeepTutorVoiceState() {
  const runtime = createRuntime({
    normalizeDeepTutorVoiceState(value) {
      return {
        guideSessionId: null,
        currentKnowledge: null,
        lastTutorMessage: null,
        lastUserMessage: null,
        status: 'idle',
        runtimeState: 'off',
        normalized: true,
        ...(value || {}),
      };
    },
  });
  const session = {
    deeptutorVoiceState: {
      status: 'active',
      lastTutorMessage: 'Earlier prompt',
    },
  };

  const nextState = runtime.updateSessionDeepTutorVoiceState(session, {
    runtimeState: 'coaching',
    lastTutorMessage: 'Updated prompt',
  });
  const detachedState = runtime.updateSessionDeepTutorVoiceState(null, {
    status: 'ready',
  });

  assert.strictEqual(session.deeptutorVoiceState, nextState);
  assert.deepStrictEqual(nextState, {
    guideSessionId: null,
    currentKnowledge: null,
    lastTutorMessage: 'Updated prompt',
    lastUserMessage: null,
    status: 'active',
    runtimeState: 'coaching',
    normalized: true,
  });
  assert.deepStrictEqual(detachedState, {
    guideSessionId: null,
    currentKnowledge: null,
    lastTutorMessage: null,
    lastUserMessage: null,
    status: 'ready',
    runtimeState: 'off',
    normalized: true,
  });
}

function testVoiceStudentHelpers() {
  const runtime = createRuntime();
  const reviewQueue = runtime.normalizeStudentModelReviewQueue([
    ['voice_pitch_center', 0.9],
    { concept_id: 'voice_reference_matching', urgency: 0.5 },
    'voice_phrase_shape_matching',
  ]);

  assert.strictEqual(runtime.getVoiceStudentModelId({ voiceStudentModelId: '  custom-student  ' }), 'custom-student');
  assert.strictEqual(reviewQueue.length, 3);
  assert.strictEqual(reviewQueue[0].name, 'Pitch center');
  const evaluations = runtime.buildVoiceStudentModelEvaluations({ targetPreset: 'bright-playful' }, { targetPreset: 'cute-feminine' });
  assert.strictEqual(evaluations.thresholds.minPitchHz, 205);
  assert.ok(evaluations.concepts.voice_reference_matching);
}

async function testResolveVoiceRealtimeCoachModelUsesValidatedModel() {
  const runtime = createRuntime({
    logger: {
      warn() {
        throw new Error('resolveVoiceRealtimeCoachModel should not warn on successful resolution');
      },
    },
    async resolveValidatedSessionModel(agentId) {
      assert.strictEqual(agentId, 'voice');
      return { model: 'validated-voice-model' };
    },
  });

  const model = await runtime.resolveVoiceRealtimeCoachModel({ model: 'session-model' });
  assert.strictEqual(model, 'validated-voice-model');
}

async function testResolveVoiceRealtimeCoachModelFallsBackToSessionAndDefault() {
  const warnings = [];
  const runtime = createRuntime({
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
    async resolveValidatedSessionModel() {
      throw new Error('bridge unavailable');
    },
  });

  const sessionModel = await runtime.resolveVoiceRealtimeCoachModel({ model: '  session-model  ' });
  const defaultModel = await runtime.resolveVoiceRealtimeCoachModel({});

  assert.strictEqual(sessionModel, 'session-model');
  assert.strictEqual(defaultModel, 'default-model');
  assert.strictEqual(warnings.length, 2);
  assert.ok(warnings[0].includes('bridge unavailable'));
}

async function main() {
  testNormalizeVoiceState();
  testNormalizeVoiceStateKeepsNestedAdvancedMetrics();
  testUpdateSessionSummaryAndPersistence();
  testAppendDeepTutorVoiceThread();
  testUpdateSessionDeepTutorVoiceState();
  testVoiceStudentHelpers();
  await testResolveVoiceRealtimeCoachModelUsesValidatedModel();
  await testResolveVoiceRealtimeCoachModelFallsBackToSessionAndDefault();
  console.log('voice session state tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
