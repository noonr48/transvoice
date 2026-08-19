import type { VoiceBackendPayload } from './state';
import type { VoiceCoachMessageChannel } from './state';

type VoiceCoachTaskStatus = 'idle' | 'running' | 'error';

type VoiceCoachTaskStartResponse = {
  taskId?: string | null;
};

type VoiceCoachTaskStatusResponse = {
  status?: string;
  result?: unknown;
  error?: unknown;
};

type VoiceCoachNoteControllerOptions = {
  getSessionContext: () => {
    currentSessionId: string | null;
    isConnected: boolean;
  };
  hasLastSummary: () => boolean;
  hasActiveGuideSession: () => boolean;
  requestDeepTutorCoach: (sessionId: string) => Promise<VoiceBackendPayload>;
  startCoachTask: (sessionId: string) => Promise<VoiceCoachTaskStartResponse>;
  getTaskStatus: (taskId: string) => Promise<VoiceCoachTaskStatusResponse>;
  applyVoiceBackendPayload: (payload: VoiceBackendPayload) => void;
  syncVoiceSessionStateFromBackend: () => Promise<void>;
  updateLastCoachResult: (message: string, generatedAt: number) => void;
  setTaskId: (taskId: string | null) => void;
  setTaskStatus: (status: VoiceCoachTaskStatus) => void;
  setTaskError: (error: string | null) => void;
  setPendingChannel: (channel: VoiceCoachMessageChannel) => void;
  clearPendingState: () => void;
  render: () => void;
  setTimeoutImpl?: typeof window.setTimeout;
  clearTimeoutImpl?: typeof window.clearTimeout;
  now?: () => number;
};

const COACH_NOTE_POLL_INTERVAL_MS = 1200;

export function createVoiceCoachNoteController(options: VoiceCoachNoteControllerOptions) {
  let pollTimer: number | null = null;
  const setTimeoutImpl = options.setTimeoutImpl || window.setTimeout.bind(window);
  const clearTimeoutImpl = options.clearTimeoutImpl || window.clearTimeout.bind(window);
  const now = options.now || (() => Date.now());

  function clearPollTimer(): void {
    if (pollTimer !== null) {
      clearTimeoutImpl(pollTimer);
      pollTimer = null;
    }
  }

  function failTask(error: string): void {
    options.setTaskId(null);
    options.setTaskStatus('error');
    options.setTaskError(error);
    options.clearPendingState();
    options.render();
  }

  async function pollTask(taskId: string, sessionId: string): Promise<void> {
    try {
      const data = await options.getTaskStatus(taskId);
      if (options.getSessionContext().currentSessionId !== sessionId) {
        clearPollTimer();
        return;
      }

      if (data.status === 'done') {
        options.setTaskId(null);
        options.setTaskStatus('idle');
        options.setTaskError(null);
        options.clearPendingState();
        if (typeof data.result === 'string') {
          options.updateLastCoachResult(data.result, now());
        }
        await options.syncVoiceSessionStateFromBackend().catch(() => null);
        options.render();
        return;
      }

      if (data.status === 'error') {
        failTask(
          typeof data.error === 'string' && data.error.trim()
            ? data.error
            : typeof data.result === 'string' && data.result.trim()
              ? data.result
              : 'Coach task failed',
        );
        return;
      }

      pollTimer = setTimeoutImpl(() => {
        void pollTask(taskId, sessionId).catch(() => null);
      }, COACH_NOTE_POLL_INTERVAL_MS) as unknown as number;
    } catch (error) {
      failTask(error instanceof Error ? error.message : String(error));
    }
  }

  async function requestCoachNote(): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    if (!currentSessionId || !isConnected || !options.hasLastSummary()) {
      return;
    }

    clearPollTimer();
    options.setTaskId(null);
    options.setTaskStatus('running');
    options.setTaskError(null);
    options.setPendingChannel(options.hasActiveGuideSession() ? 'deeptutor' : 'legacy');
    options.render();

    try {
      if (options.hasActiveGuideSession()) {
        const data = await options.requestDeepTutorCoach(currentSessionId);
        options.applyVoiceBackendPayload(data);
        options.setTaskStatus('idle');
        options.setTaskError(null);
        options.clearPendingState();
        options.render();
        return;
      }

      const data = await options.startCoachTask(currentSessionId);
      const taskId = typeof data.taskId === 'string' && data.taskId.trim() ? data.taskId : null;
      options.setTaskId(taskId);
      if (!taskId) {
        throw new Error('Coach task did not return a task ID');
      }
      await pollTask(taskId, currentSessionId);
    } catch (error) {
      failTask(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    clearPollTimer,
    requestCoachNote,
  };
}
