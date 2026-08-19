import {
  type DeepTutorVoiceResumePlan,
  type DeepTutorVoiceInteractionState,
} from './orchestrator';
import type { VoicePracticeTransportStatus } from './practice-transport';
import type { VoiceBackendPayload } from './state';

type DeepTutorVoiceLessonStatus = 'idle' | 'loading' | 'error';

type DeepTutorSessionControllerOptions = {
  getSessionContext: () => {
    currentSessionId: string | null;
    isConnected: boolean;
  };
  hasActiveGuideSession: () => boolean;
  shouldRebuildLesson: () => boolean;
  startLessonRequest: (sessionId: string, rebuildPlan: boolean) => Promise<VoiceBackendPayload>;
  advanceLessonRequest: (sessionId: string) => Promise<VoiceBackendPayload>;
  applyVoiceBackendPayload: (payload: VoiceBackendPayload) => void;
  setLessonStatus: (status: DeepTutorVoiceLessonStatus) => void;
  setLessonError: (error: string | null) => void;
  disarmPracticeSession: (reason: string) => Promise<void>;
  runCoachResumeHandoff: (interaction: DeepTutorVoiceInteractionState) => Promise<DeepTutorVoiceResumePlan>;
  addTerminalLine: (type: 'system' | 'user' | 'assistant' | 'error', content: string) => void;
  render: () => void;
};

export type DeepTutorResumeContext = {
  interaction: DeepTutorVoiceInteractionState;
};

export function createDeepTutorSessionController(options: DeepTutorSessionControllerOptions) {
  async function startLesson(): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    if (!currentSessionId || !isConnected) {
      return;
    }

    options.setLessonStatus('loading');
    options.setLessonError(null);
    options.render();

    try {
      const data = await options.startLessonRequest(currentSessionId, options.shouldRebuildLesson());
      options.applyVoiceBackendPayload(data);
      options.setLessonStatus('idle');
      options.setLessonError(null);
      options.render();
    } catch (error) {
      options.setLessonStatus('error');
      options.setLessonError(error instanceof Error ? error.message : String(error));
      options.render();
      throw error;
    }
  }

  async function advanceLesson(): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    if (!currentSessionId || !isConnected || !options.hasActiveGuideSession()) {
      return;
    }

    options.setLessonStatus('loading');
    options.setLessonError(null);
    options.render();

    try {
      const data = await options.advanceLessonRequest(currentSessionId);
      options.applyVoiceBackendPayload(data);
      options.setLessonStatus('idle');
      options.setLessonError(null);
      options.render();
    } catch (error) {
      options.setLessonStatus('error');
      options.setLessonError(error instanceof Error ? error.message : String(error));
      options.render();
      throw error;
    }
  }

  async function handoffPracticeAfterTake(context: {
    voiceSessionArmed: boolean;
    voiceTransportStatus: VoicePracticeTransportStatus;
  }): Promise<void> {
    if (!options.hasActiveGuideSession()) {
      return;
    }
    if (!context.voiceSessionArmed && context.voiceTransportStatus !== 'streaming') {
      return;
    }

    try {
      await options.disarmPracticeSession('post-take tutor handoff');
      options.addTerminalLine('system', 'Practice released so the tutor can review the take.');
    } catch (error) {
      options.addTerminalLine('system', `Tutor handoff disarm failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function resumeLoop(context: DeepTutorResumeContext): Promise<void> {
    const resumePlan = await options.runCoachResumeHandoff(context.interaction);
    if (resumePlan.action === 'start-lesson') {
      await startLesson();
    }
  }

  return {
    startLesson,
    advanceLesson,
    handoffPracticeAfterTake,
    resumeLoop,
  };
}
