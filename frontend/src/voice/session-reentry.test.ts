import { describe, expect, it } from 'vitest';
import { createDefaultVoiceUiState } from './state';
import {
  deriveSessionStage,
  planDirectFallbackVoiceSessionReentry,
  planRestoredVoiceSessionReentry,
  planStartedVoiceSessionReentry,
  planVoiceModeBootstrap,
} from './session-reentry';

describe('voice session reentry planning', () => {
  it('plans started voice sessions with runtime reset and cleared traces', () => {
    const currentVoiceUiState = createDefaultVoiceUiState({ targetPreset: 'bright-guide' });

    const plan = planStartedVoiceSessionReentry('voice', {
      voiceState: {
        voiceSessionId: 'voice-session-1',
        referenceClipId: 'ref-1',
        targetPreset: 'coach-preset',
      },
    }, currentVoiceUiState);

    expect(plan.persistedReferenceClipId).toBe('ref-1');
    expect(plan.nextVoiceUiState.voiceSessionId).toBe('voice-session-1');
    expect(plan.nextVoiceUiState.targetPreset).toBe('coach-preset');
    expect(plan.runtimeReset?.stopListening).toBe(true);
    expect(plan.runtimeReset?.syncLastSpokenCoachMessage).toBe(true);
    expect(plan.nextLiveTrace).toEqual([]);
    expect(plan.nextLastTakeTrace).toEqual([]);
  });

  it('plans restored voice sessions with saved take traces and runtime reset', () => {
    const currentVoiceUiState = createDefaultVoiceUiState({ targetPreset: 'steady' });
    const timeline = [{ t: 0, pitchHz: 220 }];

    const plan = planRestoredVoiceSessionReentry('voice', {
      voiceState: {
        voiceSessionId: 'voice-session-2',
        referenceClipId: 'ref-2',
        lastTakeTimeline: timeline,
      },
    }, currentVoiceUiState);

    expect(plan.persistedReferenceClipId).toBe('ref-2');
    expect(plan.runtimeReset?.stopListening).toBe(true);
    expect(plan.nextLastTakeTrace).toHaveLength(1);
    expect(plan.nextLastTakeTrace[0]).toMatchObject({ t: 0, pitchHz: 220 });
    expect(plan.nextLastTakeTrace).not.toBe(timeline);
  });

  it('plans direct fallback voice sessions with a lighter runtime reset', () => {
    const currentVoiceUiState = createDefaultVoiceUiState({ targetPreset: 'teacher' });

    const plan = planDirectFallbackVoiceSessionReentry('voice', currentVoiceUiState);

    expect(plan.persistedReferenceClipId).toBeNull();
    expect(plan.nextVoiceUiState.targetPreset).toBe('teacher');
    expect(plan.runtimeReset).toEqual({
      resetForecastState: true,
      resetDrillState: true,
    });
  });

  it('derives bootstrap reentry decisions from saved voice session state', () => {
    expect(planVoiceModeBootstrap({
      autoStart: true,
      voiceSessionId: 'voice-session-3',
      voiceTransportStatus: 'idle',
    })).toEqual({
      shouldResumeExistingSession: true,
      shouldAutoStartPractice: false,
    });

    expect(planVoiceModeBootstrap({
      autoStart: true,
      voiceSessionId: null,
      voiceTransportStatus: 'idle',
    })).toEqual({
      shouldResumeExistingSession: false,
      shouldAutoStartPractice: true,
    });

    expect(planVoiceModeBootstrap({
      autoStart: false,
      voiceSessionId: 'voice-session-3',
      voiceTransportStatus: 'idle',
    })).toEqual({
      shouldResumeExistingSession: false,
      shouldAutoStartPractice: false,
    });
  });
});

describe('deriveSessionStage', () => {
  it('starts at warm-up with no reference and no attempts', () => {
    expect(deriveSessionStage({ voiceSessionId: 'session-1', targetSource: 'built-in' })).toBe('warmup');
  });

  it('moves to target once a reference is loaded (voice-copy front door)', () => {
    expect(deriveSessionStage({ voiceSessionId: 'session-1', referenceClipId: 'clip-1' })).toBe('target');
    expect(deriveSessionStage({ voiceSessionId: 'session-1', targetSource: 'reference' })).toBe('target');
  });

  it('is in practice while a take is active or the session is armed', () => {
    expect(deriveSessionStage({ referenceClipId: 'clip-1', takeActive: true })).toBe('practice');
    expect(deriveSessionStage({ referenceClipId: 'clip-1', transportStatus: 'streaming' })).toBe('practice');
    expect(deriveSessionStage({ referenceClipId: 'clip-1', sessionArmed: true })).toBe('practice');
  });

  it('lands in review after a take finishes, but practice wins while one is underway', () => {
    expect(deriveSessionStage({ referenceClipId: 'clip-1', hasLastSummary: true })).toBe('review');
    expect(deriveSessionStage({ referenceClipId: 'clip-1', attemptCount: 2 })).toBe('review');
    // A new take started after a prior summary -> practice, not review.
    expect(deriveSessionStage({ referenceClipId: 'clip-1', hasLastSummary: true, takeActive: true })).toBe('practice');
  });
});
