import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import {
  arrayBufferToBase64,
  createVoiceApi,
  parseJson,
  registerVoiceAttemptArtifact,
  requestJson,
  resolveAudioFormatFromMimeType,
} from './api';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('voice api helpers', () => {
  it('falls back to an empty object when optional success JSON is invalid', async () => {
    const response = new Response('not-json', { status: 200 });

    await expect(parseJson<Record<string, never>>(response, 'empty-object')).resolves.toEqual({});
  });

  it('prefers API error messages when available', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ error: 'Voice backend offline' }, { status: 503 }));

    await expect(requestJson('http://localhost/test')).rejects.toThrow('Voice backend offline');
  });

  it('uses FastAPI-style detail fields when present', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ detail: 'Unauthorized' }, { status: 401 }));

    await expect(requestJson('http://localhost/test')).rejects.toThrow('Unauthorized');
  });

  it('encodes practice takes even when no local timeline is available', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ success: true, summary: { voiceSessionId: 'voice-1' } }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });

    await api.submitPracticeTake('session-1', 'manual take end', null);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://kernel.test/voice/session/take',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'session-1',
          reason: 'manual take end',
          lastTakeTimeline: null,
        }),
      }),
    );
  });

  it('sends the complete custom target contract when starting a practice session', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ success: true }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });
    const targetVoiceProfile = {
      profileId: 'grounded-custom',
      targetPreset: 'masculine',
      pitchFloorHz: 100,
      pitchCeilingHz: 140,
      resonanceFloor: 0.1,
      resonanceCeiling: 0.3,
      weightFloor: 0.6,
      weightCeiling: 0.8,
    };

    await api.startPracticeSession('session-1', {
      targetPreset: 'masculine',
      referenceClipId: null,
      targetVoiceProfile,
      targetSource: 'custom-handmade',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://kernel.test/voice/session/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'session-1',
          targetPreset: 'masculine',
          referenceClipId: null,
          targetVoiceProfile,
          targetSource: 'custom-handmade',
        }),
      }),
    );
  });

  it('serializes registered practice attempt context and self-report fields', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ success: true, summary: { voiceSessionId: 'voice-1' } }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });
    registerVoiceAttemptArtifact('session-1', 'manual take end', {
      clientAttemptId: 'attempt-1',
      repContext: {
        targetPreset: 'cute-feminine',
        targetSource: 'custom-reference',
        lessonId: 'lesson-1',
        activeLine: null,
        referenceClipId: 'clip-1',
        referenceClipName: 'target.wav',
        forecastPhrase: 'hello there',
        targetProfileId: 'profile-1',
        targetProfileSource: 'target.wav',
      },
      selfReport: {
        effort: 3,
        strain: 2,
        perceivedDifficulty: 4,
        confidence: 5,
        metadata: { source: 'voice-tab-self-report' },
      },
    });

    await api.submitPracticeTake('session-1', 'manual take end', null);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://kernel.test/voice/session/take',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'session-1',
          reason: 'manual take end',
          lastTakeTimeline: null,
          clientAttemptId: 'attempt-1',
          repContext: {
            targetPreset: 'cute-feminine',
            targetSource: 'custom-reference',
            lessonId: 'lesson-1',
            activeLine: null,
            referenceClipId: 'clip-1',
            referenceClipName: 'target.wav',
            forecastPhrase: 'hello there',
            targetProfileId: 'profile-1',
            targetProfileSource: 'target.wav',
          },
          selfReport: {
            effort: 3,
            strain: 2,
            perceivedDifficulty: 4,
            confidence: 5,
            metadata: { source: 'voice-tab-self-report' },
          },
        }),
      }),
    );
  });

  it('loads persisted reference analysis by clip id', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ clipId: 'clip-1', filename: 'saved.wav' }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });

    await expect(api.getReferenceAnalysis('clip-1')).resolves.toMatchObject({
      clipId: 'clip-1',
      filename: 'saved.wav',
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://trainer.test/api/v1/voice/reference/clip-1',
      undefined,
    );
  });

  it('lists saved custom voice targets from the kernel route', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ presets: [{ id: 'preset-1', name: 'Saved Voice' }] }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });

    await expect(api.listTargetPresets()).resolves.toMatchObject({
      presets: [{ id: 'preset-1', name: 'Saved Voice' }],
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://kernel.test/voice/presets',
      undefined,
    );
  });

  it('can request archived custom voice targets from the kernel route', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ presets: [{ id: 'preset-1', name: 'Saved Voice', archived: true }] }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });

    await api.listTargetPresets({ includeArchived: true });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://kernel.test/voice/presets?includeArchived=1',
      undefined,
    );
  });

  it('saves reference presets without requiring an active session', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ success: true }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });

    await api.saveReferencePreset(null, {
      name: 'Saved Reference',
      basePreset: 'cute-feminine',
      referenceClipId: 'clip-1',
      referenceClipName: 'reference.wav',
      expectedUpdatedAt: 2,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'http://kernel.test/voice/presets/reference/save',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sessionId: null,
          presetId: null,
          name: 'Saved Reference',
          basePreset: 'cute-feminine',
          referenceClipId: 'clip-1',
          referenceClipName: 'reference.wav',
          referenceAnalysis: null,
          targetVoiceProfile: null,
          expectedUpdatedAt: 2,
        }),
      }),
    );
  });

  it('saves handmade custom voice targets through the new kernel route', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ success: true }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });

    await api.saveHandmadePreset('session-1', {
      name: 'Handmade Voice',
      basePreset: 'bright-playful',
      pitchFloorHz: '170',
      pitchCeilingHz: '240',
      resonanceFloor: '0.55',
      resonanceCeiling: '0.82',
      weightFloor: '0.18',
      weightCeiling: '0.42',
      stylePrompt: 'sweet',
      notesText: 'easy',
    });

    expect(global.fetch).toHaveBeenLastCalledWith(
      'http://kernel.test/voice/presets/handmade/save',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'session-1',
          name: 'Handmade Voice',
          basePreset: 'bright-playful',
          pitchFloorHz: '170',
          pitchCeilingHz: '240',
          resonanceFloor: '0.55',
          resonanceCeiling: '0.82',
          weightFloor: '0.18',
          weightCeiling: '0.42',
          stylePrompt: 'sweet',
          notesText: 'easy',
        }),
      }),
    );
  });

  it('proxies duplicate, archive, restore, and delete preset actions through kernel routes', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });

    await api.duplicateTargetPreset(null, 'preset-1', { name: 'Copy', expectedUpdatedAt: 2 });
    await api.archiveTargetPreset(null, 'preset-1', 2);
    await api.restoreTargetPreset(null, 'preset-1', 3);
    await api.deleteTargetPreset(null, 'preset-1', 4);

    const recentCalls = vi.mocked(global.fetch).mock.calls.slice(-4);
    expect(recentCalls).toEqual([
      [
        'http://kernel.test/voice/presets/duplicate',
        expect.objectContaining({
          body: JSON.stringify({ sessionId: null, presetId: 'preset-1', name: 'Copy', expectedUpdatedAt: 2 }),
        }),
      ],
      [
        'http://kernel.test/voice/presets/archive',
        expect.objectContaining({
          body: JSON.stringify({ sessionId: null, presetId: 'preset-1', expectedUpdatedAt: 2 }),
        }),
      ],
      [
        'http://kernel.test/voice/presets/restore',
        expect.objectContaining({
          body: JSON.stringify({ sessionId: null, presetId: 'preset-1', expectedUpdatedAt: 3 }),
        }),
      ],
      [
        'http://kernel.test/voice/presets/delete',
        expect.objectContaining({
          body: JSON.stringify({ sessionId: null, presetId: 'preset-1', expectedUpdatedAt: 4 }),
        }),
      ],
    ]);
  });

  it('builds a stable persisted reference audio url', () => {
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });

    expect(api.getReferenceAudioUrl('clip value/1')).toBe(
      'http://trainer.test/api/v1/voice/reference/clip%20value%2F1/audio',
    );
  });

  it('sends realtime coach questions to the explicit runtime route', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ success: true }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });

    await api.submitRuntimeCoachQuestion(
      'session-1',
      'what should I listen for?',
      undefined,
      undefined,
      'listening-turn-10',
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'http://kernel.test/voice/coach/runtime',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'session-1',
          message: 'what should I listen for?',
          listeningTurnId: 'listening-turn-10',
        }),
      }),
    );
  });

  it('reads and updates learner context through the standalone voice routes', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        studentId: 'voice/student 1',
        learnerContext: { source: 'local-learner-context' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        manifest: { exportEligible: true },
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        learnerContext: { consentStatus: 'granted', exportEligible: true },
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        learnerContext: { profile: { displayName: 'Ben' } },
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        learnerContext: { coachPreferences: [] },
        resetReceipt: { operation: 'reset-personalization' },
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        learnerContext: { notepadHandoff: { content: 'Keep it easy.' } },
      }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });

    await expect(api.getLearnerContextProfile('voice/student 1', 'bright vowels')).resolves.toMatchObject({
      learnerContext: { source: 'local-learner-context' },
    });
    await expect(api.getLearnerContextExportManifest('voice/student 1')).resolves.toMatchObject({
      manifest: { exportEligible: true },
    });
    await api.updateLearnerContextDatasetControls('voice/student 1', {
      consent: { status: 'granted' },
      eligibility: { status: 'eligible' },
      exclusions: [],
      query: 'bright vowels',
    });
    await api.updateLearnerContextProfile('voice/student 1', {
      displayName: 'Ben',
      pronouns: 'they/them',
      direction: 'neutral',
      goal: 'A voice that feels like mine',
    });
    await expect(api.forgetLearnerContext('voice/student 1', {
      operation: 'reset-personalization',
    })).resolves.toMatchObject({
      resetReceipt: { operation: 'reset-personalization' },
    });
    await api.updateLearnerContextNotepadHandoff('voice/student 1', {
      content: 'Keep it easy.',
      items: ['easy onset'],
      sessionId: 'session-1',
      source: 'test',
    });

    const recentCalls = vi.mocked(global.fetch).mock.calls.slice(-6);
    expect(recentCalls).toEqual([
      [
        'http://kernel.test/voice/learner-context/profile?studentId=voice%2Fstudent+1&query=bright+vowels',
        undefined,
      ],
      [
        'http://kernel.test/voice/learner-context/export-manifest?studentId=voice%2Fstudent+1',
        undefined,
      ],
      [
        'http://kernel.test/voice/learner-context/dataset-controls',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            studentId: 'voice/student 1',
            consent: { status: 'granted' },
            eligibility: { status: 'eligible' },
            exclusions: [],
            query: 'bright vowels',
          }),
        }),
      ],
      [
        'http://kernel.test/voice/learner-context/profile',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            studentId: 'voice/student 1',
            displayName: 'Ben',
            pronouns: 'they/them',
            direction: 'neutral',
            goal: 'A voice that feels like mine',
          }),
        }),
      ],
      [
        'http://kernel.test/voice/learner-context/forget',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            studentId: 'voice/student 1',
            operation: 'reset-personalization',
          }),
        }),
      ],
      [
        'http://kernel.test/voice/learner-context/notepad-handoff',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            studentId: 'voice/student 1',
            content: 'Keep it easy.',
            items: ['easy onset'],
            sessionId: 'session-1',
            source: 'test',
          }),
        }),
      ],
    ]);
  });

  it('requests a rebuilt DeepTutor voice lesson when the guide plan is stale', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ success: true }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: null,
    });

    await api.startDeepTutorVoiceLesson('session-1', true);

    expect(global.fetch).toHaveBeenCalledWith(
      'http://kernel.test/deeptutor/voice/session/start',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          sessionId: 'session-1',
          rebuildPlan: true,
        }),
      }),
    );
  });

  it('chunks array buffers safely when converting to base64', () => {
    const input = new Uint8Array(0x9000).map((_, index) => index % 251).buffer;

    expect(arrayBufferToBase64(input)).toBe(Buffer.from(new Uint8Array(input)).toString('base64'));
  });

  it('adds bearer auth headers when calling VoiceTrainer with an auth token', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ clipId: 'clip-1' }));
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: 'secret-token',
    });

    await api.getReferenceAnalysis('clip-1');

    const init = vi.mocked(global.fetch).mock.calls.at(-1)?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer secret-token');
  });

  it('appends websocket-friendly token query params to reference audio URLs when configured', () => {
    const api = createVoiceApi({
      kernelUrl: 'http://kernel.test',
      voiceTrainerUrl: 'http://trainer.test',
      voiceTrainerToken: 'token value/1',
    });

    expect(api.getReferenceAudioUrl('clip-1')).toBe(
      'http://trainer.test/api/v1/voice/reference/clip-1/audio?token=token+value%2F1',
    );
  });

  it('maps supported mime types to the expected audio formats', () => {
    expect(resolveAudioFormatFromMimeType('audio/webm;codecs=opus')).toBe('webm');
    expect(resolveAudioFormatFromMimeType('audio/ogg')).toBe('ogg');
    expect(resolveAudioFormatFromMimeType('audio/mp4')).toBe('m4a');
    expect(resolveAudioFormatFromMimeType('audio/wav')).toBe('wav');
  });
});
