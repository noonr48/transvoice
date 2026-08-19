import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyVoiceInputRuntimeEvent,
  createVoiceInputRuntimeController,
  type VoiceInputRuntimeLifecycleContext,
} from './input-runtime-controller';
import {
  createDefaultVoiceUiState,
  normalizeVoiceUiState,
  type VoiceAdvancedPanelState,
  type VoiceCoachVoiceState,
  type VoiceInputRuntimeState,
} from './state';
import type { VoiceInputRecoveryState } from './runtime-status';

function createRecoveryState(
  patch: Partial<VoiceInputRecoveryState> = {},
): VoiceInputRecoveryState {
  return {
    level: 'ok',
    statusLabel: null,
    coachCopy: null,
    activeDrillCopy: null,
    providerHint: null,
    runtimePill: null,
    suggestedInputProvider: null,
    shouldDisableContinuous: false,
    disableReason: null,
    ...patch,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createLifecycle(sessionId: string | null) {
  let current = true;
  const context: VoiceInputRuntimeLifecycleContext = {
    sessionId,
    isCurrent: () => current,
  };
  return {
    context,
    invalidate: () => {
      current = false;
    },
  };
}

function createHarness(options: {
  voiceUiState?: ReturnType<typeof createDefaultVoiceUiState>;
  currentSessionId?: string | null;
  isConnected?: boolean;
  requestedInputProvider?: 'browser' | 'backend';
  effectiveInputProvider?: 'browser' | 'backend' | null;
  recoveryState?: VoiceInputRecoveryState;
  recoveryPlan?: {
    shouldApply: boolean;
    disableReason: string | null;
  };
} = {}) {
  let voiceUiState = options.voiceUiState || createDefaultVoiceUiState();
  const sideEffects: string[] = [];

  const applyInputProviderStatusPayload = vi.fn();
  const applyVoiceBackendPayload = vi.fn((payload: {
    voiceState?: Partial<ReturnType<typeof createDefaultVoiceUiState>> | null;
  }) => {
    if (payload.voiceState) {
      voiceUiState = normalizeVoiceUiState({
        ...voiceUiState,
        ...payload.voiceState,
      });
    }
  });
  const render = vi.fn(() => {
    sideEffects.push('render');
  });
  const setRecoverySafetyPending = vi.fn((pending: boolean) => {
    sideEffects.push(`pending:${pending}`);
  });
  const updateVoiceCockpitState = vi.fn(async (patch: {
    coachVoice?: Partial<VoiceCoachVoiceState>;
    voiceInputRuntime?: Partial<VoiceInputRuntimeState>;
    advancedPanel?: Partial<VoiceAdvancedPanelState>;
  }) => {
    voiceUiState = normalizeVoiceUiState({
      ...voiceUiState,
      coachVoice: patch.coachVoice
        ? {
            ...(voiceUiState.coachVoice || {}),
            ...patch.coachVoice,
          }
        : voiceUiState.coachVoice,
      voiceInputRuntime: patch.voiceInputRuntime
        ? {
            ...voiceUiState.voiceInputRuntime,
            ...patch.voiceInputRuntime,
          }
        : voiceUiState.voiceInputRuntime,
      advancedPanel: patch.advancedPanel
        ? {
            ...voiceUiState.advancedPanel,
            ...patch.advancedPanel,
          }
        : voiceUiState.advancedPanel,
    });
  });
  const addTerminalLine = vi.fn();
  const submitInputRuntimeEvent = vi.fn(async () => ({}));
  const getInputRecoveryState = vi.fn(() => options.recoveryState || createRecoveryState());
  const planRecoverySafety = vi.fn(() => options.recoveryPlan || {
    shouldApply: false,
    disableReason: null,
  });

  const controller = createVoiceInputRuntimeController({
    getVoiceUiState: () => voiceUiState,
    updateVoiceUiState: (updater) => {
      sideEffects.push('local');
      voiceUiState = normalizeVoiceUiState(updater(voiceUiState));
    },
    getSessionContext: () => ({
      currentSessionId: options.currentSessionId === undefined ? 'session-1' : options.currentSessionId,
      isConnected: options.isConnected ?? true,
    }),
    getRequestedInputProvider: () => options.requestedInputProvider ?? 'backend',
    getEffectiveInputProvider: () => options.effectiveInputProvider === undefined ? 'browser' : options.effectiveInputProvider,
    getInputRecoveryState,
    planRecoverySafety,
    setRecoverySafetyPending,
    submitInputRuntimeEvent,
    applyInputProviderStatusPayload,
    applyVoiceBackendPayload,
    updateVoiceCockpitState,
    addTerminalLine,
    render,
  });

  return {
    controller,
    getVoiceUiState: () => voiceUiState,
    applyInputProviderStatusPayload,
    applyVoiceBackendPayload,
    render,
    setRecoverySafetyPending,
    updateVoiceCockpitState,
    addTerminalLine,
    submitInputRuntimeEvent,
    getInputRecoveryState,
    planRecoverySafety,
    sideEffects,
  };
}

describe('voice input runtime controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies completed events and derives round-trip counters from the prior runtime state', () => {
    const runtime = createDefaultVoiceUiState({
      voiceInputRuntime: {
        requestedProvider: 'backend',
        captureProvider: 'backend',
        effectiveProvider: null,
        lastCaptureStartedAt: 100,
        lastCapturedAt: 220,
      },
    }).voiceInputRuntime;

    expect(applyVoiceInputRuntimeEvent(runtime, 'completed', {
      transcript: 'Coach question',
      processedAt: 360,
    }, 400)).toMatchObject({
      status: 'idle',
      lastOutcome: 'completed',
      requestedProvider: 'backend',
      captureProvider: 'backend',
      effectiveProvider: 'backend',
      lastTranscript: 'Coach question',
      successfulTurns: 1,
      consecutiveNoSpeechTurns: 0,
      consecutiveErrorTurns: 0,
      lastRoundTripMs: 140,
      lastProcessedAt: 360,
      lastEventAt: 400,
    });
  });

  it('clears transcript evidence after a no-speech event and increments no-speech recovery counters', () => {
    const runtime = createDefaultVoiceUiState({
      voiceInputRuntime: {
        requestedProvider: 'browser',
        effectiveProvider: 'browser',
        lastTranscript: 'partial text',
        lastTranscriptConfidence: 0.91,
        lastCaptureStartedAt: 100,
        consecutiveNoSpeechTurns: 1,
      },
    }).voiceInputRuntime;

    expect(applyVoiceInputRuntimeEvent(runtime, 'no-speech', {}, 350)).toMatchObject({
      status: 'idle',
      lastOutcome: 'no-speech',
      lastTranscript: null,
      lastTranscriptConfidence: null,
      noSpeechTurns: 1,
      consecutiveNoSpeechTurns: 2,
      consecutiveErrorTurns: 0,
      lastCaptureDurationMs: 250,
      lastEventAt: 350,
    });
  });

  it('syncs runtime events through the shared backend request contract and updates local state first', async () => {
    const harness = createHarness();
    const response = createDeferred<Record<string, never>>();
    harness.submitInputRuntimeEvent.mockImplementationOnce(() => response.promise);

    const syncPromise = harness.controller.syncEvent('completed', {
      transcript: 'How should I phrase the ending?',
      processedAt: 250,
      render: false,
    });

    expect(harness.getVoiceUiState().voiceInputRuntime).toMatchObject({
      status: 'idle',
      lastOutcome: 'completed',
      lastTranscript: 'How should I phrase the ending?',
      successfulTurns: 1,
    });
    expect(harness.submitInputRuntimeEvent).toHaveBeenCalledWith(
      'session-1',
      'completed',
      expect.objectContaining({
        requestedProvider: 'backend',
        effectiveProvider: 'browser',
        transcript: 'How should I phrase the ending?',
        processedAt: 250,
      }),
    );
    expect(harness.applyVoiceBackendPayload).not.toHaveBeenCalled();

    response.resolve({});
    await syncPromise;

    expect(harness.applyInputProviderStatusPayload).toHaveBeenCalledTimes(1);
    expect(harness.applyVoiceBackendPayload).toHaveBeenCalledTimes(1);
    expect(harness.render).not.toHaveBeenCalled();
  });

  it('starts no-lifecycle terminal recovery immediately while the backend response is pending', async () => {
    const harness = createHarness({
      voiceUiState: createDefaultVoiceUiState({
        coachVoice: {
          speechEnabled: true,
          continuousEnabled: true,
          speechProvider: 'browser',
          inputProvider: 'browser',
        },
      }),
      recoveryState: createRecoveryState({
        level: 'critical',
        shouldDisableContinuous: true,
      }),
      recoveryPlan: {
        shouldApply: true,
        disableReason: 'Legacy recovery started immediately.',
      },
    });
    const response = createDeferred<Record<string, never>>();
    harness.submitInputRuntimeEvent.mockImplementationOnce(() => response.promise);

    const syncPromise = harness.controller.syncEvent('completed', {
      transcript: 'legacy take',
      render: false,
    });
    const runtimeBeforeResponse = harness.getVoiceUiState().voiceInputRuntime;
    const recoveryCallsBeforeResponse = harness.updateVoiceCockpitState.mock.calls.length;
    const pendingCallsBeforeResponse = [...harness.setRecoverySafetyPending.mock.calls];
    const sideEffectsBeforeResponse = [...harness.sideEffects];

    response.resolve({});
    await syncPromise;

    expect(runtimeBeforeResponse).toMatchObject({
      lastOutcome: 'completed',
      lastTranscript: 'legacy take',
    });
    expect(recoveryCallsBeforeResponse).toBe(1);
    expect(pendingCallsBeforeResponse).toEqual([[true]]);
    expect(sideEffectsBeforeResponse.slice(0, 2)).toEqual(['local', 'pending:true']);
    expect(harness.updateVoiceCockpitState).toHaveBeenCalledTimes(1);
    expect(harness.setRecoverySafetyPending.mock.calls).toEqual([[true], [false]]);
    expect(harness.applyVoiceBackendPayload).toHaveBeenCalledTimes(1);
    expect(harness.render).toHaveBeenCalledTimes(1);
  });

  it('uses the captured lifecycle session and suppresses a response after session ownership changes', async () => {
    const harness = createHarness({ currentSessionId: 'live-session-b' });
    const response = createDeferred<{ source: string }>();
    harness.submitInputRuntimeEvent.mockImplementationOnce(() => response.promise);
    let connected = true;
    let ownedSession = 'captured-session-a';
    const lifecycle: VoiceInputRuntimeLifecycleContext = {
      sessionId: 'captured-session-a',
      isCurrent: () => connected && ownedSession === 'captured-session-a',
    };

    const syncPromise = harness.controller.syncEvent('processing', {
      transcript: 'take a',
    }, lifecycle);

    expect(harness.submitInputRuntimeEvent).toHaveBeenCalledWith(
      'captured-session-a',
      'processing',
      expect.any(Object),
    );
    expect(harness.getVoiceUiState().voiceInputRuntime).toMatchObject({
      status: 'processing',
      lastTranscript: 'take a',
    });
    const renderCountBeforeResponse = harness.render.mock.calls.length;

    connected = false;
    ownedSession = 'live-session-b';
    response.resolve({ source: 'stale-a' });
    await syncPromise;

    expect(harness.applyInputProviderStatusPayload).not.toHaveBeenCalled();
    expect(harness.applyVoiceBackendPayload).not.toHaveBeenCalled();
    expect(harness.render).toHaveBeenCalledTimes(renderCountBeforeResponse);
  });

  it('does not fall back to the live session when a current lifecycle captures null', async () => {
    const harness = createHarness({ currentSessionId: 'live-session' });
    const lifecycle = createLifecycle(null);

    await harness.controller.syncEvent('waiting', { render: false }, lifecycle.context);

    expect(harness.getVoiceUiState().voiceInputRuntime.status).toBe('waiting');
    expect(harness.submitInputRuntimeEvent).not.toHaveBeenCalled();
    expect(harness.render).not.toHaveBeenCalled();
  });

  it('publishes no warning or late side effect when a deferred request rejects after invalidation', async () => {
    const harness = createHarness();
    const response = createDeferred<Record<string, never>>();
    const lifecycle = createLifecycle('session-1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness.submitInputRuntimeEvent.mockImplementationOnce(() => response.promise);

    const syncPromise = harness.controller.syncEvent('listening', { render: false }, lifecycle.context);
    const pendingCallsBeforeRejection = harness.setRecoverySafetyPending.mock.calls.length;
    lifecycle.invalidate();
    response.reject(new Error('stale request'));
    await syncPromise;

    expect(warn).not.toHaveBeenCalled();
    expect(harness.applyInputProviderStatusPayload).not.toHaveBeenCalled();
    expect(harness.applyVoiceBackendPayload).not.toHaveBeenCalled();
    expect(harness.setRecoverySafetyPending).toHaveBeenCalledTimes(pendingCallsBeforeRejection);
    expect(harness.render).not.toHaveBeenCalled();
  });

  it('keeps the newer same-generation event when deferred responses settle in reverse order', async () => {
    const harness = createHarness();
    const olderResponse = createDeferred<{ source: string }>();
    const newerResponse = createDeferred<{ source: string }>();
    const olderLifecycle = createLifecycle('session-1');
    const newerLifecycle = createLifecycle('session-1');
    harness.submitInputRuntimeEvent
      .mockImplementationOnce(() => olderResponse.promise)
      .mockImplementationOnce(() => newerResponse.promise);

    const olderSync = harness.controller.syncEvent('processing', {
      transcript: 'take a',
      render: false,
    }, olderLifecycle.context);
    olderLifecycle.invalidate();
    const newerSync = harness.controller.syncEvent('listening', {
      transcript: 'take b',
      render: false,
    }, newerLifecycle.context);

    newerResponse.resolve({ source: 'newer-b' });
    await newerSync;
    olderResponse.resolve({ source: 'older-a' });
    await olderSync;

    expect(harness.getVoiceUiState().voiceInputRuntime).toMatchObject({
      status: 'listening',
      lastTranscript: 'take b',
    });
    expect(harness.applyInputProviderStatusPayload).toHaveBeenCalledTimes(1);
    expect(harness.applyInputProviderStatusPayload).toHaveBeenCalledWith({ source: 'newer-b' });
    expect(harness.applyVoiceBackendPayload).toHaveBeenCalledTimes(1);
    expect(harness.applyVoiceBackendPayload).toHaveBeenCalledWith({ source: 'newer-b' });
  });

  it('does nothing when lifecycle ownership is false before dispatch', async () => {
    const harness = createHarness();
    const lifecycle: VoiceInputRuntimeLifecycleContext = {
      sessionId: 'session-1',
      isCurrent: () => false,
    };

    await harness.controller.syncEvent('processing', {
      transcript: 'must not publish',
    }, lifecycle);

    expect(harness.getVoiceUiState().voiceInputRuntime).toMatchObject({
      status: 'idle',
      lastTranscript: null,
      lastEventAt: null,
    });
    expect(harness.submitInputRuntimeEvent).not.toHaveBeenCalled();
    expect(harness.setRecoverySafetyPending).not.toHaveBeenCalled();
    expect(harness.render).not.toHaveBeenCalled();
  });

  it('runs terminal recovery after a current backend rejection', async () => {
    const harness = createHarness({
      voiceUiState: createDefaultVoiceUiState({
        coachVoice: {
          speechEnabled: true,
          continuousEnabled: true,
          speechProvider: 'browser',
          inputProvider: 'browser',
        },
      }),
      recoveryState: createRecoveryState({
        level: 'critical',
        shouldDisableContinuous: true,
      }),
      recoveryPlan: {
        shouldApply: true,
        disableReason: 'Hands-free paused safely.',
      },
    });
    const lifecycle = createLifecycle('session-1');
    const response = createDeferred<Record<string, never>>();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness.submitInputRuntimeEvent.mockImplementationOnce(() => response.promise);

    const syncPromise = harness.controller.syncEvent('error', {
      error: 'capture failed',
      render: false,
    }, lifecycle.context);
    expect(harness.updateVoiceCockpitState).not.toHaveBeenCalled();

    response.reject(new Error('backend unavailable'));
    await syncPromise;

    expect(warn).toHaveBeenCalledWith(
      '[Voice] Failed to sync input runtime event',
      expect.any(Error),
    );
    expect(harness.updateVoiceCockpitState).toHaveBeenCalledTimes(1);
    expect(harness.addTerminalLine).toHaveBeenCalledWith('system', 'Hands-free paused safely.');
    expect(harness.setRecoverySafetyPending.mock.calls).toEqual([
      [false],
      [true],
      [false],
    ]);
    expect(harness.render).toHaveBeenCalledTimes(1);
  });

  it('clears prior recovery pending before a later lifecycle event and blocks the stale finally', async () => {
    const harness = createHarness({
      voiceUiState: createDefaultVoiceUiState({
        coachVoice: {
          speechEnabled: true,
          continuousEnabled: true,
          speechProvider: 'browser',
          inputProvider: 'browser',
        },
      }),
      recoveryState: createRecoveryState({
        level: 'critical',
        shouldDisableContinuous: true,
      }),
      recoveryPlan: {
        shouldApply: true,
        disableReason: 'Old recovery must not publish.',
      },
    });
    const runtimeResponse = createDeferred<Record<string, never>>();
    const cockpitUpdate = createDeferred<void>();
    const oldLifecycle = createLifecycle('session-1');
    const newLifecycle = createLifecycle(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness.submitInputRuntimeEvent.mockImplementationOnce(() => runtimeResponse.promise);
    harness.updateVoiceCockpitState.mockImplementationOnce(() => cockpitUpdate.promise);

    const oldSync = harness.controller.syncEvent('completed', { render: false }, oldLifecycle.context);
    expect(harness.updateVoiceCockpitState).not.toHaveBeenCalled();
    runtimeResponse.resolve({});
    await vi.waitFor(() => {
      expect(harness.updateVoiceCockpitState).toHaveBeenCalledTimes(1);
    });
    oldLifecycle.invalidate();
    const laterEventStart = harness.sideEffects.length;

    await harness.controller.syncEvent('waiting', { render: false }, newLifecycle.context);

    expect(harness.sideEffects.slice(laterEventStart, laterEventStart + 2)).toEqual([
      'pending:false',
      'local',
    ]);
    cockpitUpdate.resolve();
    await oldSync;

    expect(harness.addTerminalLine).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(harness.setRecoverySafetyPending.mock.calls).toEqual([
      [false],
      [true],
      [false],
    ]);
    expect(harness.render).not.toHaveBeenCalled();
  });

  it('suppresses recovery warnings and final publication when ownership expires during a rejected cockpit update', async () => {
    const harness = createHarness({
      recoveryPlan: {
        shouldApply: true,
        disableReason: 'Must remain hidden.',
      },
    });
    const cockpitUpdate = createDeferred<void>();
    const lifecycle = createLifecycle('session-1');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness.updateVoiceCockpitState.mockImplementationOnce(() => cockpitUpdate.promise);

    const recoveryPromise = harness.controller.enforceRecoverySafety(lifecycle.context);
    expect(harness.setRecoverySafetyPending).toHaveBeenCalledWith(true);
    lifecycle.invalidate();
    cockpitUpdate.reject(new Error('stale cockpit update'));
    await recoveryPromise;

    expect(harness.addTerminalLine).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(harness.setRecoverySafetyPending.mock.calls).toEqual([[true]]);
    expect(harness.render).not.toHaveBeenCalled();
  });

  it('enforces recovery safety by disabling continuous mode when the recovery plan requires it', async () => {
    const harness = createHarness({
      voiceUiState: createDefaultVoiceUiState({
        coachVoice: {
          speechEnabled: true,
          continuousEnabled: true,
          speechProvider: 'browser',
          inputProvider: 'browser',
        },
      }),
      recoveryState: createRecoveryState({
        level: 'critical',
        shouldDisableContinuous: true,
        disableReason: 'Hands-free was paused after repeated voice input failures.',
      }),
      recoveryPlan: {
        shouldApply: true,
        disableReason: 'Hands-free was paused after repeated voice input failures.',
      },
    });

    await harness.controller.enforceRecoverySafety();

    expect(harness.getInputRecoveryState).toHaveBeenCalledTimes(1);
    expect(harness.planRecoverySafety).toHaveBeenCalledWith({
      continuousEnabled: true,
      recovery: expect.objectContaining({
        shouldDisableContinuous: true,
      }),
    });
    expect(harness.setRecoverySafetyPending).toHaveBeenNthCalledWith(1, true);
    expect(harness.setRecoverySafetyPending).toHaveBeenNthCalledWith(2, false);
    expect(harness.updateVoiceCockpitState).toHaveBeenCalledWith({
      coachVoice: {
        continuousEnabled: false,
      },
    });
    expect(harness.getVoiceUiState().coachVoice?.continuousEnabled).toBe(false);
    expect(harness.addTerminalLine).toHaveBeenCalledWith(
      'system',
      'Hands-free was paused after repeated voice input failures.',
    );
    expect(harness.render).toHaveBeenCalledTimes(1);
  });
});
