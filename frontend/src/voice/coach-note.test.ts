import { describe, expect, it, vi } from 'vitest';
import { createVoiceCoachNoteController } from './coach-note';

describe('voice coach note controller', () => {
  it('uses the deeptutor review path when a guide session is active', async () => {
    const applyVoiceBackendPayload = vi.fn();
    const controller = createVoiceCoachNoteController({
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      hasLastSummary: () => true,
      hasActiveGuideSession: () => true,
      requestDeepTutorCoach: () => Promise.resolve({ success: true } as any),
      startCoachTask: vi.fn(),
      getTaskStatus: vi.fn(),
      applyVoiceBackendPayload,
      syncVoiceSessionStateFromBackend: vi.fn(() => Promise.resolve()),
      updateLastCoachResult: vi.fn(),
      setTaskId: vi.fn(),
      setTaskStatus: vi.fn(),
      setTaskError: vi.fn(),
      setPendingChannel: vi.fn(),
      clearPendingState: vi.fn(),
      render: vi.fn(),
    });

    await controller.requestCoachNote();

    expect(applyVoiceBackendPayload).toHaveBeenCalledWith({ success: true });
  });

  it('updates the last coach result after a legacy task completes', async () => {
    const updateLastCoachResult = vi.fn();
    const syncVoiceSessionStateFromBackend = vi.fn(() => Promise.resolve());
    const setTaskId = vi.fn();
    const setTaskStatus = vi.fn();
    const setTaskError = vi.fn();
    const clearPendingState = vi.fn();
    const render = vi.fn();

    const controller = createVoiceCoachNoteController({
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      hasLastSummary: () => true,
      hasActiveGuideSession: () => false,
      requestDeepTutorCoach: vi.fn(),
      startCoachTask: () => Promise.resolve({ taskId: 'task-1' }),
      getTaskStatus: () => Promise.resolve({ status: 'done', result: 'Coach note ready' }),
      applyVoiceBackendPayload: vi.fn(),
      syncVoiceSessionStateFromBackend,
      updateLastCoachResult,
      setTaskId,
      setTaskStatus,
      setTaskError,
      setPendingChannel: vi.fn(),
      clearPendingState,
      render,
      now: () => 12345,
    });

    await controller.requestCoachNote();

    expect(setTaskId).toHaveBeenCalledWith('task-1');
    expect(setTaskId).toHaveBeenCalledWith(null);
    expect(setTaskStatus).toHaveBeenCalledWith('running');
    expect(setTaskStatus).toHaveBeenCalledWith('idle');
    expect(setTaskError).toHaveBeenLastCalledWith(null);
    expect(updateLastCoachResult).toHaveBeenCalledWith('Coach note ready', 12345);
    expect(syncVoiceSessionStateFromBackend).toHaveBeenCalledTimes(1);
    expect(clearPendingState).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalled();
  });

  it('schedules a poll for pending legacy tasks and resolves on the next pass', async () => {
    const scheduled: Array<() => void> = [];
    const getTaskStatus = vi.fn()
      .mockResolvedValueOnce({ status: 'running' })
      .mockResolvedValueOnce({ status: 'done', result: 'Later note' });
    const updateLastCoachResult = vi.fn();

    const controller = createVoiceCoachNoteController({
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      hasLastSummary: () => true,
      hasActiveGuideSession: () => false,
      requestDeepTutorCoach: vi.fn(),
      startCoachTask: () => Promise.resolve({ taskId: 'task-1' }),
      getTaskStatus,
      applyVoiceBackendPayload: vi.fn(),
      syncVoiceSessionStateFromBackend: vi.fn(() => Promise.resolve()),
      updateLastCoachResult,
      setTaskId: vi.fn(),
      setTaskStatus: vi.fn(),
      setTaskError: vi.fn(),
      setPendingChannel: vi.fn(),
      clearPendingState: vi.fn(),
      render: vi.fn(),
      setTimeoutImpl: ((callback: TimerHandler) => {
        scheduled.push(callback as () => void);
        return 1 as unknown as number;
      }) as typeof window.setTimeout,
      clearTimeoutImpl: vi.fn() as typeof window.clearTimeout,
      now: () => 55,
    });

    await controller.requestCoachNote();
    expect(scheduled).toHaveLength(1);

    scheduled[0]();
    await Promise.resolve();
    await Promise.resolve();

    expect(getTaskStatus).toHaveBeenCalledTimes(2);
    expect(updateLastCoachResult).toHaveBeenCalledWith('Later note', 55);
  });
});
