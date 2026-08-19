'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildDeepTutorVoiceCoachBrief,
  buildDeepTutorVoiceGuideRecords,
  buildDeepTutorVoiceLessonBoard,
} = require('./deeptutor-voice-adapter');

function analysisRecord(voiceState) {
  return buildDeepTutorVoiceGuideRecords({ voiceState })
    .find((record) => record.type === 'voice-analysis');
}

function guideRecord(type, voiceState) {
  return buildDeepTutorVoiceGuideRecords({ voiceState })
    .find((record) => record.type === type);
}

function buildRiskVoiceState({
  kind = 'phrase',
  strainRisk = null,
  breathyRisk = null,
  qualityBands = {},
  mimic = false,
} = {}) {
  return {
    targetPreset: 'masculine',
    referenceClipId: mimic ? 'reference-1' : null,
    activeLine: mimic ? { referenceMode: 'reference-informed' } : null,
    phraseComparison: mimic ? { pathMatchScore: 0.4 } : null,
    targetVoiceProfile: {
      advancedBands: { quality: qualityBands },
    },
    lastAttemptArtifact: {
      repContext: { kind },
    },
    lastSummary: {
      metrics: {
        advanced: {
          measurementAvailable: true,
          scoreConfidence: 0.9,
          voicedFramePct: 0.9,
          confidentFramePct: 0.9,
          captureReliability: 0.9,
          quality: { strainRisk, breathyRisk },
        },
      },
    },
  };
}

function correctionText(voiceState) {
  const lessonBoard = buildDeepTutorVoiceLessonBoard({ voiceState });
  return buildDeepTutorVoiceCoachBrief({
    voiceState,
    deeptutorVoiceState: { lessonBoard },
  }).correctionFocus.join(' | ');
}

test('missing advanced metrics and target bands never become zero-valued Fable evidence', () => {
  const record = analysisRecord({
    targetPreset: 'masculine',
    targetVoiceProfile: {
      advancedBands: {
        pitchP10HzFloor: null,
        phraseEndDropHzCeiling: null,
        formantLite: { frontnessFloor: null },
        quality: { strainRiskCeiling: null },
      },
    },
    lastSummary: {
      metrics: {
        meanPitchHz: null,
        pitchRangeSt: null,
        targetHitPct: null,
        advanced: {
          measurementAvailable: true,
          voicedFramePct: null,
          pitchP10Hz: null,
          pitchDriftSt: null,
          formantLite: { frontnessScore: null },
          quality: { strainRisk: null },
        },
      },
    },
  });

  assert.ok(record);
  assert.match(record.output, /Mean pitch: unknown/);
  assert.doesNotMatch(record.output, /Advanced take coverage:/);
  assert.doesNotMatch(record.output, /Advanced take shape:/);
  assert.doesNotMatch(record.output, /Target advanced bands:/);
});

test('rejected measurements expose capture reasons but suppress legacy placeholders and advice', () => {
  const voiceState = {
    targetPreset: 'masculine',
    referenceClipId: 'reference-1',
    phraseComparison: {
      pathMatchScore: 0.91,
      quickFeedback: ['legacy phrase praise'],
    },
    lastTakeTimeline: [
      { voiced: true, pitchHz: 211, confidence: 0.9 },
      { voiced: true, pitchHz: 220, confidence: 0.9 },
    ],
    lastSummary: {
      durationMs: 1200,
      issues: ['legacy acoustic correction'],
      nextDrills: ['legacy acoustic drill'],
      metrics: {
        meanPitchHz: 211,
        pitchRangeSt: 4.2,
        targetHitPct: 0.82,
        resonanceMean: 0.71,
        weightMean: 0.29,
        similarityScore: 0.76,
        advanced: {
          measurementAvailable: false,
          measurementRejectionReasons: ['no_voiced_frames'],
          voicedFramePct: 0,
          scoreConfidence: 0,
          pitchP10Hz: 205,
          stabilityMean: 0.9,
        },
      },
    },
  };

  const record = analysisRecord(voiceState);
  assert.match(record.output, /Measurement available: no \| reasons no voiced frames/);
  assert.match(record.output, /Mean pitch: unavailable/);
  assert.match(record.output, /Target hit: unavailable/);
  assert.match(record.output, /Detected issues: suppressed because the take was not measurable/);
  assert.match(record.output, /Suggested drills: measure again before choosing a drill/);
  assert.doesNotMatch(record.output, /211 Hz|82%|legacy acoustic|legacy phrase praise/);
  assert.doesNotMatch(record.output, /Advanced take shape:/);

  const lessonBoard = buildDeepTutorVoiceLessonBoard({ voiceState });
  assert.equal(lessonBoard.mimicDirective.action, 'hold');
  assert.match(lessonBoard.mimicDirective.instruction, /measurement unavailable \(no voiced frames\)/);
  const brief = buildDeepTutorVoiceCoachBrief({
    voiceState,
    deeptutorVoiceState: { lessonBoard },
  });
  assert.doesNotMatch(brief.correctionFocus.join(' | '), /legacy acoustic|legacy phrase praise/);

  const liveMap = guideRecord('voice-live-map', voiceState);
  assert.match(liveMap.output, /Graph evidence: unavailable/);
  assert.match(liveMap.output, /no_voiced_frames/);
  assert.doesNotMatch(liveMap.output, /100%|90%|211 Hz|220 Hz/);
});

test('a measurable summary with no comparison witness is never called aligned', () => {
  const lessonBoard = buildDeepTutorVoiceLessonBoard({
    voiceState: {
      referenceClipId: 'reference-1',
      activeLine: { referenceMode: 'reference-informed' },
      lastSummary: {
        metrics: {
          meanPitchHz: null,
          targetHitPct: null,
          similarityScore: null,
          advanced: {
            measurementAvailable: true,
            scoreConfidence: 0.8,
            voicedFramePct: 0.8,
            metricSimilarity: null,
            contourSimilarity: null,
          },
        },
      },
      phraseComparison: {
        pathMatchScore: null,
        laneMatchScore: null,
        contourMatchScore: null,
      },
    },
  });
  assert.equal(lessonBoard.mimicDirective.action, 'ready');
  assert.equal(lessonBoard.mimicDirective.statusLabel, 'No comparison yet');
  assert.doesNotMatch(lessonBoard.mimicDirective.instruction, /aligned|match is holding/i);
});

test('explicit metric zero remains observable when capture quality is valid', () => {
  const record = analysisRecord({
    // Any live preset; this test is about zero-vs-missing metric rendering.
    targetPreset: 'soft-feminine',
    targetVoiceProfile: {
      advancedBands: { phraseEndDropHzCeiling: 0 },
    },
    lastSummary: {
      metrics: {
        advanced: {
          measurementAvailable: true,
          voicedFramePct: 0.8,
          scoreConfidence: 0.8,
          captureReliability: 0.8,
          pitchDriftSt: 0,
          quality: { breathyRisk: 0 },
        },
      },
    },
  });

  assert.match(record.output, /Advanced take coverage: voiced 80% \| score confidence 80%/);
  assert.match(record.output, /Advanced take shape: drift 0\.00 st \| breathy risk 0%/);
  assert.match(record.output, /Target advanced bands: end-drop ceiling 0\.0 Hz/);
});

test('masculine custom-target corrections stay target-relative instead of feminizing', () => {
  const voiceState = {
    targetPreset: 'masculine',
    targetVoiceProfile: {
      profileId: 'custom-grounded',
      advancedBands: {
        stabilityFloor: 0.6,
        formantLite: { frontnessFloor: 0.5 },
        quality: {},
      },
    },
    lastSummary: {
      metrics: {
        advanced: {
          measurementAvailable: true,
          stabilityMean: 0.2,
          formantLite: { frontnessScore: 0.1 },
          quality: {},
        },
      },
    },
  };
  const lessonBoard = buildDeepTutorVoiceLessonBoard({ voiceState });
  const brief = buildDeepTutorVoiceCoachBrief({
    voiceState,
    deeptutorVoiceState: { lessonBoard },
  });
  const corrections = brief.correctionFocus.join(' | ');

  assert.match(corrections, /target placement/);
  assert.match(corrections, /selected target/);
  assert.doesNotMatch(corrections, /forward|lighter|bright|smile/i);
});

test('Fable correction focus uses the canonical vocalise strain threshold', () => {
  const sustained = buildRiskVoiceState({ kind: 'sustained', strainRisk: 0.6 });
  const phrase = buildRiskVoiceState({ kind: 'phrase', strainRisk: 0.6 });

  assert.doesNotMatch(correctionText(sustained), /squeez|strain|push/i);
  assert.match(correctionText(phrase), /squeez/i);
});

test('Fable correction focus respects profile-capped strain and breathy warning offsets', () => {
  assert.doesNotMatch(correctionText(buildRiskVoiceState({
    strainRisk: 0.31,
    qualityBands: { strainRiskCeiling: 0.3 },
  })), /squeez|strain|push/i);
  assert.match(correctionText(buildRiskVoiceState({
    strainRisk: 0.4,
    qualityBands: { strainRiskCeiling: 0.3 },
  })), /squeez/i);

  assert.doesNotMatch(correctionText(buildRiskVoiceState({
    breathyRisk: 0.31,
    qualityBands: { breathyRiskCeiling: 0.3 },
  })), /air|breath|leak/i);
  // 2026-07-26: the breathy warn now has an absolute FLOOR of 0.45 under the
  // profile resolution (safety-thresholds.js BREATHY_WARN_FLOOR). A ceiling of
  // 0.3 used to resolve warn to 0.42; the floor overrides that, so 0.42 no
  // longer fires and the firing case must clear the floor.
  assert.doesNotMatch(correctionText(buildRiskVoiceState({
    breathyRisk: 0.42,
    qualityBands: { breathyRiskCeiling: 0.3 },
  })), /air|breath|leak/i);
  assert.match(correctionText(buildRiskVoiceState({
    breathyRisk: 0.5,
    qualityBands: { breathyRiskCeiling: 0.3 },
  })), /air|clean/i);
});

test('Fable mimic-gap text uses the same take-kind calibration as correction focus', () => {
  const sustainedBoard = buildDeepTutorVoiceLessonBoard({
    voiceState: buildRiskVoiceState({ kind: 'sustained', strainRisk: 0.6, mimic: true }),
  });
  const phraseBoard = buildDeepTutorVoiceLessonBoard({
    voiceState: buildRiskVoiceState({ kind: 'phrase', strainRisk: 0.6, mimic: true }),
  });

  assert.doesNotMatch(sustainedBoard.mimicDirective.instruction, /squeez|strain|push/i);
  assert.match(phraseBoard.mimicDirective.instruction, /squeez|push/i);
});

test('custom target identity and exact bands are present in the Fable goal record', () => {
  const record = guideRecord('voice-goal', {
    targetPreset: 'masculine',
    targetSource: 'custom-handmade',
    targetVoiceProfile: {
      profileId: 'custom-grounded',
      pitchFloorHz: 100,
      pitchCeilingHz: 140,
      resonanceFloor: 0.1,
      resonanceCeiling: 0.3,
      weightFloor: 0.6,
      weightCeiling: 0.8,
    },
    lastSummary: {
      target: {
        source: 'custom-handmade',
        targetProfileId: 'custom-grounded',
        direction: 'masculine',
        pitchFloorHz: 100,
        pitchCeilingHz: 140,
        resonanceFloor: 0.1,
        resonanceCeiling: 0.3,
        weightFloor: 0.6,
        weightCeiling: 0.8,
      },
    },
  });

  assert.match(record.output, /Target source: custom-handmade/);
  assert.match(record.output, /Target profile ID: custom-grounded/);
  // 2026-07-26 MTF-ONLY: this line is raw stored state going into a Fable
  // prompt, so a RETIRED direction must degrade to 'unknown' here rather than
  // telling the coach to aim masculinizing. Fail-closed, not substituted.
  assert.match(record.output, /Target direction: unknown/);
  assert.doesNotMatch(record.output, /Target direction: masculine/);
  assert.match(record.output, /Target pitch band: 100\.0–140\.0 Hz/);
  assert.match(record.output, /Target resonance band: 10–30%/);
  assert.match(record.output, /Target weight band: 60–80%/);
});
