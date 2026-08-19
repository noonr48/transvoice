import { describe, expect, it, vi } from 'vitest';
import { createVoiceSessionModeRuntime } from './session-mode-runtime';
import { createDefaultVoiceUiState } from './state';

describe('voice session mode runtime', () => {
  it('applies started-session reentry plans through the extracted voice boundary', () => {
    const applySessionReentryPlan = vi.fn();
    const runtime = createVoiceSessionModeRuntime({
      getVoiceUiState: () => createDefaultVoiceUiState({ targetPreset: 'bright-guide' }),
      applySessionReentryPlan,
      render: vi.fn(),
    });

    runtime.applyStartedSession('voice', {
      voiceState: {
        voiceSessionId: 'voice-session-1',
        referenceClipId: 'ref-1',
      },
    });

    expect(applySessionReentryPlan).toHaveBeenCalledWith(expect.objectContaining({
      persistedReferenceClipId: 'ref-1',
      runtimeReset: expect.objectContaining({
        stopListening: true,
        resetLessonStatus: true,
      }),
      nextVoiceUiState: expect.objectContaining({
        voiceSessionId: 'voice-session-1',
      }),
    }));
  });

  it('applies restored-session plans and carries saved take traces', () => {
    const applySessionReentryPlan = vi.fn();
    const runtime = createVoiceSessionModeRuntime({
      getVoiceUiState: () => createDefaultVoiceUiState({ targetPreset: 'steady' }),
      applySessionReentryPlan,
      render: vi.fn(),
    });

    runtime.applyRestoredSession('voice', {
      voiceState: {
        voiceSessionId: 'voice-session-2',
        lastTakeTimeline: [{ t: 0, pitchHz: 220 }],
      },
    });

    const plan = applySessionReentryPlan.mock.calls[0]?.[0];
    expect(plan).toEqual(expect.objectContaining({
      nextVoiceUiState: expect.objectContaining({
        voiceSessionId: 'voice-session-2',
      }),
    }));
    expect(plan.nextLastTakeTrace).toHaveLength(1);
    expect(plan.nextLastTakeTrace[0]).toEqual(expect.objectContaining({
      t: 0,
      pitchHz: 220,
    }));
  });

  it('applies direct fallback resets only for voice sessions and re-renders immediately', () => {
    const applySessionReentryPlan = vi.fn();
    const render = vi.fn();
    const runtime = createVoiceSessionModeRuntime({
      getVoiceUiState: () => createDefaultVoiceUiState({ targetPreset: 'teacher' }),
      applySessionReentryPlan,
      render,
    });

    expect(runtime.applyDirectFallbackSession('voice')).toBe(true);
    expect(applySessionReentryPlan).toHaveBeenCalledWith(expect.objectContaining({
      nextVoiceUiState: expect.objectContaining({
        targetPreset: 'teacher',
      }),
      runtimeReset: {
        resetForecastState: true,
        resetDrillState: true,
      },
    }));
    expect(render).toHaveBeenCalledTimes(1);

    applySessionReentryPlan.mockClear();
    render.mockClear();

    expect(runtime.applyDirectFallbackSession('general')).toBe(false);
    expect(applySessionReentryPlan).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});
