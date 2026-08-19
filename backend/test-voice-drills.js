const assert = require('assert');

const {
  collectRecommendationTags,
  getVoiceDrillById,
  getVoiceDrillPack,
  recommendVoiceDrillIds,
} = require('./voice-drills');

function testDrillPackContents() {
  const cutePack = getVoiceDrillPack('cute-feminine');
  assert.ok(cutePack.length >= 4);
  assert.ok(cutePack.every((drill) => drill.id && drill.title && drill.phrase));
  assert.notStrictEqual(cutePack[0].cues, getVoiceDrillPack('cute-feminine')[0].cues);

  const australianPack = getVoiceDrillPack('australian-bright-feminine');
  assert.ok(australianPack.length >= 4);
  assert.ok(australianPack.some((drill) => drill.tags.includes('conversation')));
  assert.ok(australianPack.some((drill) => /no worries|coffee|reckon/i.test(drill.phrase)));
}

function testDrillLookupFallsBackAcrossPacks() {
  const drill = getVoiceDrillById('cute-feminine', 'everyday-shadow-repeat');
  assert.strictEqual(drill.id, 'everyday-shadow-repeat');
  assert.strictEqual(drill.focus, 'Reference imitation');
}

function testRecommendationTagExtraction() {
  const tags = collectRecommendationTags({
    summary: {
      issues: ['Resonance stays darker than target; push more brightness into ng-to-ee transitions.'],
      nextDrills: ['pause-and-echo the reference one phrase at a time'],
    },
    studentModel: {
      reviewQueue: [{ conceptId: 'voice_light_vocal_weight', name: 'Light vocal weight' }],
      struggles: ['intonation still needs more lift at endings'],
    },
  });

  assert.ok(tags.includes('resonance'));
  assert.ok(tags.includes('mimicry'));
  assert.ok(tags.includes('weight'));
  assert.ok(tags.includes('intonation'));
}

function testRecommendationOrderingRespondsToContext() {
  const recommended = recommendVoiceDrillIds({
    targetPreset: 'bright-playful',
    summary: {
      issues: ['Reference match still drifts; shadow the sample in shorter chunks before full phrases.'],
      nextDrills: ['pause-and-echo the reference one phrase at a time'],
      metrics: { targetHitPct: 0.68 },
    },
    studentModel: {
      reviewQueue: [{ conceptId: 'voice_reference_matching', name: 'Reference matching' }],
      struggles: [],
    },
    hasReference: true,
  });

  assert.strictEqual(recommended[0], 'playful-mirror-burst');
  assert.strictEqual(recommended.length, 3);
}

function main() {
  testDrillPackContents();
  testDrillLookupFallsBackAcrossPacks();
  testRecommendationTagExtraction();
  testRecommendationOrderingRespondsToContext();
  console.log('voice drill tests passed');
}

main();
