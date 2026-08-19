'use strict';

// B-SESS planner-contract tests: sessionScope shapes the prompt (MODE lines
// only) and the deterministic fallback (per-tier material), and the coach stays
// TIME-BLIND — no minutes/time vocabulary anywhere in planner output.
// Predictions (written before first run): every assert below passes; the
// time-word ban regex finds ZERO matches in any prompt or fallback copy.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  LESSON_SCHEMA,
  buildFallbackLesson,
  buildPlanningPrompt,
  planLesson,
} = require('./lesson-planner');

// The owner law: the coach never speaks in time units. This is the hard ban.
const TIME_WORDS = /\b(minutes?|mins?|seconds?|secs?|hours?|hrs?|timers?|durations?|countdowns?|stopwatch(es)?)\b/i;
// Philosophy vocab ban (calm ink copy): no score/streak/badge/guilt language.
const BANNED_VOCAB = /\b(scores?|streaks?|badges?|guilt|shame|failures?)\b/i;

const VOICE_STATE = {
  targetPreset: 'cute-feminine',
  lastSummary: { metrics: { meanPitchHz: 180, resonancePct: 55, weightPct: 50 } },
  targetVoiceProfile: { weightPct: 35, resonancePct: 72 },
};
const LEARNER_CONTEXT = { masteryLevel: 'beginner', struggles: ['pitch_falling_at_end'] };

function allCopyText(plan) {
  return plan.knowledgePoints
    .map((kp) => [kp.title, kp.learnerExplanation, kp.listenFor, kp.cue, kp.practiceAction, kp.successCriteria, kp.safetyNote].join(' '))
    .concat(plan.lessonTitle)
    .join(' ');
}

test('schema relax: knowledgePoints minItems is 1', () => {
  assert.equal(LESSON_SCHEMA.properties.knowledgePoints.minItems, 1);
  assert.equal(LESSON_SCHEMA.properties.knowledgePoints.maxItems, 5);
});

test('prompt: no scope -> no MODE lines, and no time words', () => {
  const prompt = buildPlanningPrompt(VOICE_STATE, LEARNER_CONTEXT);
  assert.ok(!prompt.includes('MODE:'));
  assert.ok(!TIME_WORDS.test(prompt), `time word leaked into prompt: ${prompt.match(TIME_WORDS)?.[0]}`);
});

test('prompt: quiet tier appends the quiet MODE line only', () => {
  const prompt = buildPlanningPrompt(VOICE_STATE, LEARNER_CONTEXT, { tier: 'quiet', eyesFree: false });
  assert.ok(prompt.includes('MODE: quiet practice'));
  assert.ok(prompt.includes('no full-voice speech'));
  assert.ok(prompt.includes('humming and soft-onset material'));
  assert.ok(!prompt.includes('MODE: silent'));
  assert.ok(!prompt.includes('eyes-free'));
  assert.ok(!TIME_WORDS.test(prompt), `time word leaked into prompt: ${prompt.match(TIME_WORDS)?.[0]}`);
});

test('prompt: silent tier appends the silent MODE line only', () => {
  const prompt = buildPlanningPrompt(VOICE_STATE, LEARNER_CONTEXT, { tier: 'silent', eyesFree: false });
  assert.ok(prompt.includes('MODE: silent session'));
  assert.ok(prompt.includes('will not speak aloud'));
  assert.ok(prompt.includes('listening, comparing, and planning material'));
  assert.ok(!prompt.includes('MODE: quiet'));
  assert.ok(!TIME_WORDS.test(prompt), `time word leaked into prompt: ${prompt.match(TIME_WORDS)?.[0]}`);
});

test('prompt: eyesFree appends the spoken-first MODE line (alone and combined)', () => {
  const alone = buildPlanningPrompt(VOICE_STATE, LEARNER_CONTEXT, { tier: 'full', eyesFree: true });
  assert.ok(alone.includes('MODE: eyes-free'));
  assert.ok(alone.includes('cannot read the screen'));
  assert.ok(alone.includes('spoken-first'));
  assert.ok(!alone.includes('MODE: quiet'));
  assert.ok(!alone.includes('MODE: silent'));
  assert.ok(!TIME_WORDS.test(alone), `time word leaked into prompt: ${alone.match(TIME_WORDS)?.[0]}`);

  const combined = buildPlanningPrompt(VOICE_STATE, LEARNER_CONTEXT, { tier: 'quiet', eyesFree: true });
  assert.ok(combined.includes('MODE: quiet practice'));
  assert.ok(combined.includes('MODE: eyes-free'));
  assert.ok(!TIME_WORDS.test(combined), `time word leaked into prompt: ${combined.match(TIME_WORDS)?.[0]}`);
});

test('fallback: quiet tier plans hum/soft-onset material (2 points, calm copy)', () => {
  const plan = buildFallbackLesson(VOICE_STATE, LEARNER_CONTEXT, { tier: 'quiet', eyesFree: false });
  assert.equal(plan.knowledgePoints.length, 2, 'quiet may be 1-2 points, not padded to 3');
  const copy = allCopyText(plan);
  assert.ok(/hum/i.test(copy), 'quiet plan centers on humming');
  assert.ok(/onset/i.test(copy), 'quiet plan includes soft-onset work');
  assert.ok(!TIME_WORDS.test(copy), `time word leaked into copy: ${copy.match(TIME_WORDS)?.[0]}`);
  assert.ok(!BANNED_VOCAB.test(copy), `banned vocab leaked into copy: ${copy.match(BANNED_VOCAB)?.[0]}`);
  for (const kp of plan.knowledgePoints) {
    for (const field of ['id', 'title', 'learnerExplanation', 'cue', 'practiceAction', 'successCriteria']) {
      assert.ok(typeof kp[field] === 'string' && kp[field].trim(), `quiet point has ${field}`);
    }
  }
});

// 2026-07-26 homework law: this test used to pin the silent tier's middle point
// as "Pick Tomorrow's Sentence" — practice scheduled for later, somewhere else,
// which the product law now forbids. The tier still needs a soundless point, so
// the middle point is silent MOUTHING: the same articulatory work, done now,
// with nothing but the mouth. The point ids are unchanged.
test('fallback: silent tier plans tutor-led listening + silent mouthing + one concept', () => {
  const plan = buildFallbackLesson(VOICE_STATE, LEARNER_CONTEXT, { tier: 'silent', eyesFree: false });
  assert.equal(plan.knowledgePoints.length, 3);
  const [listening, mouthing, concept] = plan.knowledgePoints;
  assert.ok(/closer/i.test(`${listening.title} ${listening.practiceAction}`), 'which-one-is-closer point');
  assert.ok(/listen/i.test(`${listening.learnerExplanation} ${listening.safetyNote}`));
  assert.ok(/mouth/i.test(`${mouthing.title} ${mouthing.practiceAction}`), 'silent-mouthing point');
  assert.ok(/resonance|sound/i.test(`${concept.title} ${concept.learnerExplanation}`), 'one concept point');
  // The whole tier must be doable with voice and body alone, and now.
  const silentCopy = allCopyText(plan);
  assert.doesNotMatch(silentCopy, /\btomorrow\b|\bnext time\b|\bat home\b|\bon your own\b/i, 'no away-from-session framing');
  assert.doesNotMatch(silentCopy, /\bplay\s+(?:two|both|your|the)\b[^.]{0,28}\btakes?\b/i, 'no learner-operated playback');
  const copy = allCopyText(plan);
  assert.ok(!TIME_WORDS.test(copy), `time word leaked into copy: ${copy.match(TIME_WORDS)?.[0]}`);
  assert.ok(!BANNED_VOCAB.test(copy), `banned vocab leaked into copy: ${copy.match(BANNED_VOCAB)?.[0]}`);
});

test('fallback: full tier keeps the legacy pad-to-3 behavior', () => {
  const plan = buildFallbackLesson(VOICE_STATE, LEARNER_CONTEXT, { tier: 'full', eyesFree: false });
  assert.ok(plan.knowledgePoints.length >= 3);
  const noScope = buildFallbackLesson(VOICE_STATE, LEARNER_CONTEXT);
  assert.ok(noScope.knowledgePoints.length >= 3, 'absent scope behaves as full');
});

test('canonical metrics and exact custom bands drive prompt and fallback direction', () => {
  // RE-POINTED 2026-07-26: was a masculine custom target, retired with the
  // masculinizing direction. The guarantee is unchanged — a CUSTOM target's
  // exact bands drive the prompt and the fallback copy, and the feminizing
  // default must not leak in — proven now on the surviving neutral lane.
  const neutralCustom = {
    targetPreset: 'gender-neutral',
    targetSource: 'custom-handmade',
    targetVoiceProfile: { profileId: 'centered-custom' },
    lastSummary: {
      targetPreset: 'gender-neutral',
      metrics: {
        meanPitchHz: 120,
        resonanceMean: 0.5,
        weightMean: 0.4,
        targetHitPct: 0.35,
        advanced: { measurementAvailable: true },
      },
      target: {
        source: 'custom-handmade',
        targetProfileId: 'centered-custom',
        targetPreset: 'gender-neutral',
        direction: 'neutral',
        pitchFloorHz: 152,
        pitchCeilingHz: 172,
        resonanceFloor: 0.3,
        resonanceCeiling: 0.5,
        weightFloor: 0.35,
        weightCeiling: 0.55,
      },
    },
  };

  const prompt = buildPlanningPrompt(neutralCustom, {});
  assert.match(prompt, /Resonance: 50%/);
  assert.match(prompt, /Voice weight: 40%/);
  assert.match(prompt, /Target hit: 35%/);
  assert.match(prompt, /Target direction: neutral/);
  assert.match(prompt, /Target source: custom-handmade/);

  const plan = buildFallbackLesson(neutralCustom, {});
  const copy = allCopyText(plan);
  assert.match(copy, /balanced|centered|even/i);
  assert.doesNotMatch(copy, /lighter voice weight|bright forward placement|small, forward, bright/i);
});

test('measurement-unavailable summary creates a capture reset, never metric correction', () => {
  const invalid = {
    ...VOICE_STATE,
    lastSummary: {
      metrics: {
        meanPitchHz: 201.5,
        resonanceMean: 0.58,
        weightMean: 0.42,
        advanced: {
          measurementAvailable: false,
          measurementRejectionReasons: ['no_voiced_frames'],
        },
      },
    },
  };
  const plan = buildFallbackLesson(invalid, {});
  const copy = allCopyText(plan);
  assert.match(copy, /capture|microphone|fresh take/i);
  assert.doesNotMatch(copy, /201|58%|42%|lighter voice weight|forward resonance/i);
});

test('planLesson threads sessionScope into the fallback when the model is down', async () => {
  const plan = await planLesson(VOICE_STATE, LEARNER_CONTEXT, async () => {
    throw new Error('offline (test)');
  }, { tier: 'silent', eyesFree: true });
  assert.equal(plan.knowledgePoints.length, 3);
  assert.equal(plan.knowledgePoints[0].id, 'kp-silent-1');
});

test('planLesson threads sessionScope into the prompt on the model path', async () => {
  let seenPrompt = '';
  const modelPoints = [{
    id: 'kp-m1', title: 'Hum Check', learnerExplanation: 'x', cue: 'soft', practiceAction: 'hum', successCriteria: 'easy',
  }];
  const plan = await planLesson(VOICE_STATE, LEARNER_CONTEXT, async (messages) => {
    seenPrompt = messages[1].content;
    return JSON.stringify(modelPoints);
  }, { tier: 'quiet', eyesFree: false });
  assert.ok(seenPrompt.includes('MODE: quiet practice'), 'model saw the MODE constraint');
  assert.ok(!TIME_WORDS.test(seenPrompt));
  assert.equal(plan.knowledgePoints.length, 1, 'a 1-point model plan is valid under the relaxed schema');
  assert.equal(plan.knowledgePoints[0].id, 'kp-m1');
});
