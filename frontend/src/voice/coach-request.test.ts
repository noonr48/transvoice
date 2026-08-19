import { describe, expect, it, vi } from 'vitest';
import { createVoiceCoachRequestController } from './coach-request';

describe('voice coach request controller', () => {
  it('runs a successful request with pending state, payload apply, input clear, and replay hooks', async () => {
    const setQuestionStatus = vi.fn();
    const setQuestionError = vi.fn();
    const setPendingChannel = vi.fn();
    const clearPendingState = vi.fn();
    const applyVoiceBackendPayload = vi.fn();
    const render = vi.fn();
    const clearQuestionInput = vi.fn();
    const setLastSpokenCoachMessageId = vi.fn();

    const controller = createVoiceCoachRequestController({
      setQuestionStatus,
      setQuestionError,
      setPendingChannel,
      clearPendingState,
      applyVoiceBackendPayload,
      render,
      clearQuestionInput,
      setLastSpokenCoachMessageId,
    });

    const payload = { success: true } as any;
    const result = await controller.submitRequest({
      pendingChannel: 'deeptutor',
      request: () => Promise.resolve(payload),
      clearInputOnSuccess: true,
      repeatLatestCoachOnSuccess: true,
    });

    expect(result).toBe(payload);
    expect(setQuestionStatus).toHaveBeenNthCalledWith(1, 'sending');
    expect(setQuestionStatus).toHaveBeenNthCalledWith(2, 'idle');
    expect(setQuestionError).toHaveBeenNthCalledWith(1, null);
    expect(setQuestionError).toHaveBeenNthCalledWith(2, null);
    expect(setPendingChannel).toHaveBeenCalledWith('deeptutor');
    expect(applyVoiceBackendPayload).toHaveBeenCalledWith(payload);
    expect(clearPendingState).toHaveBeenCalledTimes(1);
    expect(clearQuestionInput).toHaveBeenCalledTimes(1);
    expect(setLastSpokenCoachMessageId).toHaveBeenCalledWith(null);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('preserves error state and clears pending state when a request fails', async () => {
    const setQuestionStatus = vi.fn();
    const setQuestionError = vi.fn();
    const clearPendingState = vi.fn();
    const render = vi.fn();

    const controller = createVoiceCoachRequestController({
      setQuestionStatus,
      setQuestionError,
      setPendingChannel: vi.fn(),
      clearPendingState,
      applyVoiceBackendPayload: vi.fn(),
      render,
    });

    const error = new Error('request failed');
    await expect(controller.submitRequest({
      pendingChannel: 'shortcut',
      request: () => Promise.reject(error),
    })).rejects.toThrow('request failed');

    expect(setQuestionStatus).toHaveBeenNthCalledWith(1, 'sending');
    expect(setQuestionStatus).toHaveBeenNthCalledWith(2, 'error');
    expect(setQuestionError).toHaveBeenNthCalledWith(1, null);
    expect(setQuestionError).toHaveBeenNthCalledWith(2, 'request failed');
    expect(clearPendingState).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(2);
  });
});
