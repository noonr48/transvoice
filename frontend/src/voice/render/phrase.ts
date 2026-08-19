import type { VoiceCueSheet, VoiceCueSheetToken, VoicePhraseCheckpoint, VoicePhraseComparison } from '../state';

type VoicePhraseComparisonMatcher = (value: string | null | undefined) => string;

type VoicePhraseQuickFeedbackRenderContext = {
  element: HTMLElement | null | undefined;
  comparison: VoicePhraseComparison | null | undefined;
  hasForecastTimeline: boolean;
};

type VoicePhraseCheckpointsRenderContext = {
  element: HTMLElement | null | undefined;
  comparison: VoicePhraseComparison | null | undefined;
  hasForecastTimeline: boolean;
};

type VoiceCueSheetRenderContext = {
  metaEl: HTMLElement | null | undefined;
  lineEl: HTMLElement | null | undefined;
  tokensEl: HTMLElement | null | undefined;
  cueSheet: VoiceCueSheet | null;
  comparison: VoicePhraseComparison | null | undefined;
  comparisonMatchesCueSheet: boolean;
};

export function getVoiceComparisonScoreText(score: number | null | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return 'not scored yet';
  }
  return `${Math.round(score * 100)}%`;
}

export function getVoicePhraseCheckpointTone(score: number | null | undefined): string {
  if (typeof score !== 'number' || !Number.isFinite(score)) {
    return 'pending';
  }
  if (score >= 0.75) return 'strong';
  if (score >= 0.5) return 'mixed';
  return 'weak';
}

export function isVoiceComparisonMatchCueSheet({
  cueSheet,
  comparison,
  normalizePhraseText,
}: {
  cueSheet: VoiceCueSheet | null;
  comparison: VoicePhraseComparison | null | undefined;
  normalizePhraseText: VoicePhraseComparisonMatcher;
}): boolean {
  return Boolean(
    cueSheet
    && comparison
    && normalizePhraseText(comparison.phrase) === normalizePhraseText(cueSheet.phrase),
  );
}

export function getVoiceCueSheetCheckpointForToken(
  token: VoiceCueSheetToken | null | undefined,
  comparison: VoicePhraseComparison | null | undefined,
): VoicePhraseCheckpoint | null {
  if (!token || !comparison || !Array.isArray(comparison.checkpoints) || comparison.checkpoints.length === 0) {
    return null;
  }

  const tokenStart = typeof token.startProgress === 'number' ? token.startProgress : 0;
  const tokenEnd = typeof token.endProgress === 'number' ? token.endProgress : 1;
  const overlaps = comparison.checkpoints.filter((checkpoint) => {
    const checkpointStart = typeof checkpoint.startProgress === 'number' ? checkpoint.startProgress : 0;
    const checkpointEnd = typeof checkpoint.endProgress === 'number' ? checkpoint.endProgress : 1;
    return checkpointEnd > tokenStart && checkpointStart < tokenEnd;
  });

  if (overlaps.length === 0) {
    return null;
  }

  return overlaps.sort((left, right) => {
    const leftScore = typeof left.pathMatchScore === 'number' ? left.pathMatchScore : 1;
    const rightScore = typeof right.pathMatchScore === 'number' ? right.pathMatchScore : 1;
    return leftScore - rightScore;
  })[0] || null;
}

export function renderVoicePhraseQuickFeedback({
  element,
  comparison,
  hasForecastTimeline,
}: VoicePhraseQuickFeedbackRenderContext): void {
  if (!element) return;
  element.replaceChildren();

  const feedback = Array.isArray(comparison?.quickFeedback)
    ? comparison.quickFeedback.filter(Boolean)
    : [];

  if (!feedback || feedback.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'voice-phrase-empty';
    empty.textContent = hasForecastTimeline
      ? 'Finish a take to get fast local coaching from the phrase-match scores.'
      : 'Project a phrase map first, then end a take to unlock instant feedback.';
    element.appendChild(empty);
    return;
  }

  for (const item of feedback) {
    const pill = document.createElement('div');
    pill.className = 'voice-phrase-feedback-pill';
    pill.textContent = item;
    element.appendChild(pill);
  }
}

export function renderVoicePhraseCheckpoints({
  element,
  comparison,
  hasForecastTimeline,
}: VoicePhraseCheckpointsRenderContext): void {
  if (!element) return;
  element.replaceChildren();

  const checkpoints = Array.isArray(comparison?.checkpoints)
    ? comparison.checkpoints.filter(Boolean)
    : [];

  if (!checkpoints || checkpoints.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'voice-phrase-empty';
    empty.textContent = hasForecastTimeline
      ? 'Checkpoint cards will appear here after the take is scored.'
      : 'No checkpoint breakdown yet.';
    element.appendChild(empty);
    return;
  }

  for (const checkpoint of checkpoints) {
    const card = document.createElement('div');
    card.className = `voice-phrase-checkpoint ${getVoicePhraseCheckpointTone(checkpoint.pathMatchScore)}`;

    const title = document.createElement('strong');
    title.className = 'voice-phrase-checkpoint-title';
    title.textContent = checkpoint.label || 'Phrase segment';

    const metrics = document.createElement('span');
    metrics.className = 'voice-phrase-checkpoint-metrics';
    metrics.textContent = [
      `path ${getVoiceComparisonScoreText(checkpoint.pathMatchScore)}`,
      `lane ${getVoiceComparisonScoreText(checkpoint.laneMatchScore)}`,
      `contour ${getVoiceComparisonScoreText(checkpoint.contourMatchScore)}`,
      `tunnel ${getVoiceComparisonScoreText(checkpoint.corridorHoldScore)}`,
    ].join(' • ');

    const copy = document.createElement('p');
    copy.className = 'voice-phrase-checkpoint-copy';
    copy.textContent = checkpoint.summary || 'No note for this checkpoint yet.';

    card.append(title, metrics);

    if (Array.isArray(checkpoint.detailPills) && checkpoint.detailPills.length > 0) {
      const detailPills = document.createElement('div');
      detailPills.className = 'voice-pill-list';
      for (const detail of checkpoint.detailPills.slice(0, 4)) {
        const pill = document.createElement('span');
        pill.className = 'voice-pill';
        pill.textContent = detail;
        detailPills.appendChild(pill);
      }
      card.appendChild(detailPills);
    }

    card.appendChild(copy);
    element.appendChild(card);
  }
}

export function renderVoiceCueSheet({
  metaEl,
  lineEl,
  tokensEl,
  cueSheet,
  comparison,
  comparisonMatchesCueSheet,
}: VoiceCueSheetRenderContext): void {
  if (!metaEl || !lineEl || !tokensEl) return;
  metaEl.replaceChildren();
  lineEl.replaceChildren();
  tokensEl.replaceChildren();

  if (!cueSheet) {
    const emptyLine = document.createElement('div');
    emptyLine.className = 'voice-phrase-empty';
    emptyLine.textContent = 'No coached phrase loaded yet.';
    lineEl.appendChild(emptyLine);

    const emptyTokens = document.createElement('div');
    emptyTokens.className = 'voice-phrase-empty';
    emptyTokens.textContent = 'Word-by-word mouth notes will appear here once a drill or phrase map is active.';
    tokensEl.appendChild(emptyTokens);
    return;
  }

  const metaBits = [
    cueSheet.phraseIntent ? { label: 'Intent', value: cueSheet.phraseIntent } : null,
    cueSheet.expressionMask ? { label: 'Expression', value: cueSheet.expressionMask } : null,
    ...(Array.isArray(cueSheet.teachingFocus) ? cueSheet.teachingFocus.slice(0, 4).map((focus) => ({ label: 'Focus', value: focus.replace(/-/g, ' ') })) : []),
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  for (const bit of metaBits) {
    const chip = document.createElement('span');
    chip.className = 'voice-cue-sheet-chip';

    const label = document.createElement('span');
    label.className = 'voice-cue-sheet-chip-label';
    label.textContent = bit.label;

    const value = document.createElement('strong');
    value.className = 'voice-cue-sheet-chip-value';
    value.textContent = bit.value;

    chip.append(label, value);
    metaEl.appendChild(chip);
  }

  const phraseLine = document.createElement('span');
  phraseLine.className = 'voice-cue-sheet-original';
  phraseLine.textContent = cueSheet.phrase || 'Phrase';

  const cueLine = document.createElement('strong');
  cueLine.className = 'voice-cue-sheet-styled';
  cueLine.textContent = cueSheet.styledCueLine || cueSheet.cueLine || cueSheet.phrase || 'No cue line';

  lineEl.append(phraseLine, cueLine);

  if (!Array.isArray(cueSheet.tokens) || cueSheet.tokens.length === 0) {
    const emptyTokens = document.createElement('div');
    emptyTokens.className = 'voice-phrase-empty';
    emptyTokens.textContent = 'Cue tokens are still loading for this phrase.';
    tokensEl.appendChild(emptyTokens);
    return;
  }

  for (const token of cueSheet.tokens) {
    const checkpoint = comparisonMatchesCueSheet ? getVoiceCueSheetCheckpointForToken(token, comparison) : null;
    const tone = comparisonMatchesCueSheet ? getVoicePhraseCheckpointTone(checkpoint?.pathMatchScore) : 'pending';
    const card = document.createElement('div');
    card.className = `voice-cue-token ${tone}`;

    const word = document.createElement('span');
    word.className = 'voice-cue-token-word';
    word.textContent = token.text;

    const cue = document.createElement('strong');
    cue.className = 'voice-cue-token-cue';
    cue.textContent = token.styledCue || token.cue || token.text;

    const note = document.createElement('span');
    note.className = 'voice-cue-token-note';
    note.textContent = token.note || 'Keep it light and forward.';

    const action = document.createElement('span');
    action.className = 'voice-cue-token-detail';
    action.textContent = [
      token.mouthShape,
      token.jawAction,
      token.lipAction,
    ].filter(Boolean).join(' • ') || 'Keep the mouth small and easy.';

    const feel = document.createElement('span');
    feel.className = 'voice-cue-token-detail';
    feel.textContent = [
      token.airflowCue,
      token.placementFeel,
      token.tongueAction,
    ].filter(Boolean).join(' • ') || 'Keep the feel forward in the face.';

    const expression = document.createElement('span');
    expression.className = 'voice-cue-token-detail';
    expression.textContent = [
      token.expressionCue,
      token.avoidCue,
    ].filter(Boolean).join(' • ') || 'Stay light and expressive.';

    card.append(word, cue, note, action, feel, expression);

    if (checkpoint?.summary) {
      const feedback = document.createElement('span');
      feedback.className = 'voice-cue-token-feedback';
      feedback.textContent = checkpoint.summary;
      card.appendChild(feedback);
    }

    tokensEl.appendChild(card);
  }
}
