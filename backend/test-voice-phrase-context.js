const assert = require('assert');

const {
  buildVoicePhraseComparisonKey,
  doesVoicePhraseForecastMatchActivePhrase,
  getRenderableVoicePhraseComparison,
  resolveActiveVoicePhrase,
  resolveProjectedVoicePhrase,
} = require('./voice-phrase-context');

function testResolveActiveVoicePhrasePrefersActiveCueSheet() {
  const phrase = resolveActiveVoicePhrase({
    activeLine: {
      displayText: 'fallback line',
      cueSheet: {
        phrase: '   Keep it bright and playful?   ',
      },
    },
    forecastPhrase: 'old phrase',
    phraseForecast: { phrase: 'older phrase' },
  });

  assert.strictEqual(phrase, 'Keep it bright and playful?');
}

function testPhraseComparisonKeyNormalizesPhraseText() {
  const left = buildVoicePhraseComparisonKey({
    lessonId: 'drill-1',
    phrase: 'Could you say that again?',
  });
  const right = buildVoicePhraseComparisonKey({
    lessonId: 'drill-1',
    phrase: 'could   you say that again',
  });

  assert.strictEqual(left, right);
}

function testResolveProjectedVoicePhrasePrefersProjectedMapPhrase() {
  const phrase = resolveProjectedVoicePhrase({
    forecastPhrase: 'fallback phrase',
    phraseForecast: { phrase: 'mapped phrase' },
  });

  assert.strictEqual(phrase, 'mapped phrase');
}

function testForecastMatchIgnoresMissingProjection() {
  assert.strictEqual(
    doesVoicePhraseForecastMatchActivePhrase({
      activeLine: {
        cueSheet: { phrase: 'new active phrase' },
      },
      forecastPhrase: null,
      phraseForecast: null,
    }),
    true,
  );
}

function testForecastMatchRejectsStaleProjectedPhrase() {
  assert.strictEqual(
    doesVoicePhraseForecastMatchActivePhrase({
      activeLine: {
        cueSheet: { phrase: 'new active phrase' },
      },
      forecastPhrase: 'old projected phrase',
      phraseForecast: { phrase: 'old projected phrase' },
    }),
    false,
  );
}

function testRenderableComparisonRejectsStalePhraseMismatch() {
  const comparison = getRenderableVoicePhraseComparison({
    phraseComparison: {
      lessonId: 'drill-1',
      phrase: 'old phrase',
      forecastPhrase: 'old phrase',
      pathMatchScore: 0.81,
    },
    lessonId: 'drill-1',
    activePhrase: 'new phrase',
  });

  assert.strictEqual(comparison, null);
}

function testRenderableComparisonKeepsCurrentPhraseMatch() {
  const comparison = {
    lessonId: 'drill-1',
    phrase: 'Could you say that again?',
    forecastPhrase: 'Could you say that again?',
    pathMatchScore: 0.81,
  };

  assert.deepStrictEqual(
    getRenderableVoicePhraseComparison({
      phraseComparison: comparison,
      lessonId: 'drill-1',
      activePhrase: 'could you say that again',
    }),
    comparison,
  );
}

function main() {
  testResolveActiveVoicePhrasePrefersActiveCueSheet();
  testPhraseComparisonKeyNormalizesPhraseText();
  testResolveProjectedVoicePhrasePrefersProjectedMapPhrase();
  testForecastMatchIgnoresMissingProjection();
  testForecastMatchRejectsStaleProjectedPhrase();
  testRenderableComparisonRejectsStalePhraseMismatch();
  testRenderableComparisonKeepsCurrentPhraseMatch();
  console.log('voice phrase context tests passed');
}

main();
