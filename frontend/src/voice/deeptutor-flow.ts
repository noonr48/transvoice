import type { DeepTutorVoiceInteractionState } from './orchestrator';
import {
  getDeepTutorVoiceLessonMode,
  type DeepTutorVoiceState,
} from './state';

type DeepTutorVoiceResumeButtonLabelOptions = {
  interaction: DeepTutorVoiceInteractionState;
};

export function hasDeepTutorVoiceLessonState(
  value: Partial<DeepTutorVoiceState> | null | undefined,
): boolean {
  return getDeepTutorVoiceLessonMode(value) !== 'none';
}

export function shouldRebuildDeepTutorVoiceLessonState(
  value: Partial<DeepTutorVoiceState> | null | undefined,
): boolean {
  const lessonMode = getDeepTutorVoiceLessonMode(value);
  if (lessonMode === 'none') {
    return false;
  }

  const status = (value?.guideSessionStatus || value?.status || '').trim().toLowerCase();
  return Boolean(value?.guideSessionId) && (status === 'completed' || status === 'error');
}

export function getDeepTutorVoiceResumeButtonLabel(
  options: DeepTutorVoiceResumeButtonLabelOptions,
): string {
  if (options.interaction.lessonLifecycle === 'syncing') {
    return 'Syncing Coach...';
  }
  if (options.interaction.lessonLifecycle === 'start-required') {
    return 'Guided Coach';
  }
  if (options.interaction.snapshot.practiceState === 'arming') {
    return 'Practice Arming...';
  }
  if (options.interaction.snapshot.practiceState !== 'idle') {
    return 'Back to Coach';
  }
  if (options.interaction.practiceIntent === 'practice') {
    return 'Arm Next Pass';
  }
  if (options.interaction.coachListeningState === 'armed') {
    return 'Coach Armed';
  }
  if (options.interaction.coachListeningState === 'listening') {
    return 'Coach Listening';
  }
  return 'Resume Coach';
}
