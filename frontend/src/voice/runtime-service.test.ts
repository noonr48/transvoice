import { describe, expect, it, vi } from 'vitest';
import { createVoiceCoachRuntimeService } from './runtime-service';

function createMessage() {
  return {
    id: 'coach-1',
    role: 'coach' as const,
    channel: 'runtime' as const,
    kind: 'runtime-answer' as const,
    content: 'Take the ending lighter.',
    createdAt: 1,
  };
}

describe('voice runtime service', () => {
  it('stops listening before speaking the latest coach message', () => {
    const stopListeningTransport = vi.fn();
    const stopSpeechTransport = vi.fn();
    const playSpeechTransport = vi.fn(() => true);
    const service = createVoiceCoachRuntimeService({
      getCurrentMode: () => 'voice',
      canPlaySpeech: () => true,
      getSpeechProvider: () => 'browser',
      startListeningTransport: vi.fn(() => Promise.resolve()),
      stopListeningTransport,
      stopSpeechTransport,
      playSpeechTransport,
      addTerminalLine: vi.fn(),
      render: vi.fn(),
    });

    const played = service.speakCoachMessage(createMessage(), 0.92);

    expect(played).toBe(true);
    expect(stopListeningTransport).toHaveBeenCalledWith(false);
    expect(stopSpeechTransport).toHaveBeenCalledTimes(1);
    expect(playSpeechTransport).toHaveBeenCalledWith(createMessage(), {
      provider: 'browser',
      rate: 0.92,
    });
  });

  it('refuses to speak when voice mode is no longer active and resets transport state', () => {
    const stopListeningTransport = vi.fn();
    const stopSpeechTransport = vi.fn();
    const playSpeechTransport = vi.fn(() => true);
    const service = createVoiceCoachRuntimeService({
      getCurrentMode: () => 'general',
      canPlaySpeech: () => true,
      getSpeechProvider: () => 'browser',
      startListeningTransport: vi.fn(() => Promise.resolve()),
      stopListeningTransport,
      stopSpeechTransport,
      playSpeechTransport,
      addTerminalLine: vi.fn(),
      render: vi.fn(),
    });

    const played = service.speakCoachMessage(createMessage());

    expect(played).toBe(false);
    expect(stopSpeechTransport).toHaveBeenCalledTimes(1);
    expect(stopListeningTransport).toHaveBeenCalledWith(true);
    expect(playSpeechTransport).not.toHaveBeenCalled();
  });

  it('returns false silently and skips the reopen notice when the listening transport rejects', async () => {
    const addTerminalLine = vi.fn();
    const render = vi.fn();
    const service = createVoiceCoachRuntimeService({
      getCurrentMode: () => 'voice',
      canPlaySpeech: () => true,
      getSpeechProvider: () => 'browser',
      startListeningTransport: vi.fn(() => Promise.reject(new Error('mic offline'))),
      stopListeningTransport: vi.fn(),
      stopSpeechTransport: vi.fn(),
      playSpeechTransport: vi.fn(() => true),
      addTerminalLine,
      render,
    });

    const started = await service.reopenCoachListeningWithNotice('Coach back on mic.');

    expect(started).toBe(false);
    expect(addTerminalLine).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'explicit true', result: true },
    { label: 'legacy void', result: undefined },
  ])('treats $label listening starts as successful', async ({ result }) => {
    const service = createVoiceCoachRuntimeService({
      getCurrentMode: () => 'voice',
      canPlaySpeech: () => true,
      getSpeechProvider: () => 'browser',
      startListeningTransport: vi.fn(() => Promise.resolve(result)),
      stopListeningTransport: vi.fn(),
      stopSpeechTransport: vi.fn(),
      playSpeechTransport: vi.fn(() => true),
      addTerminalLine: vi.fn(),
      render: vi.fn(),
    });

    await expect(service.startCoachListening()).resolves.toBe(true);
  });

  it('returns false without reporting an error when the listening start is declined', async () => {
    const service = createVoiceCoachRuntimeService({
      getCurrentMode: () => 'voice',
      canPlaySpeech: () => true,
      getSpeechProvider: () => 'browser',
      startListeningTransport: vi.fn(() => Promise.resolve(false)),
      stopListeningTransport: vi.fn(),
      stopSpeechTransport: vi.fn(),
      playSpeechTransport: vi.fn(() => true),
      addTerminalLine: vi.fn(),
      render: vi.fn(),
    });

    await expect(service.startCoachListening()).resolves.toBe(false);
  });

  it('only renders the reopen notice after listening restarts successfully', async () => {
    const addTerminalLine = vi.fn();
    const render = vi.fn();
    const service = createVoiceCoachRuntimeService({
      getCurrentMode: () => 'voice',
      canPlaySpeech: () => true,
      getSpeechProvider: () => 'browser',
      startListeningTransport: vi.fn(() => Promise.resolve()),
      stopListeningTransport: vi.fn(),
      stopSpeechTransport: vi.fn(),
      playSpeechTransport: vi.fn(() => true),
      addTerminalLine,
      render,
    });

    const reopened = await service.reopenCoachListeningWithNotice('Coach back on mic.');

    expect(reopened).toBe(true);
    expect(addTerminalLine).toHaveBeenCalledWith('system', 'Coach back on mic.');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('skips the reopen notice without reporting an error when the listening start is declined', async () => {
    const addTerminalLine = vi.fn();
    const render = vi.fn();
    const service = createVoiceCoachRuntimeService({
      getCurrentMode: () => 'voice',
      canPlaySpeech: () => true,
      getSpeechProvider: () => 'browser',
      startListeningTransport: vi.fn(() => Promise.resolve(false)),
      stopListeningTransport: vi.fn(),
      stopSpeechTransport: vi.fn(),
      playSpeechTransport: vi.fn(() => true),
      addTerminalLine,
      render,
    });

    const reopened = await service.reopenCoachListeningWithNotice('Coach back on mic.');

    expect(reopened).toBe(false);
    expect(addTerminalLine).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});
