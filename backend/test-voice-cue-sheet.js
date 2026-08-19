const assert = require('assert');

const {
  buildVoiceCueSheet,
} = require('./voice-cue-sheet');

function testQuestionCueSheetUsesPhysicalAndExpressionCues() {
  const cueSheet = buildVoiceCueSheet({
    phrase: 'Could you say that again?',
    targetPreset: 'cute-feminine',
    focus: 'Playful intonation',
  });

  assert.ok(cueSheet);
  assert.strictEqual(cueSheet.phraseIntent, 'curious check-in');
  // 2026-07-27 cue-vocabulary law: the expression mask is an ACTING direction
  // rendered to the learner ("act the phrase as: ..."), so its tone words were
  // replaced with emotion words — 'light, bright, hopeful' -> 'open, hopeful,
  // unhurried'. The mask is still asserted, on its new content.
  assert.ok(cueSheet.expressionMask.includes('hopeful'));
  assert.ok(cueSheet.cueLine.includes('uh-GEHN~'));
  assert.ok(cueSheet.styledCueLine.includes('SAE'));
  assert.ok(cueSheet.teachingFocus.includes('upward-ending'));
  assert.strictEqual(cueSheet.tokens.length, 5);

  const firstToken = cueSheet.tokens[0];
  const middleToken = cueSheet.tokens[2];
  const lastToken = cueSheet.tokens[4];

  assert.strictEqual(firstToken.text, 'Could');
  assert.strictEqual(firstToken.airflowCue, 'tiny gasp start');
  assert.strictEqual(firstToken.note, 'start it gently, with no click');
  assert.strictEqual(middleToken.text, 'say');
  // Was 'buzz behind upper teeth' — the INVALID resonance check (felt vibration
  // tracks pitch, not tract shape). Replaced by valid signal 1, tongue-side
  // contact against the inner faces of the upper molars.
  assert.strictEqual(middleToken.placementFeel, 'tongue sides on the upper molars');
  assert.strictEqual(lastToken.text, 'again');
  assert.strictEqual(lastToken.expressionCue, 'hopeful question');
  assert.strictEqual(lastToken.avoidCue, 'do not drop');
}

function testPlayfulPresetReturnsAnimatedMask() {
  const cueSheet = buildVoiceCueSheet({
    phrase: 'Wait, that is so cute!',
    targetPreset: 'bright-playful',
    focus: 'Playful sparkle',
  });

  assert.ok(cueSheet);
  assert.strictEqual(cueSheet.phraseIntent, 'playful reveal');
  assert.ok(cueSheet.expressionMask.includes('sparkly'));
  assert.ok(cueSheet.teachingFocus.includes('playful-bounce'));
  assert.ok(cueSheet.tokens.some((token) => token.expressionCue === 'tiny delighted gasp'));
}

function testAustralianBrightPresetKeepsConversationResonanceFocus() {
  const cueSheet = buildVoiceCueSheet({
    phrase: 'Yeah, no worries, I can do that.',
    targetPreset: 'australian-bright-feminine',
    focus: 'bright forward conversation',
  });

  assert.ok(cueSheet);
  assert.strictEqual(cueSheet.phraseIntent, 'everyday conversation');
  assert.ok(cueSheet.expressionMask.includes('Australian-conversational'));
  assert.ok(cueSheet.teachingFocus.includes('bright-vowels'));
  assert.ok(cueSheet.teachingFocus.includes('forward-placement'));
  assert.ok(cueSheet.tokens.some((token) => token.conceptTags.includes('resonance')));
  assert.ok(!cueSheet.teachingFocus.includes('upward-ending'));
}

function main() {
  testQuestionCueSheetUsesPhysicalAndExpressionCues();
  testPlayfulPresetReturnsAnimatedMask();
  testAustralianBrightPresetKeepsConversationResonanceFocus();
  console.log('voice cue sheet tests passed');
}

main();
