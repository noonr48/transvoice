function normalizeVoicePhraseTextForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildVoicePhraseComparisonKey({
  lessonId = null,
  phrase = null,
} = {}) {
  const normalizedLessonId = typeof lessonId === 'string' && lessonId.trim()
    ? lessonId.trim()
    : '';
  const normalizedPhrase = normalizeVoicePhraseTextForMatch(phrase);
  if (!normalizedLessonId && !normalizedPhrase) {
    return null;
  }
  return `${normalizedLessonId}::${normalizedPhrase}`;
}

function resolveActiveVoicePhrase({
  activeLine = null,
  forecastPhrase = null,
  phraseForecast = null,
} = {}) {
  const activeCuePhrase = typeof activeLine?.cueSheet?.phrase === 'string' && activeLine.cueSheet.phrase.trim()
    ? activeLine.cueSheet.phrase.trim()
    : '';
  if (activeCuePhrase) {
    return activeCuePhrase;
  }

  const activeDisplayText = typeof activeLine?.displayText === 'string' && activeLine.displayText.trim()
    ? activeLine.displayText.trim()
    : '';
  if (activeDisplayText) {
    return activeDisplayText;
  }

  const normalizedForecastPhrase = typeof forecastPhrase === 'string' && forecastPhrase.trim()
    ? forecastPhrase.trim()
    : '';
  if (normalizedForecastPhrase) {
    return normalizedForecastPhrase;
  }

  const projectedPhrase = typeof phraseForecast?.phrase === 'string' && phraseForecast.phrase.trim()
    ? phraseForecast.phrase.trim()
    : '';
  return projectedPhrase || null;
}

function resolveProjectedVoicePhrase({
  forecastPhrase = null,
  phraseForecast = null,
} = {}) {
  const projectedPhrase = typeof phraseForecast?.phrase === 'string' && phraseForecast.phrase.trim()
    ? phraseForecast.phrase.trim()
    : '';
  if (projectedPhrase) {
    return projectedPhrase;
  }

  const normalizedForecastPhrase = typeof forecastPhrase === 'string' && forecastPhrase.trim()
    ? forecastPhrase.trim()
    : '';
  return normalizedForecastPhrase || null;
}

function doesVoicePhraseForecastMatchActivePhrase({
  activeLine = null,
  forecastPhrase = null,
  phraseForecast = null,
} = {}) {
  const activePhrase = resolveActiveVoicePhrase({
    activeLine,
    forecastPhrase,
    phraseForecast,
  });
  const projectedPhrase = resolveProjectedVoicePhrase({
    forecastPhrase,
    phraseForecast,
  });
  if (!activePhrase || !projectedPhrase) {
    return true;
  }
  return normalizeVoicePhraseTextForMatch(activePhrase) === normalizeVoicePhraseTextForMatch(projectedPhrase);
}

function getRenderableVoicePhraseComparison({
  phraseComparison = null,
  lessonId = null,
  activePhrase = null,
} = {}) {
  if (!phraseComparison || typeof phraseComparison !== 'object' || Array.isArray(phraseComparison)) {
    return null;
  }

  const activeKey = buildVoicePhraseComparisonKey({
    lessonId,
    phrase: activePhrase,
  });
  const comparisonKey = buildVoicePhraseComparisonKey({
    lessonId: phraseComparison.lessonId || null,
    phrase: phraseComparison.forecastPhrase || phraseComparison.phrase || null,
  });
  if (activeKey && comparisonKey && activeKey !== comparisonKey) {
    return null;
  }
  return phraseComparison;
}

module.exports = {
  normalizeVoicePhraseTextForMatch,
  buildVoicePhraseComparisonKey,
  resolveActiveVoicePhrase,
  resolveProjectedVoicePhrase,
  doesVoicePhraseForecastMatchActivePhrase,
  getRenderableVoicePhraseComparison,
};
