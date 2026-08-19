import { describe, expect, it } from 'vitest';
import {
  createVoiceBackendErrorPayload,
  createVoiceBackendPayload,
  getVoiceBackendPayloadSlices,
  hasVoiceBackendPayload,
} from './state';

describe('voice backend payload contract', () => {
  it('recognizes payloads from any of the shared slices', () => {
    expect(hasVoiceBackendPayload({
      voiceState: {
        voiceSessionId: 'voice-1',
      },
    })).toBe(true);
    expect(hasVoiceBackendPayload({
      studentModel: {
        studentId: 'student-1',
      },
    })).toBe(true);
    expect(hasVoiceBackendPayload({
      learnerContext: {
        source: 'local-learner-context',
      },
    })).toBe(true);
    expect(hasVoiceBackendPayload({
      deeptutorVoiceState: {
        guideSessionId: 'guide-1',
      },
    })).toBe(true);
    expect(hasVoiceBackendPayload({
      success: true,
    })).toBe(false);
  });

  it('elevates nested DeepTutor state when extracting payload slices', () => {
    const slices = getVoiceBackendPayloadSlices({
      voiceState: {
        referenceClipId: 'ref-1',
        deeptutorVoiceState: {
          guideSessionId: 'guide-nested',
        },
      },
    });

    expect(slices.voiceState).toMatchObject({
      referenceClipId: 'ref-1',
    });
    expect(slices.deeptutorVoiceState).toMatchObject({
      guideSessionId: 'guide-nested',
    });
    expect(slices.studentModel).toBeNull();
  });

  it('elevates nested learner context when extracting payload slices', () => {
    const slices = getVoiceBackendPayloadSlices(createVoiceBackendPayload({
      studentModel: {
        studentId: 'student-1',
        learnerContext: {
          source: 'local-learner-context',
          exportEligible: false,
        },
      },
    }));

    expect(slices.studentModel).toMatchObject({
      studentId: 'student-1',
    });
    expect(slices.learnerContext).toMatchObject({
      source: 'local-learner-context',
      exportEligible: false,
    });
  });

  it('builds payload envelopes without leaking empty slice placeholders', () => {
    const payload = createVoiceBackendPayload({
      voiceState: {
        voiceSessionId: 'voice-1',
      },
      studentModel: null,
    }, {
      success: true,
      route: 'voice-runtime',
    });

    expect(payload).toEqual({
      success: true,
      route: 'voice-runtime',
      voiceState: {
        voiceSessionId: 'voice-1',
      },
    });
  });

  it('builds error payload envelopes on the same shared contract', () => {
    const payload = createVoiceBackendErrorPayload({
      deeptutorVoiceState: {
        guideSessionId: 'guide-1',
      },
    }, 'DeepTutor still owns the lesson.', {
      interactionState: {
        lessonMode: 'active',
      },
    });

    expect(payload).toEqual({
      error: 'DeepTutor still owns the lesson.',
      interactionState: {
        lessonMode: 'active',
      },
      deeptutorVoiceState: {
        guideSessionId: 'guide-1',
      },
    });
  });
});
